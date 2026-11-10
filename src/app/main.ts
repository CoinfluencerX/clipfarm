import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs, parseEnv as parseDotenv } from "node:util";
import { sidecarTranscriber } from "../analyze/transcript.ts";
import { collectSecretValues, EnvError, parseEnv, type AppEnv } from "../config/env.ts";
import { ConfigError, loadAppConfig, type AppConfig } from "../config/load.ts";
import { isMode, ModeError, resolveMode, type Mode } from "../config/mode.ts";
import { brandPlatforms, liveReadinessProblems } from "../config/schemas.ts";
import { createLogger, type Logger } from "../log/logger.ts";
import { ffprobe, type Probe } from "../media/ffprobe.ts";
import { runOnce } from "../pipeline/run.ts";
import { dryRunPublisher } from "../publish/dry-run.ts";
import type { Publisher } from "../publish/types.ts";
import { ffmpegRenderer, type Renderer } from "../render/ffmpeg.ts";
import { decide, ReviewError, withdrawClip } from "../review/queue.ts";
import { heuristicSelector } from "../select/heuristic.ts";
import { audit } from "../state/audit.ts";
import { openDb, SCHEMA_VERSION, type Db } from "../state/db.ts";
import { listClips } from "../state/store.ts";

export const EXIT = { OK: 0, CONFIG: 1, MODE: 2, USAGE: 64, FATAL: 70 } as const;

export interface MainOptions {
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  cwd: string;
  /** Where JSON log lines and the --list table go. Defaults to stdout. */
  write?: (line: string) => void;
  /** Test hook only. Production always uses LIVE_PUBLISHING_AVAILABLE. */
  liveAvailable?: boolean;
  /** Test hooks: replace the local tools so tests need no ffmpeg and no real video. */
  probe?: Probe;
  renderer?: Renderer;
  publisher?: Publisher;
  now?: () => Date;
  /** Stops a run between steps (Ctrl-C). */
  signal?: AbortSignal;
}

const USAGE = `Usage: npm start -- [--mode dry-run|live] [action] [--config-dir config] [--data-dir data] [--env-file .env]

  (no action)     load and check the config, open the database, report, exit
  --run           one pass: ingest → select → render → review → schedule → publish (dry-run: to data/outbox/)
  --list          show every clip with its id, status and confidence
  --approve <id>  approve a rendered clip, so the next --run schedules it
  --reject <id>   reject a rendered clip
  --withdraw <id> takedown: cancel the clip's pending posts and remove the ones already out

  --mode          dry-run (default) or live. Live also needs MODE=live and LIVE=1 in .env.
  --config-dir    folder with sources.yaml, accounts.yaml, guardrails.yaml
  --data-dir      folder for the SQLite state, clips and outbox. Overrides DATA_DIR.
  --env-file      env file to load (default .env, optional). Real environment variables win.`;

