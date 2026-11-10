# Rights

**Every source carries a rights record. No record, no ingest, no post.**

Not legal advice. This is how the tool works and what it needs from you.

## The three bases

| `basis` | Meaning | What the record needs |
|---|---|---|
| `own` | You recorded it and you own it. | Nothing else. |
| `license` | A creator gave you written permission to clip and repost their content. | `granted_by`, `evidence`, `platforms`, `monetization`, `credit`, optional `expires` |
| `campaign` | A paid clipping campaign whose terms allow it. | The same fields. `evidence` is the campaign's terms. |

There's no fourth option. "It's public", "everyone clips them" and "fair use" aren't permissions, and the config won't load with them.

## The fields

```yaml
rights:
  basis: license
  granted_by: "Example Creator (manager: name@example.com)"
  evidence: rights/creator-example/2026-11-permission.pdf
  platforms: [youtube, tiktok]
  monetization: true
  credit: "🎥 @examplecreator"
  expires: "2027-05-31"
```

- **`granted_by`**: who said yes. The creator, their manager, or the campaign operator.
- **`evidence`**: where the written yes lives. A file under `rights/` or a URL to the campaign terms. `rights/` is gitignored and the pre-commit hook blocks it: contracts and DMs never go in a public repo.
- **`platforms`**: where you may post. The tool refuses anywhere else.
- **`monetization`**: whether you may earn from the clips. Recorded with every ingest.
- **`credit`**: added to every caption and pinned on the clip itself.
- **`expires`**: the last valid day. Ingest and posting stop the day after, including posts already scheduled.

## What to get in writing

A short email or signed one-pager is enough. It should say:

1. Which content you may clip (all streams, one series, a date range).
2. Which platforms you may post to, and on whose accounts: yours, or an official clips channel you run for them.
3. Whether you may monetize, and the split if there is one.
4. How you'll get the source files.
5. That they can ask for any clip to come down, and how fast you'll do it.
6. An end date or a notice period.

## When someone asks for a clip to come down

Take it down first, sort it out after:

```bash
npm start -- --withdraw <clip id>
```

That cancels the clip's pending posts and removes the ones already out. The audit log keeps the record of what was posted and when it was removed.

If a permission ends, set `expires` or delete the source from `sources.yaml`. Either stops every post that hasn't gone out yet.

## Other rules that still apply

The rights record covers copyright permission. You're still responsible for:

- **Each platform's rules** on reused and mass-produced content. Keep the human review step and vary your formats.
- **Disclosure.** Paid campaign clips are sponsored content: use the platform's paid-partnership label and say so up front.
- **People in the footage** other than the creator, and any music playing in the background. A creator's permission doesn't cover a song they don't own.
