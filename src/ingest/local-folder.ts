import { createHash } from "node:crypto";
import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import type { Source } from "../config/schemas.ts";
import type { Probe } from "../media/ffprobe.ts";
import type { Db } from "../state/db.ts";
import { findMediaBySha, insertMedia } from "../state/store.ts";

/**
 * Ingest from a folder of files the rights holder handed over (or your own recordings).
 *
 * This is the only ingest kind on purpose. Later kinds must keep the same property:
 * the footage arrives from the person who owns it (a shared drive, an S3 drop, the
 * Twitch API with the broadcaster's own OAuth grant). No screen recorder, no downloader
 * pointed at someone else's channel.
 */
export const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".mkv", ".webm", ".m4v"]);

export function sha256File(path: string): Promise<string> {
  return new Promise((res, rej) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", rej)
      .on("end", () => res(hash.digest("hex")));
  });
}

export interface IngestResult {
  added: { mediaId: number; path: string }[];
  alreadyKnown: number;
  failed: { path: string; error: string }[];
  /** Set when the folder doesn't exist yet. Not an error: nothing has been dropped in. */
  missingFolder?: string;
}

export async function ingestLocalFolder(opts: {
  db: Db;
  source: Source;
  /** Folder that relative ingest paths are resolved against (the repo root). */
  root: string;
  probe: Probe;
  now: number;
}): Promise<IngestResult> {
  const folder = resolve(opts.root, opts.source.ingest.path);
  const result: IngestResult = { added: [], alreadyKnown: 0, failed: [] };
  if (!existsSync(folder)) return { ...result, missingFolder: folder };

  const files = readdirSync(folder)
    .filter((f) => VIDEO_EXTENSIONS.has(extname(f).toLowerCase()))
    .sort()
    .map((f) => join(folder, f))
    .filter((p) => statSync(p).isFile());

  for (const path of files) {
    try {
      const sha256 = await sha256File(path);
      if (findMediaBySha(opts.db, sha256)) {
        result.alreadyKnown++;
        continue;
      }
      const info = await opts.probe(path);
      const mediaId = insertMedia(opts.db, { sourceId: opts.source.id, path, sha256, ...info, rights: opts.source.rights }, opts.now);
      result.added.push({ mediaId, path });
    } catch (err) {
      result.failed.push({ path, error: (err as Error).message });
    }
  }
  return result;
}
