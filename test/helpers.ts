import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";
import type { Word } from "../src/analyze/transcript.ts";
import type { Probe } from "../src/media/ffprobe.ts";
import type { Renderer, RenderJob } from "../src/render/ffmpeg.ts";

export const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
export const CONFIG_DIR = join(REPO_ROOT, "config");

export function tempDir(prefix = "clipfarm-test-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** Load a repo config file as a plain object so a test can tweak it. */
export function repoConfigObject(file: string): any {
  return parse(readFileSync(join(CONFIG_DIR, file), "utf8"));
}

export const toYaml = (obj: unknown): string => stringify(obj);

/** A licensed source, valid as written. Tests change one field at a time. */
export function licensedSource(overrides: Record<string, unknown> = {}): any {
  return {
    id: "creator-a",
    name: "Creator A VODs",
    rights: {
      basis: "license",
      granted_by: "Creator A",
      evidence: "rights/creator-a/permission.pdf",
      platforms: ["youtube"],
      monetization: true,
      credit: "🎥 @creatora",
      ...overrides,
    },
    ingest: { kind: "local-folder", path: "inbox/creator-a" },
    publish_to: ["main"],
  };
}

/** Evenly spoken words: `perSentence` words, then a full stop, one word every `stepMs`. */
export function spokenWords(count: number, opts: { startMs?: number; stepMs?: number; perSentence?: number; firstWord?: string } = {}): Word[] {
  const { startMs = 0, stepMs = 400, perSentence = 8, firstWord } = opts;
  return Array.from({ length: count }, (_, i) => {
    const endOfSentence = (i + 1) % perSentence === 0;
    const base = i === 0 && firstWord ? firstWord : `word${i}`;
    return { text: endOfSentence ? `${base}.` : base, startMs: startMs + i * stepMs, endMs: startMs + i * stepMs + 300 };
  });
}

/** A temp project folder with the repo's config (optionally tweaked) and one fake recording + transcript. */
export function tempProject(opts: { sources?: any; accounts?: any; guardrails?: any; videoIn?: string; words?: Word[] } = {}) {
  const root = tempDir();
  const write = (rel: string, text: string) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  };
  const sources = opts.sources ?? repoConfigObject("sources.yaml");
  write("config/sources.yaml", toYaml(sources));
  write("config/accounts.yaml", toYaml(opts.accounts ?? repoConfigObject("accounts.yaml")));
  write("config/guardrails.yaml", toYaml(opts.guardrails ?? repoConfigObject("guardrails.yaml")));
  const folder = opts.videoIn ?? sources.sources[0].ingest.path;
  write(`${folder}/talk.mp4`, "not a real video; the probe and renderer are faked");
  write(`${folder}/talk.mp4.words.json`, JSON.stringify({ words: opts.words ?? spokenWords(300) }));
  return { root, dataDir: join(root, "data") };
}

export const fakeProbe: Probe = async () => ({ durationMs: 120_000, width: 1920, height: 1080 });

export function fakeRenderer(): Renderer & { jobs: RenderJob[] } {
  const jobs: RenderJob[] = [];
  return {
    jobs,
    async render(job) {
      jobs.push(job);
      mkdirSync(job.outputDir, { recursive: true });
      const path = join(job.outputDir, "clip.mp4");
      writeFileSync(path, "fake clip");
      return path;
    },
  };
}

/** Fake secrets used across tests. None of these may ever appear in output. */
export const FAKE_SECRETS = {
  ANTHROPIC_API_KEY: "anthropic-secret-00000",
  YOUTUBE_CLIENT_SECRET: "youtube-secret-11111",
  TIKTOK_CLIENT_SECRET: "tiktok-secret-22222",
  META_APP_SECRET: "meta-secret-33333",
  POSTING_API_KEY: "posting-secret-44444",
  TELEGRAM_BOT_TOKEN: "123456:telegram-secret-token",
} as const;
