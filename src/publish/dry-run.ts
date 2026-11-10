import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Publisher } from "./types.ts";

/**
 * Posts nothing. Writes what WOULD be posted to data/outbox/post-<id>.json, so you can
 * read the exact title, caption, account and time before anything is allowed to go live.
 */
export function dryRunPublisher(outboxDir: string): Publisher {
  const file = (postId: number) => join(outboxDir, `post-${postId}.json`);
  return {
    async publish(req) {
      mkdirSync(outboxDir, { recursive: true });
      writeFileSync(file(req.postId), JSON.stringify({ ...req, scheduledAt: new Date(req.scheduledAt).toISOString(), dryRun: true }, null, 2) + "\n");
      return { externalId: `dry-run:${req.postId}` };
    },
    async remove(post) {
      if (existsSync(file(post.postId))) rmSync(file(post.postId));
    },
  };
}
