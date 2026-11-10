import { z } from "zod";

// ---------- shared ----------

export const PLATFORMS = ["youtube", "tiktok", "instagram", "facebook", "x"] as const;
export type Platform = (typeof PLATFORMS)[number];
const platform = z.enum(PLATFORMS);

const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "must be a lowercase slug (a-z, 0-9, -), max 40 chars");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be a date like 2027-01-31");
const name = z.string().min(1);

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const v of values) (seen.has(v) ? dup : seen).add(v);
  return [...dup];
}

// ---------- sources.yaml ----------

/**
 * The rights record: why you are allowed to cut and repost this footage.
 * There is no "unknown" or "fair use" basis on purpose. No record, no ingest.
 */
const OwnRights = z.strictObject({ basis: z.literal("own") });

const grantedShape = {
  /** Who gave permission: the creator, their manager, or the campaign operator. */
  granted_by: name,
  /** Where the written permission lives: a path under rights/ (gitignored) or a URL to the campaign terms. */
  evidence: name,
  /** Platforms the permission covers. Posting anywhere else is refused. */
  platforms: z.array(platform).min(1),
  /** Whether you may monetize the clips. Recorded for the audit log and the publisher's settings. */
  monetization: z.boolean(),
  /** Credit line added to every caption, e.g. "🎥 @creator". */
  credit: name,
  /** Last day the permission is valid. Ingest and publishing stop the day after. */
  expires: isoDate.optional(),
};
const LicenseRights = z.strictObject({ basis: z.literal("license"), ...grantedShape });
const CampaignRights = z.strictObject({ basis: z.literal("campaign"), ...grantedShape });

export const RightsSchema = z.discriminatedUnion("basis", [OwnRights, LicenseRights, CampaignRights]);
export type Rights = z.infer<typeof RightsSchema>;

/**
 * How footage arrives. Only files the rights holder handed over (or your own recordings).
 * There is deliberately no screen-recorder and no third-party downloader kind.
 */
const LocalFolderIngest = z.strictObject({
  kind: z.literal("local-folder"),
  /** Folder to scan, relative to the repo root (keep it under inbox/, which is gitignored). */
  path: name,
});

const Source = z.strictObject({
  id: slug,
  name,
  rights: RightsSchema,
  ingest: LocalFolderIngest,
  /** Brand ids from accounts.yaml that may post this source's clips. */
  publish_to: z.array(slug).min(1),
});
export type Source = z.infer<typeof Source>;

export const SourcesSchema = z
  .strictObject({ sources: z.array(Source).min(1) })
  .superRefine((cfg, ctx) => {
    for (const id of duplicates(cfg.sources.map((s) => s.id))) {
      ctx.addIssue({ code: "custom", message: `duplicate source id "${id}"`, path: ["sources"] });
    }
  });
export type SourcesConfig = z.infer<typeof SourcesSchema>;

// ---------- accounts.yaml ----------

const handle = z.string().min(1);
const BrandAccounts = z
  .strictObject({
    youtube: z
      .strictObject({
        handle,
        channel_id: z.string().regex(/^UC[\w-]{22}$/, "must be a YouTube channel ID (UC…)").optional(),
      })
      .optional(),
    tiktok: z.strictObject({ username: handle }).optional(),
    instagram: z.strictObject({ username: handle }).optional(),
    facebook: z.strictObject({ page: handle }).optional(),
    x: z.strictObject({ handle }).optional(),
  })
  .refine((a) => Object.values(a).some(Boolean), "a brand needs at least one account");

/**
 * A brand is one public identity. Its accounts are keyed by platform, so a brand
 * can hold at most ONE account per platform. That shape is the multi-account rule.
 */
const Brand = z.strictObject({ id: slug, name, accounts: BrandAccounts });
export type Brand = z.infer<typeof Brand>;

/** The login name of a brand's account on a platform, or null when it has none. */
export function accountName(brand: Brand, p: Platform): string | null {
  const a = brand.accounts;
  switch (p) {
    case "youtube":
      return a.youtube?.handle ?? null;
    case "tiktok":
      return a.tiktok?.username ?? null;
    case "instagram":
      return a.instagram?.username ?? null;
    case "facebook":
      return a.facebook?.page ?? null;
    case "x":
      return a.x?.handle ?? null;
  }
}

export function brandPlatforms(brand: Brand): Platform[] {
  return PLATFORMS.filter((p) => accountName(brand, p) !== null);
}