function parseCli(argv: readonly string[]) {
  const { values } = parseArgs({
    args: [...argv],
    strict: true,
    allowPositionals: false,
    options: {
      mode: { type: "string" },
      run: { type: "boolean", default: false },
      list: { type: "boolean", default: false },
      approve: { type: "string" },
      reject: { type: "string" },
      withdraw: { type: "string" },
      "config-dir": { type: "string" },
      "data-dir": { type: "string" },
      "env-file": { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  return values;
}

function clipId(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new ReviewError(`"${value}" isn't a clip id. Run with --list to see them.`);
  return n;
}

const hasTool = (binary: string) => spawnSync(binary, ["-version"], { stdio: "ignore" }).status === 0;

const clock = (ms: number) => new Date(ms).toISOString().slice(11, 19);

export async function main(opts: MainOptions): Promise<number> {
  const write = opts.write ?? ((line: string) => process.stdout.write(line + "\n"));
  const now = opts.now ?? (() => new Date());

  // 1. Arguments. No secrets are loaded yet, so a bare logger is fine.
  let args: ReturnType<typeof parseCli>;
  try {
    args = parseCli(opts.argv);
  } catch (err) {
    createLogger({ write }).error("usage.invalid", { error: (err as Error).message, usage: USAGE });
    return EXIT.USAGE;
  }
  if (args.help) {
    write(USAGE);
    return EXIT.OK;
  }
  if (args.mode !== undefined && !isMode(args.mode)) {
    createLogger({ write }).error("usage.invalid", { error: `--mode must be dry-run or live, got "${args.mode}"` });
    return EXIT.USAGE;
  }
  const actions = [args.run, args.list, args.approve !== undefined, args.reject !== undefined, args.withdraw !== undefined].filter(Boolean);
  if (actions.length > 1) {
    createLogger({ write }).error("usage.invalid", { error: "Pick one action: --run, --list, --approve, --reject or --withdraw." });
    return EXIT.USAGE;
  }
  const cliMode: Mode | undefined = args.mode;

  // 2. Environment: the env file first, then real environment variables on top.
  const envFile = resolve(opts.cwd, args["env-file"] ?? ".env");
  const fileEnv = existsSync(envFile) ? parseDotenv(readFileSync(envFile, "utf8")) : {};
  const rawEnv: Record<string, string | undefined> = { ...fileEnv };
  for (const [k, v] of Object.entries(opts.env)) if (v !== undefined && v !== "") rawEnv[k] = v;

  // Every secret is registered for redaction before anything else can log.
  let log: Logger = createLogger({ write, secrets: collectSecretValues(rawEnv) });

  let env: AppEnv;
  let config: AppConfig;
  let mode: Mode;
  try {
    env = parseEnv(rawEnv);
    log = createLogger({ write, level: env.LOG_LEVEL, redactor: log.redactor });
    config = loadAppConfig(resolve(opts.cwd, args["config-dir"] ?? "config"));
    mode = resolveMode(cliMode, env, opts.liveAvailable);
    if (mode === "live") {
      const problems = liveReadinessProblems(config);
      if (problems.length > 0) throw new ModeError(`Live mode refused:\n  - ${problems.join("\n  - ")}`);
    }
    if (config.guardrails.select.provider === "claude") {
      throw new ConfigError('guardrails.yaml: select.provider "claude" ships in M3. Use "heuristic" until then.');
    }
  } catch (err) {
    if (err instanceof EnvError || err instanceof ConfigError) {
      log.error("config.invalid", { error: err.message });
      return EXIT.CONFIG;
    }
    if (err instanceof ModeError) {
      log.error("mode.refused", { error: err.message });
      return EXIT.MODE;
    }
    log.error("fatal", { error: err });
    return EXIT.FATAL;
  }

  // 3. State. One database per mode, so dry runs never mix with real posting history.
  const dataDir = resolve(opts.cwd, args["data-dir"] ?? env.DATA_DIR);
  let db: Db;
  try {
    db = openDb(join(dataDir, `${mode}.sqlite`));
  } catch (err) {
    log.error("fatal", { error: err });
    return EXIT.FATAL;
  }

  const publisher = opts.publisher ?? dryRunPublisher(join(dataDir, "outbox"));
  const ms = () => now().getTime();

  try {
    if (args.list) {
      const clips = listClips(db);
      if (clips.length === 0) write("No clips yet. Drop a recording (and its .words.json transcript) into a source folder, then --run.");
      for (const c of clips) {
        write(`#${c.id}  ${c.status.padEnd(9)}  conf ${c.confidence.toFixed(2)}  ${clock(c.start_ms)}–${clock(c.end_ms)}  ${c.source_id}  "${c.title}"  ${c.path}`);
      }
      return EXIT.OK;
    }

    if (args.approve !== undefined || args.reject !== undefined) {
      const id = clipId((args.approve ?? args.reject)!);
      const decision = args.approve !== undefined ? "approved" : "rejected";
      decide(db, log, id, decision, ms());
      log.info(`clip.${decision}`, { clipId: id });
      return EXIT.OK;
    }

    if (args.withdraw !== undefined) {
      const id = clipId(args.withdraw);
      const result = await withdrawClip(db, log, publisher, id, ms());
      log.info("clip.withdrawn", { clipId: id, ...result });
      return EXIT.OK;
    }

    const ffmpegBin = env.FFMPEG_PATH ?? "ffmpeg";
    const ffprobeBin = env.FFPROBE_PATH ?? "ffprobe";

    if (args.run) {
      const missing = [opts.probe ? null : ffprobeBin, opts.renderer ? null : ffmpegBin].filter((b): b is string => b !== null && !hasTool(b));
      if (missing.length > 0) {
        log.error("tools.missing", { missing, fix: "Install ffmpeg (it includes ffprobe), or set FFMPEG_PATH / FFPROBE_PATH in .env." });
        return EXIT.CONFIG;
      }
      audit(db, log.redactor, "run.start", { mode }, ms());
      const summary = await runOnce({
        db, config, mode, root: opts.cwd, dataDir, log, now,
        probe: opts.probe ?? ffprobe(ffprobeBin),
        transcriber: sidecarTranscriber,
        selector: heuristicSelector,
        renderer: opts.renderer ?? ffmpegRenderer(ffmpegBin),
        publisher,
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      audit(db, log.redactor, "run.end", { mode, ...summary }, ms());
      log.info("run.done", { mode, ...summary });
      return EXIT.OK;
    }

    // No action: report what's configured and what still blocks live mode.
    audit(db, log.redactor, "boot", { mode, schemaVersion: SCHEMA_VERSION }, ms());
    log.info("boot.ok", {
      mode,
      schemaVersion: SCHEMA_VERSION,
      sources: config.sources.sources.map((s) => ({ id: s.id, rights: s.rights.basis })),
      brands: config.accounts.brands.map((b) => ({ id: b.id, platforms: brandPlatforms(b) })),
      guardrails: config.guardrails.status,
      review: config.guardrails.review.mode,
      tools: { ffmpeg: hasTool(ffmpegBin), ffprobe: hasTool(ffprobeBin) },
      beforeLive: liveReadinessProblems(config),
    });
    return EXIT.OK;
  } catch (err) {
    if (err instanceof ReviewError) {
      log.error("review.invalid", { error: err.message });
      return EXIT.USAGE;
    }
    log.error("fatal", { error: err });
    return EXIT.FATAL;
  } finally {
    db.close();
  }
}
