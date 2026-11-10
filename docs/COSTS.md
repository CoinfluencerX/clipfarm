# What it costs

**Everyone runs their own copy and pays only for what they choose to turn on.** There's no shared server, no shared key and no account with this project. Your footage, your accounts and your keys stay on your machine, and any bill is yours alone.

Prices below are rough and change. Check each provider before you rely on a number.

## The free setup: $0

Everything needed to go from a recording to a finished, captioned clip is free.

| Step | Free choice | Quality |
|---|---|---|
| Where it runs | Your own computer | Same output as a server. It's only busy while it works. |
| Transcription | whisperX on your computer (M2) | Top-tier accuracy with the large model. Slower without a GPU. |
| Clip picking | The built-in heuristic | The weak spot. It finds dense, well-formed moments but can't tell if they're good, so you'll reject more. |
| Cutting, captions, loudness | ffmpeg | Same as any paid tool. |
| Review | The built-in commands | |
| Posting | Upload by hand, or schedule inside each app. TikTok, YouTube Studio and Meta Business Suite all schedule for free. | Same as automatic posting, about two minutes per clip. |

For posting by hand: after `--approve` and `--run`, each file in `data/outbox/` names the clip file, the caption and the suggested time for one account.

## The one upgrade worth paying for: Claude clip picking

This is the only step where paying changes the result, and it costs cents. One hour of speech is about 13,000 tokens in and 1,500 out.

| `select.model` | Per hour of footage | 30 hours a month |
|---|---|---|
| Built-in heuristic | $0 | $0 |
| `claude-haiku-5-5` (the default once you turn Claude on) | about $0.002 | about $0.06 |
| `claude-sonnet-5-5` | about $0.04 | about $1.20 |
| `claude-opus-5-5` | about $0.08 | about $2.40 |

Start on Haiku. M3 ships a side-by-side of each model's picks on your own recordings, so you can see whether a bigger model earns its price before you switch. Even the top model is a few dollars a month.

Each person creates their own Anthropic API key and puts it in their own `.env`. Set a monthly spend limit on the key in the Anthropic Console, so a mistake can't run up a bill.

## Optional, only if you want it

| What | Cost | Worth it when |
|---|---|---|
| Automatic posting through your own API apps (M5) | $0. The audits take 1–4 weeks per platform. | You post every day and want it hands-off. |
| A posting service instead of your own apps | About $30–150 a month | You don't want to wait for the audits. |
| A small server (VPS) | About $5–25 a month | You want daily runs while your computer is off. |
| X posting | A paid X API plan | Rarely. Add it last. |

Nothing in this table improves the clips. It only saves your time.

## What a heavier setup costs

For someone running it as a small business rather than for themselves:

| Item | 1–2 sources, ~5 clips a day | 5–10 sources, ~30 clips a day |
|---|---|---|
| Server | $10–25 | $40–90 |
| Storage | $0–5 | $10–25 |
| Clip picking | $0–5 | $5–30 |
| Posting service (optional) | $0–50 | $50–150 |
| **Total per month** | **about $25–60** | **about $100–300** |

## Sharing it with friends

- Each person clones the repo and makes their own `.env`, their own `config/` values and their own accounts. One person's setup never touches another's.
- **Never share a key or a `.env` file**, even with a friend. A shared key means a shared bill and a shared ban. Everyone makes their own.
- Don't commit `.env`, `data/`, `inbox/` or `rights/`. They're gitignored, and the pre-commit hook blocks them.
- The project sends nothing anywhere on its own: no telemetry, no usage reporting, no hosted backend.
