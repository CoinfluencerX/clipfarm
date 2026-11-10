import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Word } from "../analyze/transcript.ts";
import { buildAss } from "./captions.ts";
import { cropFor916, OUT_HEIGHT, OUT_WIDTH, type Crop } from "./plan.ts";

export interface RenderJob {
  /** Absolute path of the source recording. */
  input: string;
  /** Folder for this clip's files. Created if missing. */
  outputDir: string;
  startMs: number;
  endMs: number;
  srcWidth: number;
  srcHeight: number;
  words: readonly Word[];
  credit: string | null;
  focusX?: number;
}

export interface Renderer {
  /** Renders the clip and returns the path of the finished file. */
  render(job: RenderJob): Promise<string>;
}

export const CAPTIONS_FILE = "captions.ass";
export const CLIP_FILE = "clip.mp4";

const seconds = (ms: number) => (ms / 1000).toFixed(3);

/**
 * ffmpeg arguments for one clip. Runs with cwd = the clip's folder, so the captions
 * file and the output are plain relative names and nothing needs filter escaping.
 */
export function buildRenderArgs(job: { input: string; startMs: number; endMs: number; crop: Crop }): string[] {
  const { crop } = job;
  return [
    "-hide_banner", "-loglevel", "error", "-y",
    "-ss", seconds(job.startMs), "-to", seconds(job.endMs),
    "-i", job.input,
    "-vf", `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},scale=${OUT_WIDTH}:${OUT_HEIGHT},setsar=1,subtitles=${CAPTIONS_FILE}`,
    "-af", "loudnorm=I=-14:TP=-1.5:LRA=11",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "30",
    "-c:a", "aac", "-b:a", "160k", "-ar", "48000",
    "-movflags", "+faststart",
    CLIP_FILE,
  ];
}

export function ffmpegRenderer(binary = "ffmpeg"): Renderer {
  return {
    render(job) {
      mkdirSync(job.outputDir, { recursive: true });
      writeFileSync(
        join(job.outputDir, CAPTIONS_FILE),
        buildAss({ words: job.words, clipStartMs: job.startMs, clipEndMs: job.endMs, credit: job.credit }),
      );
      const crop = cropFor916(job.srcWidth, job.srcHeight, job.focusX);
      const args = buildRenderArgs({ input: job.input, startMs: job.startMs, endMs: job.endMs, crop });
      return new Promise((resolve, reject) => {
        execFile(binary, args, { cwd: job.outputDir, maxBuffer: 8 * 1024 * 1024 }, (err, _stdout, stderr) => {
          if (err) return reject(new Error(`ffmpeg failed: ${stderr.trim() || err.message}`));
          resolve(join(job.outputDir, CLIP_FILE));
        });
      });
    },
  };
}
