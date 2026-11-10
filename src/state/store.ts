import type { Platform, Rights } from "../config/schemas.ts";
import type { Db } from "./db.ts";

export interface MediaRow {
  id: number;
  source_id: string;
  path: string;
  sha256: string;
  duration_ms: number;
  width: number;
  height: number;
  rights_json: string;
  status: "ingested" | "selected";
}

export interface SegmentRow {
  id: number;
  media_id: number;
  start_ms: number;
  end_ms: number;
  score: number;
  confidence: number;
  title: string;
  caption: string;
}

export type ClipStatus = "rendered" | "approved" | "rejected" | "withdrawn";
export type PostStatus = "scheduled" | "dry_run" | "published" | "failed" | "removed";

/** A clip joined with where it came from: everything review and scheduling need. */
export interface ClipView {
  id: number;
  path: string;
  status: ClipStatus;
  source_id: string;
  media_path: string;
  start_ms: number;
  end_ms: number;
  confidence: number;
  title: string;
  caption: string;
}

export interface PostRow {
  id: number;
  clip_id: number;
  brand_id: string;
  platform: Platform;
  account: string;
  caption: string;
  scheduled_at: number;
  status: PostStatus;
  external_id: string | null;
}

const id = (r: { lastInsertRowid: number | bigint }) => Number(r.lastInsertRowid);

export function findMediaBySha(db: Db, sha256: string): MediaRow | undefined {
  return db.prepare("SELECT * FROM media WHERE sha256 = ?").get(sha256) as MediaRow | undefined;
}

export function insertMedia(
  db: Db,
  m: { sourceId: string; path: string; sha256: string; durationMs: number; width: number; height: number; rights: Rights },
  now: number,
): number {
  return id(
    db
      .prepare(
        "INSERT INTO media (source_id, path, sha256, duration_ms, width, height, rights_json, status, ingested_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'ingested', ?)",
      )
      .run(m.sourceId, m.path, m.sha256, m.durationMs, m.width, m.height, JSON.stringify(m.rights), now),
  );
}

export function mediaAwaitingSelection(db: Db): MediaRow[] {
  return db.prepare("SELECT * FROM media WHERE status = 'ingested' ORDER BY id").all() as unknown as MediaRow[];
}

export function getMedia(db: Db, mediaId: number): MediaRow {
  return db.prepare("SELECT * FROM media WHERE id = ?").get(mediaId) as unknown as MediaRow;
}

export function saveSegments(
  db: Db,
  mediaId: number,
  selector: string,
  segments: readonly { startMs: number; endMs: number; score: number; confidence: number; title: string; caption: string }[],
  now: number,
): void {
  const insert = db.prepare(
    "INSERT OR IGNORE INTO segments (media_id, start_ms, end_ms, score, confidence, title, caption, selector, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const s of segments) insert.run(mediaId, s.startMs, s.endMs, s.score, s.confidence, s.title, s.caption, selector, now);
    db.prepare("UPDATE media SET status = 'selected' WHERE id = ?").run(mediaId);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function segmentsAwaitingRender(db: Db): SegmentRow[] {
  return db
    .prepare("SELECT s.* FROM segments s LEFT JOIN clips c ON c.segment_id = s.id WHERE c.id IS NULL ORDER BY s.id")
    .all() as unknown as SegmentRow[];
}

export function insertClip(db: Db, segmentId: number, path: string, now: number): number {
  return id(db.prepare("INSERT INTO clips (segment_id, path, status, created_at) VALUES (?, ?, 'rendered', ?)").run(segmentId, path, now));
}

const CLIP_VIEW = `
  SELECT c.id, c.path, c.status, m.source_id, m.path AS media_path,
         s.start_ms, s.end_ms, s.confidence, s.title, s.caption
  FROM clips c JOIN segments s ON s.id = c.segment_id JOIN media m ON m.id = s.media_id`;

export function listClips(db: Db, status?: ClipStatus): ClipView[] {
  const rows = status
    ? db.prepare(`${CLIP_VIEW} WHERE c.status = ? ORDER BY c.id`).all(status)
    : db.prepare(`${CLIP_VIEW} ORDER BY c.id`).all();
  return rows as unknown as ClipView[];
}

export function getClip(db: Db, clipId: number): ClipView | undefined {
  return db.prepare(`${CLIP_VIEW} WHERE c.id = ?`).get(clipId) as ClipView | undefined;
}

export function setClipStatus(db: Db, clipId: number, status: ClipStatus, now: number): void {
  db.prepare("UPDATE clips SET status = ?, reviewed_at = ? WHERE id = ?").run(status, now, clipId);
}

/** Returns the new post id, or null when this clip already has a row for this account (never post twice). */
export function insertPost(
  db: Db,
  p: { clipId: number; brandId: string; platform: Platform; account: string; caption: string; scheduledAt: number },
  now: number,
): number | null {
  const r = db
    .prepare(
      "INSERT OR IGNORE INTO posts (clip_id, brand_id, platform, account, caption, scheduled_at, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'scheduled', ?, ?)",
    )
    .run(p.clipId, p.brandId, p.platform, p.account, p.caption, p.scheduledAt, now, now);
  return Number(r.changes) === 0 ? null : id(r);
}

export function hasPost(db: Db, clipId: number, brandId: string, platform: Platform): boolean {
  return db.prepare("SELECT 1 FROM posts WHERE clip_id = ? AND brand_id = ? AND platform = ?").get(clipId, brandId, platform) !== undefined;
}

/** Times already taken on one account: everything scheduled or already out. */
export function takenSlots(db: Db, brandId: string, platform: Platform): number[] {
  const rows = db
    .prepare("SELECT scheduled_at FROM posts WHERE brand_id = ? AND platform = ? AND status IN ('scheduled', 'dry_run', 'published')")
    .all(brandId, platform) as unknown as { scheduled_at: number }[];
  return rows.map((r) => r.scheduled_at);
}

export function postsByStatus(db: Db, status: PostStatus): PostRow[] {
  return db.prepare("SELECT * FROM posts WHERE status = ? ORDER BY scheduled_at, id").all(status) as unknown as PostRow[];
}

export function postsForClip(db: Db, clipId: number): PostRow[] {
  return db.prepare("SELECT * FROM posts WHERE clip_id = ? ORDER BY id").all(clipId) as unknown as PostRow[];
}

export function setPostStatus(db: Db, postId: number, status: PostStatus, externalId: string | null, now: number): void {
  db.prepare("UPDATE posts SET status = ?, external_id = COALESCE(?, external_id), updated_at = ? WHERE id = ?").run(status, externalId, now, postId);
}
