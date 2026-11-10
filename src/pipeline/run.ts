import { join } from "node:path";
import type { Transcriber, Transcript } from "../analyze/transcript.ts";
import type { AppConfig } from "../config/load.ts";
import type { Mode } from "../config/mode.ts";
import { accountName, brandPlatforms, type Source } from "../config/schemas.ts";
import { ingestLocalFolder } from "../ingest/local-folder.ts";
import type { Logger } from "../log/logger.ts";
import type { Probe } from "../media/ffprobe.ts";
import type { Publisher } from "../publish/types.ts";
import { planSlots } from "../publish/scheduler.ts";
import type { Renderer } from "../render/ffmpeg.ts";
import { autoApprove } from "../review/queue.ts";
import { buildCaption, checkIngest, checkPublish, creditLine, utcDay } from "../rights/gate.ts";
import { maxClipsFor, type Selector } from "../select/types.ts";
import { audit } from "../state/audit.ts";
import type { Db } from "../state/db.ts";
import {
  getClip,
  getMedia,
  hasPost,
  insertClip,
  insertPost,
  listClips,
  mediaAwaitingSelection,
  postsByStatus,
  saveSegments,
  segmentsAwaitingRender,
  setPostStatus,
  takenSlots,
} from "../state/store.ts";

export interface PipelineDeps {
  db: Db;
  config: AppConfig;
  mode: Mode;
  /** Repo root: relative ingest paths resolve against it. */
  root: string;
  dataDir: string;
  log: Logger;
  now: () => Date;
  probe: Probe;
  transcriber: Transcriber;
  selector: Selector;
  renderer: Renderer;
  publisher: Publisher;
  signal?: AbortSignal;
}

export interface RunSummary {
  ingested: number;
  alreadyKnown: number;
  waitingForTranscript: number;
  segments: number;
  rendered: number;
  autoApproved: number;
  awaitingReview: number;
  scheduled: number;
  posted: number;
  failed: number;
  /** Things the rights gate or the guardrails stopped, in plain words. */
  refused: string[];
}

/**
 * One pass over everything, in order. Each step only picks up work the previous
 * steps left in the database, so the run can stop anywhere and resume later.
 */
