import { z } from "zod";

/** Env vars whose values must never appear in logs or the audit log. */
export const SECRET_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "YOUTUBE_CLIENT_SECRET",
  "TIKTOK_CLIENT_SECRET",
  "META_APP_SECRET",
  "POSTING_API_KEY",
  "TWITCH_CLIENT_SECRET",
  "TELEGRAM_BOT_TOKEN",
] as const;

const optionalString = z.string().min(1).optional();

export const EnvSchema = z.object({
  MODE: z.enum(["dry-run", "live"]).default("dry-run"),
  LIVE: z.enum(["0", "1"]).default("0"),
  DATA_DIR: z.string().min(1).default("data"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  FFMPEG_PATH: optionalString,
  FFPROBE_PATH: optionalString,

  ANTHROPIC_API_KEY: optionalString,

  YOUTUBE_CLIENT_ID: optionalString,
  YOUTUBE_CLIENT_SECRET: optionalString,
  TIKTOK_CLIENT_KEY: optionalString,
  TIKTOK_CLIENT_SECRET: optionalString,
  META_APP_ID: optionalString,
  META_APP_SECRET: optionalString,
  POSTING_API_KEY: optionalString,

  TWITCH_CLIENT_ID: optionalString,
  TWITCH_CLIENT_SECRET: optionalString,

  TELEGRAM_BOT_TOKEN: optionalString,
  TELEGRAM_OWNER_CHAT_ID: optionalString,
});

export type AppEnv = z.infer<typeof EnvSchema>;

const KNOWN_KEYS = Object.keys(EnvSchema.shape) as (keyof AppEnv)[];

/** Keep only the keys we know, and treat empty strings as unset (that's how .env.example ships). */
function pickKnown(raw: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of KNOWN_KEYS) {
    const value = raw[key]?.trim();
    if (value) out[key] = value;
  }
  return out;
}

/** Secret values present in the raw env, collected before validation so even invalid ones get redacted. */
export function collectSecretValues(raw: Record<string, string | undefined>): string[] {
  return SECRET_ENV_KEYS.map((k) => raw[k]?.trim()).filter((v): v is string => Boolean(v));
}

export class EnvError extends Error {
  override name = "EnvError";
}

export function parseEnv(raw: Record<string, string | undefined>): AppEnv {
  const result = EnvSchema.safeParse(pickKnown(raw));
  if (!result.success) {
    // Issue messages name the key and the rule, never the value.
    const problems = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new EnvError(`Invalid .env: ${problems.join("; ")}`);
  }
  return result.data;
}
