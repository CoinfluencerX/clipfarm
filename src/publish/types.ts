import type { Platform } from "../config/schemas.ts";

export interface PublishRequest {
  postId: number;
  clipPath: string;
  platform: Platform;
  brandId: string;
  /** The brand's own account on this platform, from accounts.yaml. */
  account: string;
  title: string;
  /** Final caption, credit line included when one is owed. */
  caption: string;
  scheduledAt: number;
  sourceId: string;
  /** How the rights were granted, recorded with every post. */
  rightsBasis: "own" | "license" | "campaign";
}

export interface PublishResult {
  externalId: string;
  url?: string;
}

/**
 * One implementation per route out of the machine. The real ones (M5) call the
 * platforms' official upload APIs, or one posting service that holds approved apps.
 * No browser automation and no unofficial endpoints: both get accounts banned.
 */
export interface Publisher {
  publish(req: PublishRequest): Promise<PublishResult>;
  /** Takes a post down. Used when a clip is withdrawn (a rights holder asked, or you changed your mind). */
  remove(post: { postId: number; platform: Platform; account: string; externalId: string }): Promise<void>;
}