export async function runOnce(deps: PipelineDeps): Promise<RunSummary> {
  const { db, config, log } = deps;
  const summary: RunSummary = {
    ingested: 0, alreadyKnown: 0, waitingForTranscript: 0, segments: 0, rendered: 0,
    autoApproved: 0, awaitingReview: 0, scheduled: 0, posted: 0, failed: 0, refused: [],
  };
  const sources = new Map<string, Source>(config.sources.sources.map((s) => [s.id, s]));
  const brands = new Map(config.accounts.brands.map((b) => [b.id, b]));
  const stopped = () => deps.signal?.aborted === true;
  const ms = () => deps.now().getTime();
  const today = () => utcDay(deps.now());
  /**
   * Something the rights gate or the guardrails stopped. `record` writes it to the audit log:
   * true for one-off events (a scheduled post cancelled), false for standing conditions that
   * repeat on every run (an expired source, a platform the permission doesn't cover).
   */
  const refuse = (what: string, detail: Record<string, unknown>, record = false) => {
    summary.refused.push(what);
    log.warn("refused", { reason: what, ...detail });
    if (record) audit(db, log.redactor, "refused", { reason: what, ...detail }, ms());
  };

  // 1. Ingest: only sources whose rights record is valid today.
  for (const source of sources.values()) {
    if (stopped()) return summary;
    const allowed = checkIngest(source, today());
    if (!allowed.ok) {
      refuse(allowed.reason, { step: "ingest", sourceId: source.id });
      continue;
    }
    const result = await ingestLocalFolder({ db, source, root: deps.root, probe: deps.probe, now: ms() });
    if (result.missingFolder) log.info("ingest.folder_missing", { sourceId: source.id, folder: result.missingFolder });
    for (const added of result.added) {
      audit(db, log.redactor, "media.ingested", { ...added, sourceId: source.id, rights: source.rights }, ms());
      log.info("media.ingested", { ...added, sourceId: source.id, rightsBasis: source.rights.basis });
    }
    for (const failure of result.failed) log.error("ingest.failed", failure);
    summary.ingested += result.added.length;
    summary.alreadyKnown += result.alreadyKnown;
    summary.failed += result.failed.length;
  }

  // 2. Analyze + select: transcript in, candidate segments out.
  const transcripts = new Map<number, Transcript | null>();
  const transcriptFor = async (mediaId: number, path: string) => {
    if (!transcripts.has(mediaId)) transcripts.set(mediaId, await deps.transcriber.transcribe(path));
    return transcripts.get(mediaId) ?? null;
  };
  const { clip: clipLimits } = config.guardrails;
  for (const media of mediaAwaitingSelection(db)) {
    if (stopped()) return summary;
    const transcript = await transcriptFor(media.id, media.path);
    if (!transcript) {
      summary.waitingForTranscript++;
      log.info("transcript.missing", { mediaId: media.id, path: media.path });
      continue;
    }
    const candidates = await deps.selector.select({
      transcript,
      durationMs: media.duration_ms,
      peaks: [],
      limits: {
        minMs: clipLimits.min_seconds * 1000,
        maxMs: clipLimits.max_seconds * 1000,
        maxClips: maxClipsFor(media.duration_ms, clipLimits.max_per_source_hour),
      },
    });
    saveSegments(db, media.id, deps.selector.name, candidates, ms());
    summary.segments += candidates.length;
    log.info("segments.selected", { mediaId: media.id, count: candidates.length, selector: deps.selector.name });
  }

  // 3. Render: 9:16, burned-in captions, credit line when one is owed.
  for (const segment of segmentsAwaitingRender(db)) {
    if (stopped()) return summary;
    const media = getMedia(db, segment.media_id);
    const source = sources.get(media.source_id);
    if (!source) {
      refuse(`source "${media.source_id}" is no longer in sources.yaml, so it has no rights record`, { step: "render", segmentId: segment.id });
      continue;
    }
    const transcript = await transcriptFor(media.id, media.path);
    try {
      const path = await deps.renderer.render({
        input: media.path,
        outputDir: join(deps.dataDir, "clips", `segment-${segment.id}`),
        startMs: segment.start_ms,
        endMs: segment.end_ms,
        srcWidth: media.width,
        srcHeight: media.height,
        words: transcript?.words ?? [],
        credit: creditLine(source.rights),
      });
      const clipId = insertClip(db, segment.id, path, ms());
      summary.rendered++;
      log.info("clip.rendered", { clipId, path });
    } catch (err) {
      summary.failed++;
      log.error("render.failed", { segmentId: segment.id, error: err });
    }
  }

  // 4. Review: manual by default. Auto only approves at or above the owner's threshold.
  const { review } = config.guardrails;
  if (review.mode === "auto" && review.auto_min_confidence !== null) {
    summary.autoApproved = autoApprove(db, log, review.auto_min_confidence, ms());
  }
  summary.awaitingReview = listClips(db, "rendered").length;

  // 5. Schedule: each approved clip gets one post per account it's allowed on.
  const { publish } = config.guardrails;
  const policy = {
    windows: publish.windows,
    timezone: publish.timezone,
    maxPerDay: publish.max_posts_per_account_per_day,
    minGapMinutes: publish.min_minutes_between_posts,
  };
  for (const clip of listClips(db, "approved")) {
    if (stopped()) return summary;
    const source = sources.get(clip.source_id);
    if (!source) {
      refuse(`source "${clip.source_id}" is no longer in sources.yaml, so it has no rights record`, { step: "schedule", clipId: clip.id });
      continue;
    }
    for (const brandId of source.publish_to) {
      const brand = brands.get(brandId);
      if (!brand) continue;
      for (const platform of brandPlatforms(brand)) {
        if (hasPost(db, clip.id, brandId, platform)) continue;
        const allowed = checkPublish(source.rights, source.id, platform, today());
        if (!allowed.ok) {
          refuse(allowed.reason, { step: "schedule", clipId: clip.id, brandId, platform });
          continue;
        }
        const [slot] = planSlots({ now: ms(), count: 1, taken: takenSlots(db, brandId, platform), policy });
        if (slot === undefined) {
          refuse("no free posting slot in the next 60 days", { step: "schedule", clipId: clip.id, brandId, platform });
          continue;
        }
        const postId = insertPost(
          db,
          { clipId: clip.id, brandId, platform, account: accountName(brand, platform)!, caption: buildCaption(clip.caption, source.rights), scheduledAt: slot },
          ms(),
        );
        if (postId === null) continue;
        summary.scheduled++;
        audit(db, log.redactor, "post.scheduled", { postId, clipId: clip.id, brandId, platform, scheduledAt: new Date(slot).toISOString() }, ms());
      }
    }
  }

  // 6. Publish. Dry-run writes every scheduled post to the outbox now; live sends only what's due.
  for (const post of postsByStatus(db, "scheduled")) {
    if (stopped()) return summary;
    if (deps.mode === "live" && post.scheduled_at > ms()) continue;
    const clip = getClip(db, post.clip_id);
    const source = clip ? sources.get(clip.source_id) : undefined;
    // Rights are checked again at the last moment: a permission can expire or be removed after scheduling.
    const allowed = !clip || clip.status !== "approved"
      ? { ok: false as const, reason: "the clip is no longer approved" }
      : !source
        ? { ok: false as const, reason: `source "${clip.source_id}" is no longer in sources.yaml` }
        : checkPublish(source.rights, source.id, post.platform, today());
    if (!allowed.ok || !clip || !source) {
      setPostStatus(db, post.id, "removed", null, ms());
      refuse(allowed.ok ? "the clip is gone" : allowed.reason, { step: "publish", postId: post.id }, true);
      continue;
    }
    try {
      const result = await deps.publisher.publish({
        postId: post.id,
        clipPath: clip.path,
        platform: post.platform,
        brandId: post.brand_id,
        account: post.account,
        title: clip.title,
        caption: post.caption,
        scheduledAt: post.scheduled_at,
        sourceId: source.id,
        rightsBasis: source.rights.basis,
      });
      setPostStatus(db, post.id, deps.mode === "live" ? "published" : "dry_run", result.externalId, ms());
      summary.posted++;
      audit(db, log.redactor, deps.mode === "live" ? "post.published" : "post.dry_run", { postId: post.id, ...result }, ms());
    } catch (err) {
      setPostStatus(db, post.id, "failed", null, ms());
      summary.failed++;
      log.error("publish.failed", { postId: post.id, error: err });
      audit(db, log.redactor, "post.failed", { postId: post.id, error: err }, ms());
    }
  }

  return summary;
}
