# clipfarm

An open-source clip pipeline. It turns long recordings **you have the rights to** into captioned vertical clips, queues them for your approval, and schedules them to **your own accounts** through the platforms' official APIs.

> **Status:** M0 and M1 done. The whole pipeline runs in dry-run: drop a recording in a folder, get 9:16 clips with burned-in captions, approve them, and see exactly what would be posted where and when. Verified on Nov 10, 2026 with real ffmpeg on a test video. No transcription runner, no Claude clip picking and no live posting yet: those are M2, M3 and M5.

## Quick start

Needs Node ≥ 22.18 and ffmpeg. TypeScript runs directly, so there's no build step.

```bash
npm install
```

```bash
git config core.hooksPath scripts/git-hooks   # once per clone: blocks secrets, footage and contracts from commits
```

```bash
cp .env.example .env && chmod 600 .env        # nothing to fill in for dry-run
```

```bash
npm run check                 # typecheck + tests
```

```bash
npm start                     # checks the config, reports what still blocks live mode, exits
```

Then make your first clips:

1. Put a recording in `inbox/my-builds/`, e.g. `talk.mp4`.
2. Put its word-level transcript next to it as `talk.mp4.words.json` (whisperX JSON works as-is; the built-in runner is M2).
3. Run the pipeline, review, approve, run again:

```bash
npm start -- --run            # ingest → pick moments → render 9:16 clips with captions
```

```bash
npm start -- --list           # the review queue: id, status, confidence, path of each clip
```

```bash
npm start -- --approve 1      # or --reject 1
```

```bash
npm start -- --run            # schedules the approved clip and writes each post to data/outbox/
```

Nothing leaves your machine in dry-run. `data/outbox/post-<id>.json` shows the account, caption and time of every post it would make.

## The one rule

**Every source carries a rights record. No record, no ingest, no post.**

A source is footage you own, footage a creator gave you written permission to clip, or footage from a paid clipping campaign whose terms allow it. `config/sources.yaml` won't load without one of those three, and the same check runs again at the moment of posting, so an expired or withdrawn permission stops the posts. Details: [docs/RIGHTS.md](docs/RIGHTS.md).

This is also why the project works at all. Clips of other people's content posted without permission get matched by fingerprinting (small edits don't beat it), the accounts get strikes, and the earnings get clawed back. With permission, the same automation is a business.

## How it works

| Part | Job |
|---|---|
| **Rights gate** | Checks the rights record before ingest and again before every post: valid today, and covers this platform. |
| **Ingest** | Picks up files from a folder: your recordings, or files the creator sent you. |
| **Analyze** | Word-level transcript, plus audience signals (chat spikes, loudness). |
| **Select** | Picks the moments worth cutting. Free heuristic now; Claude in M3. |
| **Render** | ffmpeg: 9:16 crop, burned-in captions, loudness normalized, credit line when one is owed. |
| **Review** | You approve or reject each clip. Auto-approve above a confidence you choose is opt-in. |
| **Schedule** | One post per clip per account, inside your posting windows, under a daily cap. |
| **Publish** | Dry-run outbox now. Official upload APIs in M5. |
| **Withdraw** | One command cancels a clip's pending posts and removes the ones already out. |

Full design: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Docs

- [Architecture](docs/ARCHITECTURE.md): components, data model, costs, hosting
- [Rights](docs/RIGHTS.md): the rights record, and how to get permission
- [Platforms](docs/PLATFORMS.md): the official posting route and limits for each platform
- [Build prompt](docs/BUILD_PROMPT.md): paste it into Claude Code to build the next milestone
- [Contributing](CONTRIBUTING.md)

## What it won't do

These are design decisions, not missing features. Pull requests that add them will be closed.

- **No screen recording and no downloading from someone else's channel.** Footage arrives from the person who owns it.
- **No account farms.** A brand holds one account per platform. The daily cap has a ceiling the config can't raise (5 posts per account per day).
- **No dodging detection.** No proxies, no anti-detect browsers, no edits made to slip past copyright matching.
- **No browser automation for posting.** Official APIs only.

## Setup checklist (what you provide)

Put every secret into `.env` yourself. Never paste keys into chat or commit them.

- [ ] **ffmpeg** installed (`brew install ffmpeg` / `apt install ffmpeg`).
- [ ] **Your sources** in `config/sources.yaml`, each with its rights record. Keep the paperwork in `rights/` (gitignored).
- [ ] **Your accounts** in `config/accounts.yaml`: one per platform per brand.
- [ ] **Guardrail numbers** in `config/guardrails.yaml`: clip length, posting windows, daily cap. Then set `status: set`.
- [ ] **Posting access** (M5): a Google Cloud project for the YouTube Data API, and either a posting service key or your own TikTok and Meta developer apps. Their audits take 1–4 weeks, so apply early. See [docs/PLATFORMS.md](docs/PLATFORMS.md).
- [ ] **Anthropic API key** (M3, optional): for Claude clip picking.
- [ ] **A host**: your own computer is fine for dry-run. A small VPS for daily unattended runs.

## Making money with it

Three models, most predictable first. Numbers are rough and vary a lot.

| Model | How you're paid | Typical |
|---|---|---|
| **Your own content** | Platform revenue share, sponsors, and whatever you sell | Slow start. Compounds with an audience you own. |
| **Clip agency** | A creator pays you a monthly fee to run their official clips channel | $300–2,000 per creator per month |
| **Paid clipping campaigns** | A creator or brand pays per 1,000 views on clips of their content | Median near $1 per 1,000 views |

Running costs are about $25–60 a month for one or two sources, mostly a small server. See [Costs](docs/ARCHITECTURE.md#costs).

## Timeline

| Milestone | What | Status |
|---|---|---|
| M0 | Scaffold: config, rights gate, state, redacting logger | done Nov 10 |
| M1 | Dry-run pipeline: ingest, heuristic selection, ffmpeg render, review, scheduler, outbox | done Nov 10 |
| M2 | Transcription runner (whisperX) and silence trimming | next |
| M3 | Claude clip picking, chat and audio signals | |
| M4 | Face-tracked reframe, caption styles, review page | |
| M5 | Real publishers, live mode, takedown through the APIs | |
| M6 | Metrics feedback loop, Dockerfile, runbook | |

## License

MIT. See [LICENSE](LICENSE). The license covers this code, not the footage you run through it: that's what the rights record is for.
