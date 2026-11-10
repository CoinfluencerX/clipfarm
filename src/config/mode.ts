import type { AppEnv } from "./env.ts";

export type Mode = "dry-run" | "live";

/**
 * Flipped to true only once the real publishers (M5) ship and the owner has run
 * the first live posts themselves. Until then nothing can leave the machine:
 * dry-run writes each post it would make to data/outbox/ instead.
 */
export const LIVE_PUBLISHING_AVAILABLE = false;

export class ModeError extends Error {
  override name = "ModeError";
}

export function isMode(value: string): value is Mode {
  return value === "dry-run" || value === "live";
}

/**
 * Live needs three independent switches: `--mode live` on the command line,
 * MODE=live and LIVE=1 in .env. Anything less runs dry, or refuses loudly
 * when live was asked for on the CLI but .env doesn't agree.
 */
export function resolveMode(
  cliMode: Mode | undefined,
  env: Pick<AppEnv, "MODE" | "LIVE">,
  liveAvailable: boolean = LIVE_PUBLISHING_AVAILABLE,
): Mode {
  if ((cliMode ?? "dry-run") === "dry-run") return "dry-run";

  if (env.MODE !== "live" || env.LIVE !== "1") {
    throw new ModeError("Live mode needs --mode live AND MODE=live AND LIVE=1 in .env. Refusing to start.");
  }
  if (!liveAvailable) {
    throw new ModeError("Live mode isn't available yet: the publishers ship in M5. Use --mode dry-run.");
  }
  return "live";
}