export const AccountsSchema = z
  .strictObject({ brands: z.array(Brand).min(1) })
  .superRefine((cfg, ctx) => {
    for (const id of duplicates(cfg.brands.map((b) => b.id))) {
      ctx.addIssue({ code: "custom", message: `duplicate brand id "${id}"`, path: ["brands"] });
    }
    // The same account listed under two brands would let the daily cap be counted twice.
    for (const p of PLATFORMS) {
      const names = cfg.brands.map((b) => accountName(b, p)?.toLowerCase().replace(/^@/, "")).filter((n) => n !== undefined);
      for (const n of duplicates(names)) {
        ctx.addIssue({ code: "custom", message: `${p} account "${n}" is listed under more than one brand`, path: ["brands"] });
      }
    }
  });
export type AccountsConfig = z.infer<typeof AccountsSchema>;

// ---------- guardrails.yaml ----------

/** Ceiling the config can't raise. More posts per account per day reads as spam to every platform. */
export const HARD_MAX_POSTS_PER_ACCOUNT_PER_DAY = 5;
/** Floor the config can't lower. */
export const HARD_MIN_MINUTES_BETWEEN_POSTS = 60;

const window = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/, 'must look like "18:00-21:00"');
const timezone = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, "must be an IANA time zone like America/New_York");

export const GuardrailsSchema = z.strictObject({
  /** "placeholder" until the owner has chosen real values. Live mode refuses to start on placeholder. */
  status: z.enum(["placeholder", "set"]),
  clip: z
    .strictObject({
      min_seconds: z.number().int().min(5).max(170),
      max_seconds: z.number().int().min(10).max(180),
      /** Most clips cut from one hour of footage. */
      max_per_source_hour: z.number().int().min(1).max(20),
    })
    .refine((c) => c.min_seconds < c.max_seconds, "min_seconds must be below max_seconds"),
  select: z.strictObject({
    provider: z.enum(["heuristic", "claude"]),
    /** Claude model id, used only when provider is "claude". */
    model: name,
  }),
  review: z
    .strictObject({
      /** manual: a person approves every clip. auto: clips at or above auto_min_confidence post without review. */
      mode: z.enum(["manual", "auto"]),
      auto_min_confidence: z.number().min(0).max(1).nullable(),
    })
    .refine((r) => r.mode === "manual" || r.auto_min_confidence !== null, "auto review needs auto_min_confidence"),
  publish: z.strictObject({
    max_posts_per_account_per_day: z.number().int().min(1).max(HARD_MAX_POSTS_PER_ACCOUNT_PER_DAY),
    min_minutes_between_posts: z.number().int().min(HARD_MIN_MINUTES_BETWEEN_POSTS),
    /** Local posting windows, in `timezone`. */
    windows: z.array(window).min(1),
    timezone,
  }),
});
export type Guardrails = z.infer<typeof GuardrailsSchema>;

// ---------- checks across files ----------

export interface ConfigSet {
  sources: SourcesConfig;
  accounts: AccountsConfig;
  guardrails: Guardrails;
}

/** Problems that make the config unusable in any mode. Empty when it's fine. */
export function crossCheckProblems(cfg: Pick<ConfigSet, "sources" | "accounts">): string[] {
  const problems: string[] = [];
  const brands = new Map(cfg.accounts.brands.map((b) => [b.id, b]));
  for (const s of cfg.sources.sources) {
    for (const brandId of s.publish_to) {
      const brand = brands.get(brandId);
      if (!brand) {
        problems.push(`sources.yaml: source "${s.id}" publishes to brand "${brandId}", which isn't in accounts.yaml`);
        continue;
      }
      if (s.rights.basis !== "own") {
        const covered = new Set<Platform>(s.rights.platforms);
        if (!brandPlatforms(brand).some((p) => covered.has(p))) {
          problems.push(
            `sources.yaml: source "${s.id}" may post on [${s.rights.platforms.join(", ")}], but brand "${brandId}" has no account on any of them`,
          );
        }
      }
    }
  }
  return problems;
}

/** Why live mode must refuse to start. Empty when the config is ready. */
export function liveReadinessProblems(cfg: ConfigSet): string[] {
  const problems: string[] = [];
  if (cfg.guardrails.status !== "set") {
    problems.push('guardrails.yaml: status is "placeholder". Choose real values and change it to "set".');
  }
  for (const b of cfg.accounts.brands) {
    for (const p of brandPlatforms(b)) {
      if (/^@?your[-_]/i.test(accountName(b, p) ?? "")) {
        problems.push(`accounts.yaml: brand "${b.id}" still has the placeholder ${p} account.`);
      }
    }
  }
  return problems;
}
