import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { EXIT, main } from "../src/app/main.ts";
import { fakeProbe, fakeRenderer, FAKE_SECRETS, licensedSource, repoConfigObject, tempProject } from "./helpers.ts";

const T0 = "2026-11-10T14:00:00Z"; // 09:00 in New York

function harness(project: ReturnType<typeof tempProject>, probe = fakeProbe) {
  const lines: string[] = [];
  const renderer = fakeRenderer();
  let now = new Date(T0);
  const run = (...argv: string[]) =>
    main({ argv, env: { ...FAKE_SECRETS }, cwd: project.root, write: (l) => lines.push(l), probe, renderer, now: () => now });
  const events = (name: string) => lines.filter((l) => l.startsWith("{")).map((l) => JSON.parse(l)).filter((e) => e.event === name);
  const lastRun = () => events("run.done").at(-1);
  const outbox = () => {
    const dir = join(project.dataDir, "outbox");
    return existsSync(dir) ? readdirSync(dir).sort().map((f) => JSON.parse(readFileSync(join(dir, f), "utf8"))) : [];
  };
  const sql = (query: string) => {
    const db = new DatabaseSync(join(project.dataDir, "dry-run.sqlite"));
    try {
      return db.prepare(query).all() as any[];
    } finally {
      db.close();
    }
  };
  return { run, lines, events, lastRun, outbox, sql, renderer, setNow: (iso: string) => (now = new Date(iso)) };
}

describe("boot", () => {
  it("checks the shipped config and reports what blocks live mode", async () => {
    const h = harness(tempProject());
    expect(await h.run()).toBe(EXIT.OK);
    const boot = h.events("boot.ok")[0];
    expect(boot.mode).toBe("dry-run");
    expect(boot.sources).toEqual([{ id: "my-builds", rights: "own" }]);
    expect(boot.beforeLive.length).toBeGreaterThan(0);
  });

  it("refuses live mode", async () => {
    const h = harness(tempProject());
    expect(await h.run("--mode", "live")).toBe(EXIT.MODE);
  });

  it("refuses a source with no rights record", async () => {
    const sources = repoConfigObject("sources.yaml");
    delete sources.sources[0].rights;
    const h = harness(tempProject({ sources, videoIn: "inbox/my-builds" }));
    expect(await h.run("--run")).toBe(EXIT.CONFIG);
    expect(h.events("config.invalid")[0].error).toMatch(/rights/);
  });

  it("never prints a secret", async () => {
    const h = harness(tempProject());
    await h.run("--run");
    for (const secret of Object.values(FAKE_SECRETS)) expect(h.lines.join("\n")).not.toContain(secret);
  });
});

