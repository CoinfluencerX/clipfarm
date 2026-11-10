import type { Logger } from "../log/logger.ts";
import type { Publisher } from "../publish/types.ts";
import { audit } from "../state/audit.ts";
import type { Db } from "../state/db.ts";
import { getClip, listClips, postsForClip, setClipStatus, setPostStatus, type ClipView } from "../state/store.ts";

export class ReviewError extends Error {
  override name = "ReviewError";
}

function requireClip(db: Db, clipId: number): ClipView {
  const clip = getClip(db, clipId);
  if (!clip) throw new ReviewError(`No clip #${clipId}. Run with --list to see the queue.`);
  return clip;
}

/** A person's decision on a rendered clip. Only approved clips are ever scheduled. */
export function decide(db: Db, log: Logger, clipId: number, decision: "approved" | "rejected", now: number): void {
  const clip = requireClip(db, clipId);
  if (clip.status !== "rendered") throw new ReviewError(`Clip #${clipId} is already ${clip.status}.`);
  setClipStatus(db, clipId, decision, now);
  audit(db, log.redactor, `clip.${decision}`, { clipId, by: "owner" }, now);
}

/** Auto review: approve rendered clips at or above the confidence the owner chose. */
export function autoApprove(db: Db, log: Logger, minConfidence: number, now: number): number {
  let approved = 0;
  for (const clip of listClips(db, "rendered")) {
    if (clip.confidence < minConfidence) continue;
    setClipStatus(db, clip.id, "approved", now);
    audit(db, log.redactor, "clip.approved", { clipId: clip.id, by: "auto", confidence: clip.confidence, minConfidence }, now);
    approved++;
  }
  return approved;
}

/**
 * Takedown. Cancels every post of the clip that hasn't gone out and removes the ones that have.
 * Use it the moment a rights holder asks, then sort out why afterwards.
 */
export async function withdrawClip(db: Db, log: Logger, publisher: Publisher, clipId: number, now: number): Promise<{ cancelled: number; removed: number }> {
  requireClip(db, clipId);
  setClipStatus(db, clipId, "withdrawn", now);
  let cancelled = 0;
  let removed = 0;
  for (const post of postsForClip(db, clipId)) {
    if (post.status === "scheduled") {
      cancelled++;
    } else if ((post.status === "dry_run" || post.status === "published") && post.external_id) {
      await publisher.remove({ postId: post.id, platform: post.platform, account: post.account, externalId: post.external_id });
      removed++;
    } else {
      continue;
    }
    setPostStatus(db, post.id, "removed", null, now);
  }
  audit(db, log.redactor, "clip.withdrawn", { clipId, cancelled, removed }, now);
  return { cancelled, removed };
}
