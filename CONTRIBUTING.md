# Contributing

Thanks for helping. A few things to know before you open a pull request.

## Run the checks

```bash
npm install
```

```bash
git config core.hooksPath scripts/git-hooks
```

```bash
npm run check
```

Every change needs tests. The suite runs without ffmpeg, without network and without any API key: external tools sit behind small interfaces (`Probe`, `Transcriber`, `Selector`, `Renderer`, `Publisher`) and tests pass fakes.

## Where things go

- A new way to get footage in: `src/ingest/`, and a new `kind` in `src/config/schemas.ts`.
- A new clip picker: implement `Selector` in `src/select/`.
- A new platform or posting service: implement `Publisher` in `src/publish/`.
- A new guardrail: `config/guardrails.yaml`, its schema, and a test that shows it holds.

Follow [docs/BUILD_PROMPT.md](docs/BUILD_PROMPT.md) for the milestone order.

## Free by default

Anyone should be able to run this for $0 on their own computer. A feature that needs a paid service is opt-in, uses the key of the person running it, and leaves the free route working. No shared keys, no hosted backend, no telemetry. See [docs/COSTS.md](docs/COSTS.md).

## What won't be merged

The project only works, legally and practically, because of these. See the [README](README.md#what-it-wont-do).

- Screen recording, or downloading from a channel you don't own.
- Any way around the rights record: a default basis, an "unknown" basis, a flag that skips the gate.
- More than one account per platform per brand, raising the daily cap ceiling, or rotating accounts.
- Proxies, anti-detect browsers, fingerprint spoofing, or edits made to defeat copyright matching.
- Posting through browser automation or unofficial endpoints.

## Never commit

Secrets, footage, or anyone's permission paperwork. `.env`, `inbox/`, `rights/` and `data/` are gitignored, and the pre-commit hook blocks them. If a key ever lands in a commit or a recording, revoke it.