describe("pipeline, own footage, manual review", () => {
  it("renders clips and then waits for a person", async () => {
    const h = harness(tempProject());
    expect(await h.run("--run")).toBe(EXIT.OK);
    const s = h.lastRun();
    expect(s).toMatchObject({ ingested: 1, segments: 1, rendered: 1, awaitingReview: 1, scheduled: 0, posted: 0, refused: [] });
    expect(h.outbox()).toEqual([]);
    // 16:9 source, word-level captions handed to the renderer, no credit line on your own footage
    expect(h.renderer.jobs[0]).toMatchObject({ srcWidth: 1920, srcHeight: 1080, credit: null });
    expect(h.renderer.jobs[0]!.words.length).toBeGreaterThan(0);
  });

  it("schedules an approved clip once per account and writes the outbox", async () => {
    const h = harness(tempProject());
    await h.run("--run");
    expect(await h.run("--approve", "1")).toBe(EXIT.OK);
    await h.run("--run");
    expect(h.lastRun()).toMatchObject({ ingested: 0, alreadyKnown: 1, rendered: 0, scheduled: 3, posted: 3 });
    const posts = h.outbox();
    expect(posts.map((p) => p.platform).sort()).toEqual(["instagram", "tiktok", "youtube"]);
    for (const p of posts) {
      expect(p).toMatchObject({ dryRun: true, brandId: "main", rightsBasis: "own", scheduledAt: "2026-11-10T16:00:00.000Z" });
    }
  });

  it("a third run posts nothing new: one post per clip per account, ever", async () => {
    const h = harness(tempProject());
    await h.run("--run");
    await h.run("--approve", "1");
    await h.run("--run");
    await h.run("--run");
    expect(h.lastRun()).toMatchObject({ scheduled: 0, posted: 0 });
    expect(h.sql("SELECT COUNT(*) AS n FROM posts")[0].n).toBe(3);
  });

  it("a rejected clip is never scheduled", async () => {
    const h = harness(tempProject());
    await h.run("--run");
    await h.run("--reject", "1");
    await h.run("--run");
    expect(h.lastRun()).toMatchObject({ scheduled: 0, posted: 0, awaitingReview: 0 });
    expect(await h.run("--approve", "1")).toBe(EXIT.USAGE);
  });

  it("withdraw takes the clip's posts down and keeps a record", async () => {
    const h = harness(tempProject());
    await h.run("--run");
    await h.run("--approve", "1");
    await h.run("--run");
    expect(await h.run("--withdraw", "1")).toBe(EXIT.OK);
    expect(h.outbox()).toEqual([]);
    expect(h.sql("SELECT DISTINCT status FROM posts")).toEqual([{ status: "removed" }]);
    expect(h.sql("SELECT kind FROM audit_log WHERE kind = 'clip.withdrawn'")).toHaveLength(1);
    await h.run("--run");
    expect(h.lastRun()).toMatchObject({ scheduled: 0, posted: 0 });
  });

  it("media without a transcript waits instead of failing", async () => {
    const h = harness(tempProject({ videoIn: "inbox/my-builds", words: [] }));
    await h.run("--run");
    expect(h.lastRun()).toMatchObject({ ingested: 1, segments: 0, rendered: 0 });
  });

  it("--list shows the queue", async () => {
    const h = harness(tempProject());
    await h.run("--run");
    await h.run("--list");
    expect(h.lines.at(-1)).toMatch(/^#1 {2}rendered {3}conf 0\.\d\d/);
  });
});

describe("pipeline, licensed footage", () => {
  const licensed = (rights: Record<string, unknown> = {}) => tempProject({ sources: { sources: [licensedSource(rights)] } });

  it("posts only where the permission reaches, with the credit line", async () => {
    const h = harness(licensed({ platforms: ["youtube"] }));
    await h.run("--run");
    expect(h.renderer.jobs[0]!.credit).toBe("🎥 @creatora");
    await h.run("--approve", "1");
    await h.run("--run");
    const posts = h.outbox();
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ platform: "youtube", rightsBasis: "license", sourceId: "creator-a" });
    expect(posts[0].caption).toMatch(/🎥 @creatora$/);
    expect(h.lastRun().refused).toEqual([
      `permission for "creator-a" doesn't cover tiktok`,
      `permission for "creator-a" doesn't cover instagram`,
    ]);
  });

  it("an expired permission stops ingest", async () => {
    const h = harness(licensed({ expires: "2026-11-09" }));
    await h.run("--run");
    expect(h.lastRun()).toMatchObject({ ingested: 0, refused: [`permission for "creator-a" expired on 2026-11-09`] });
    expect(h.sql("SELECT COUNT(*) AS n FROM media")[0].n).toBe(0);
  });

  it("a permission that expires after approval stops the posts", async () => {
    const h = harness(licensed({ expires: "2026-11-10" }));
    await h.run("--run");
    await h.run("--approve", "1");
    h.setNow("2026-11-11T14:00:00Z");
    await h.run("--run");
    expect(h.lastRun()).toMatchObject({ scheduled: 0, posted: 0 });
    expect(h.outbox()).toEqual([]);
  });

  it("records the rights each file was ingested under", async () => {
    const h = harness(licensed());
    await h.run("--run");
    expect(JSON.parse(h.sql("SELECT rights_json FROM media")[0].rights_json)).toMatchObject({ basis: "license", granted_by: "Creator A" });
    expect(h.sql("SELECT kind FROM audit_log WHERE kind = 'media.ingested'")).toHaveLength(1);
  });
});

describe("guardrails in the pipeline", () => {
  it("auto review approves only at or above the threshold", async () => {
    const guardrails = repoConfigObject("guardrails.yaml");
    guardrails.review = { mode: "auto", auto_min_confidence: 0.99 };
    const strict = harness(tempProject({ guardrails }));
    await strict.run("--run");
    expect(strict.lastRun()).toMatchObject({ autoApproved: 0, awaitingReview: 1, posted: 0 });

    guardrails.review.auto_min_confidence = 0.1;
    const loose = harness(tempProject({ guardrails }));
    await loose.run("--run");
    expect(loose.lastRun()).toMatchObject({ autoApproved: 1, awaitingReview: 0, posted: 3 });
  });

  it("spreads clips over days instead of exceeding the daily cap", async () => {
    const guardrails = repoConfigObject("guardrails.yaml");
    guardrails.review = { mode: "auto", auto_min_confidence: 0 };
    guardrails.clip = { min_seconds: 20, max_seconds: 30, max_per_source_hour: 20 };
    guardrails.publish.max_posts_per_account_per_day = 1;
    // A 30-minute recording may yield several clips; the fake transcript holds two minutes of speech.
    const h = harness(tempProject({ guardrails }), async () => ({ durationMs: 30 * 60_000, width: 1920, height: 1080 }));
    await h.run("--run");
    expect(h.lastRun().rendered).toBeGreaterThan(1);
    const days = h.sql("SELECT scheduled_at FROM posts WHERE platform = 'youtube' ORDER BY scheduled_at").map((r) => new Date(r.scheduled_at).toISOString().slice(0, 10));
    expect(days).toHaveLength(h.lastRun().rendered);
    expect(new Set(days).size).toBe(days.length);
  });
});

describe("audit log", () => {
  it("doesn't grow when the same refusal repeats on every run", async () => {
    const h = harness(tempProject({ sources: { sources: [licensedSource({ platforms: ["youtube"], expires: "2026-11-10" })] } }));
    await h.run("--run");
    await h.run("--approve", "1");
    await h.run("--run"); // youtube post written to the outbox; tiktok and instagram aren't covered
    const refusals = () => h.sql("SELECT COUNT(*) AS n FROM audit_log WHERE kind = 'refused'")[0].n;
    expect(refusals()).toBe(0);
    await h.run("--run");
    await h.run("--run");
    expect(refusals()).toBe(0);
    expect(h.lastRun().refused).toHaveLength(2);
  });
});
