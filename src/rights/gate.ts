import type { Platform, Rights, Source } from "../config/schemas.ts";

/**
 * The one rule, in code. Every ingest and every post goes through this file.
 *
 * A source without a rights record can't exist (the config loader rejects it),
 * so the gate only has to answer: is the record still valid, and does it cover
 * this platform?
 */
export type RightsDecision = { ok: true } | { ok: false; reason: string };

const OK: RightsDecision = { ok: true };

/** Today as YYYY-MM-DD in UTC. Dates compare correctly as strings. */
export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function expired(rights: Rights, today: string): boolean {
  return rights.basis !== "own" && rights.expires !== undefined && today > rights.expires;
}

export function checkIngest(source: Source, today: string): RightsDecision {
  if (expired(source.rights, today)) {
    return { ok: false, reason: `permission for "${source.id}" expired on ${(source.rights as { expires: string }).expires}` };
  }
  return OK;
}

export function checkPublish(rights: Rights, sourceId: string, platform: Platform, today: string): RightsDecision {
  if (rights.basis === "own") return OK;
  if (expired(rights, today)) return { ok: false, reason: `permission for "${sourceId}" expired on ${rights.expires}` };
  if (!rights.platforms.includes(platform)) {
    return { ok: false, reason: `permission for "${sourceId}" doesn't cover ${platform}` };
  }
  return OK;
}

/** Credit line every caption of a licensed or campaign clip must carry. Null for your own footage. */
export function creditLine(rights: Rights): string | null {
  return rights.basis === "own" ? null : rights.credit;
}

/** Caption text for a post: the clip's caption, then the credit line when one is owed. */
export function buildCaption(caption: string, rights: Rights): string {
  const credit = creditLine(rights);
  if (credit === null || caption.includes(credit)) return caption;
  return caption.trim() === "" ? credit : `${caption.trim()}\n\n${credit}`;
}
