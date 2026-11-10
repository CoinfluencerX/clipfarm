import { existsSync, readFileSync } from "node:fs";

export interface Word {
  text: string;
  startMs: number;
  endMs: number;
}

export interface Transcript {
  words: Word[];
}

/** Turns a recording into word-level timestamps. M2 adds the whisperX runner behind this interface. */
export interface Transcriber {
  /** Null when no transcript is available yet (the media waits and is retried next run). */
  transcribe(mediaPath: string): Promise<Transcript | null>;
}

type RawWord = { word?: unknown; text?: unknown; start?: unknown; end?: unknown; startMs?: unknown; endMs?: unknown };

function toWord(raw: RawWord): Word | null {
  const text = typeof raw.text === "string" ? raw.text : typeof raw.word === "string" ? raw.word : null;
  const startMs = typeof raw.startMs === "number" ? raw.startMs : typeof raw.start === "number" ? raw.start * 1000 : null;
  const endMs = typeof raw.endMs === "number" ? raw.endMs : typeof raw.end === "number" ? raw.end * 1000 : null;
  // whisperX leaves numbers and some symbols without timestamps. They can't be captioned, so they're dropped.
  if (text === null || text.trim() === "" || startMs === null || endMs === null || endMs < startMs) return null;
  return { text: text.trim(), startMs: Math.round(startMs), endMs: Math.round(endMs) };
}

/**
 * Accepts whisperX / faster-whisper JSON ({segments: [{words: [{word, start, end}]}]}, seconds)
 * and the flat form ({words: [{text, startMs, endMs}]}).
 */
export function parseTranscriptJson(text: string): Transcript {
  const data = JSON.parse(text) as { segments?: { words?: RawWord[] }[]; words?: RawWord[] };
  const raw = Array.isArray(data.words) ? data.words : (data.segments ?? []).flatMap((s) => s.words ?? []);
  const words = raw.map(toWord).filter((w): w is Word => w !== null);
  words.sort((a, b) => a.startMs - b.startMs);
  return { words };
}

/** Where a transcript sits next to its video: talk.mp4 → talk.mp4.words.json */
export const sidecarPath = (mediaPath: string): string => `${mediaPath}.words.json`;

/** Reads a transcript someone (you, or whisperX) already wrote next to the video. */
export const sidecarTranscriber: Transcriber = {
  async transcribe(mediaPath) {
    const path = sidecarPath(mediaPath);
    return existsSync(path) ? parseTranscriptJson(readFileSync(path, "utf8")) : null;
  },
};
