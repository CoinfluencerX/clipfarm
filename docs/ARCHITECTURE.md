# Architecture

```
                              ┌───────────── RIGHTS GATE ─────────────┐
                              │ rights record valid today?            │
                              │ covers this platform?                 │
                              └──────┬─────────────────────────┬──────┘
                                     │ before ingest           │ before every post
 ┌── INGEST ───┐  ┌── ANALYZE ──┐  ┌─▼ SELECT ───┐  ┌── RENDER ───┐  ┌── REVIEW ──┐  ┌─ SCHEDULE ─┐  ┌▼ PUBLISH ───┐
 │ files from  │  │ word-level  │  │ pick the    │  │ 9:16 crop   │  │ approve /  │  │ windows    │  │ dry-run:    │
 │ the rights  │─▶│ transcript  │─▶│ moments     │─▶│ captions    │─▶│ reject     │─▶│ daily cap  │─▶│  outbox     │
 │ holder      │  │ chat, audio │  │ heuristic   │  │ loudness    │  │ (auto is   │  │ min gap    │  │ live: the   │
 │             │  │ signals     │  │ or Claude   │  │ credit line │  │  opt-in)   │  │ one post / │  │  official   │
 └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘  └────────────┘  │ clip / acct│  │  APIs       │
                                                                                     └────────────┘  └──────┬──────┘
 ┌──────────────────────────────── STATE ────────────────────────────────┐                                  │
 │ SQLite: media → segments → clips → posts → metrics, plus audit log    │◀──── METRICS (views back in) ────┘
 └───────────────────────────────────────────────────────────────────────┘
```

Every step is plain code on a schedule. The only model call is clip picking (M3), and it's one request per recording. There's no agent in the loop.

Each step picks up the work the previous steps left in the database, so a run can stop anywhere and resume. `npm start -- --run` is one pass over everything.

## Components

### Rights gate (`src/rights/gate.ts`)
- The one rule in code. Every ingest and every post goes through it.
- A source without a rights record can't be loaded at all: the config schema has three bases (`own`, `license`, `campaign`) and nothing else. There's no "unknown" or "fair use".
- At ingest it checks the record hasn't expired. At scheduling and again at the moment of posting it checks expiry and that the permission covers that platform. The last check uses today's config, so removing a source or letting a permission lapse stops posts that were already scheduled.
- The rights record each file was ingested under is stored with the file and written to the audit log.

### Ingest (`src/ingest/`)
- **Local folder**: scans a folder for video files, hashes each one (a file is only ever ingested once), and reads duration and frame size with ffprobe.
- The footage must come from the person who owns it. Planned kinds keep that property: a shared drive or S3 drop the creator uploads to, and the Twitch API with the broadcaster's own OAuth grant.
- **Not here by design:** a screen recorder, or a downloader pointed at someone else's channel.

### Analyze (`src/analyze/`)
- **Transcript**: word-level timestamps. Today it reads a sidecar file next to the video (`talk.mp4.words.json`, whisperX format). M2 adds a runner that writes that file.
- **Signals**: moments the audience reacted to. Chat-rate spikes are implemented (`chatPeaks`). Loudness spikes and existing community clips are M3.

### Select (`src/select/`)
- One interface, `Selector`: transcript and signals in, ranked candidate segments out, each with a confidence.
- **Heuristic** (ships now, free, offline): windows that start on a sentence, are dense with speech, open on something hook-shaped, and overlap signal peaks. It can't judge whether a moment is funny or useful. It fills a review queue.
- **Claude** (M3): the same interface, with the transcript and signal timestamps in one request and structured output back. The model is a config value (`select.model`).
- The clip count scales with the recording: `max_per_source_hour` per hour of footage.

### Render (`src/render/`)
- One ffmpeg command per clip: cut, crop to 9:16, scale to 1080×1920, burn in captions, normalize loudness to −14 LUFS, H.264 + AAC.
- Captions are an ASS file built from the word timestamps: three words at a time, large and centered.
- The crop takes a horizontal focus point. Today it's the center. M4 feeds it from face tracking.
- A licensed or campaign clip gets the credit line pinned at the top for its whole length.

### Review (`src/review/`)
- A rendered clip does nothing until a person approves it. `--list`, `--approve <id>`, `--reject <id>`.
- Auto-approve is opt-in: set `review.mode: auto` and a minimum confidence. Keep it manual for the first month or two. YouTube's inauthentic-content policy is aimed at mass-produced uploads with no human in the loop.
- **Withdraw** (`--withdraw <id>`) is the takedown path: it cancels the clip's pending posts and removes the ones already out, and the audit log keeps the record.

### Schedule (`src/publish/scheduler.ts`)
- Each approved clip gets one post per account it's allowed on.
- Slots fall inside your local posting windows, never more than the daily cap per account, never closer together than the minimum gap. Extra clips roll to the next day.
- **One post per clip per account, ever.** The post row is written before any upload, and the database rejects a second row for the same clip and account, so a restart or a second run can't double-post.

### Publish (`src/publish/`)
- One interface, `Publisher`, with `publish` and `remove`.
- **Dry-run** (ships now): writes each post to `data/outbox/post-<id>.json`.
- **Live** (M5): official upload APIs only. See [PLATFORMS.md](PLATFORMS.md). Live mode needs `--mode live` and `MODE=live` and `LIVE=1` in `.env`, guardrails with `status: set`, and real account names. Until M5 ships it's refused outright.

### Accounts and guardrails (`config/`)
- A **brand** is one public identity, with at most one account per platform. The same account can't sit under two brands.
- The daily cap has a ceiling the config can't raise (5 per account), and the gap between posts has a floor (60 minutes).
- Every guardrail number ships as a placeholder. Live mode refuses to start until you've set them.

### State and logs (`src/state/`, `src/log/`)
- SQLite, one file per mode, so dry runs never mix with real posting history.
- `media → segments → clips → posts → metrics`, plus an append-only audit log of what was ingested under which rights, what was approved by whom, and what was posted or refused.
- Logs are JSON lines with every secret redacted.

## Costs

Free by default: every paid service is opt-in, and each person brings their own key and pays their own bill. Clip picking with Claude is the only model cost, at about $0.002 per hour of footage on the default model. The full breakdown is in [COSTS.md](COSTS.md).

## Infrastructure
- **Language**: TypeScript on Node 22, run directly with no build step. Dependencies: `yaml` and `zod`.
- **Local tools**: ffmpeg and ffprobe. whisperX from M2.
- **Host**: your own computer is enough. For runs while it's off, a small VPS and a cron entry that calls `npm start -- --run`.
- **No shared anything**: no hosted backend, no shared keys, no telemetry. Each person runs their own copy.
- **Secrets**: `.env` only. OAuth tokens land in `data/` (gitignored). The pre-commit hook blocks secrets, footage and permission paperwork.
- **Building it**: a coding agent such as Claude Code writes the milestones from [BUILD_PROMPT.md](BUILD_PROMPT.md). Nothing in the running system needs an agent. If you want to check on it from your phone, a chat agent can sit on top of the same CLI later.
