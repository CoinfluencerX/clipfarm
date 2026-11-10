import { execFile } from "node:child_process";

export interface MediaInfo {
  durationMs: number;
  width: number;
  height: number;
}

/** Reads duration and frame size. Injected everywhere, so tests never need a real video. */
export type Probe = (path: string) => Promise<MediaInfo>;

export function parseFfprobeJson(text: string): MediaInfo {
  const data = JSON.parse(text) as {
    streams?: { codec_type?: string; width?: number; height?: number }[];
    format?: { duration?: string };
  };
  const video = data.streams?.find((s) => s.codec_type === "video");
  const seconds = Number(data.format?.duration);
  if (!video?.width || !video.height || !Number.isFinite(seconds) || seconds <= 0) {
    throw new Error("ffprobe output has no video stream or no duration");
  }
  return { durationMs: Math.round(seconds * 1000), width: video.width, height: video.height };
}

export function ffprobe(binary = "ffprobe"): Probe {
  return (path) =>
    new Promise((resolve, reject) => {
      execFile(
        binary,
        ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", path],
        { maxBuffer: 8 * 1024 * 1024 },
        (err, stdout) => {
          if (err) return reject(new Error(`ffprobe failed for ${path}: ${err.message}`));
          try {
            resolve(parseFfprobeJson(stdout));
          } catch (e) {
            reject(new Error(`${(e as Error).message}: ${path}`));
          }
        },
      );
    });
}
