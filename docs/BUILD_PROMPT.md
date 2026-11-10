# Build prompt

Paste the block below into a Claude Code session opened on this repo to build the next milestone.

---

```
GOAL: Build the next unfinished milestone of clipfarm in this repo, following
README.md, docs/ARCHITECTURE.md, docs/RIGHTS.md and docs/PLATFORMS.md.

OUTCOME: A TypeScript (Node 22) pipeline that:
1. Ingests recordings only from sources in config/sources.yaml, each with a
   rights record (own, license or campaign). Files come from the rights holder.
2. Transcribes them to word-level timestamps.
3. Picks the moments worth cutting (heuristic, or Claude with structured output).
4. Renders 9:16 clips with burned-in captions, normalized loudness and the
   credit line when one is owed.
5. Holds every clip for my approval unless I've turned on auto review.
6. Schedules one post per clip per account inside my posting windows, under
   the daily cap, and posts through official APIs only.
7. Pulls views back in and uses what performed to pick better.

BUILD ORDER (finish and verify each step before starting the next):
M0  [DONE 2026-11-10] Scaffold: npm + TS strict + vitest, config loader
    (yaml + .env), rights gate, structured logger that redacts secrets,
    SQLite state. Verify: `npm run check` passes and `npm start` boots and
    exits cleanly.
M1  [DONE 2026-11-10] Dry-run pipeline: local-folder ingest, sidecar
    transcripts, heuristic selector, ffmpeg render, review commands,
    scheduler, outbox publisher, withdraw. Verify: tests pass, and a real
    video with a .words.json next to it becomes a 1080x1920 clip with
    captions and three outbox posts after --approve.
M2  Transcription. A whisperX runner behind the Transcriber interface that
    writes the .words.json sidecar, and optional silence trimming with
    auto-editor before selection. Verify: a real 10-minute recording of mine
    produces word timestamps, and captions line up with speech in the
    rendered clip (I'll watch it).
M3  Claude selector behind the Selector interface: transcript and signal
    timestamps in one request, structured output back, model from
    guardrails.yaml (default claude-haiku-5-5). Add loudness peaks next to
    chat peaks. Verify: on three recordings of mine, show me the picks of
    the heuristic, Haiku and Sonnet side by side, with token counts and
    cost per recording, so I can see whether a bigger model earns its price.
M4  Render quality and review. Face-tracked focus point for the crop, a
    split layout for facecam + screen, two caption styles, and a local
    review page with approve / reject buttons. Verify: I review a batch of
    ten clips on the page from my phone.
M5  Publishers. First a hand-off folder for people who post by hand (the
    free route): one folder per post with the clip, the caption as text and
    the time. Then YouTube Data API (OAuth, private upload), then one
    posting-service publisher, each with remove() for takedowns. Unlock live
    mode. Verify: I post one clip to my own channel as private, then
    withdraw it, and both show in the audit log.
M6  Metrics and ops. Pull views per post daily, feed the best and worst
    clips back into the selector prompt, Dockerfile, cron entry, RUNBOOK.md
    (start, review, withdraw, recover). Verify: a week of unattended
    dry-runs on the VPS with no manual fixes.

HARD RULES:
- Never add a way to get footage that doesn't come from the rights holder:
  no screen recording, no downloading from a channel I don't own.
- Never weaken the rights gate. No default basis, no skip flag. Every new
  ingest kind and every new publisher goes through src/rights/gate.ts.
- One account per platform per brand. Don't raise the hard ceilings in
  src/config/schemas.ts. No proxies, no anti-detect tooling, no account
  rotation, no edits meant to defeat copyright matching.
- Official APIs only for posting. No browser automation.
- You never post live. Live mode needs --mode live, MODE=live and LIVE=1,
  which I set myself. I run every live test myself.
- Never ask me for, print, log or commit an API key, OAuth secret or token.
  Read them only from .env. Never commit footage or anything under rights/.
- Don't add dependencies from unknown GitHub repos. Use official SDKs
  (Anthropic, Google, TikTok, Meta), and read anything else before
  installing it.
- Keep guardrail numbers in config/guardrails.yaml with safe placeholders.
  I'll set the real values.
- Free by default. Every paid service is opt-in and uses the key of the
  person running it. Never add a shared key, a hosted backend, telemetry
  or anything that phones home. The free route (own computer, local
  transcription, heuristic picking, posting by hand) must keep working.

STOP AND ASK ME WHEN: an API plan, audit or credential is missing; a
platform can't be posted to without breaking its terms; a source's rights
record doesn't clearly cover what I asked for; or a milestone's
verification fails twice for the same reason.

AFTER EACH MILESTONE: commit (ask me which branch first), then report what
changed, the verification you ran with its output, and what's next.
```

---

## What to have ready before running it

See the setup checklist in the [README](../README.md#setup-checklist-what-you-provide).
