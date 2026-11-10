import type { Word } from "../analyze/transcript.ts";
import { OUT_HEIGHT, OUT_WIDTH } from "./plan.ts";

const MAX_WORDS = 3;
const MAX_CHUNK_MS = 1500;
const MAX_GAP_MS = 500;

export interface CaptionChunk {
  text: string;
  startMs: number;
  endMs: number;
}

/** Groups words into short on-screen chunks, timed relative to the start of the clip. */
export function chunkWords(words: readonly Word[], clipStartMs: number, clipEndMs: number): CaptionChunk[] {
  const inside = words.filter((w) => w.startMs >= clipStartMs && w.startMs < clipEndMs);
  const groups: Word[][] = [];
  for (const word of inside) {
    const group = groups.at(-1);
    const first = group?.[0];
    const last = group?.at(-1);
    if (group && first && last && group.length < MAX_WORDS && word.startMs - last.endMs <= MAX_GAP_MS && word.endMs - first.startMs <= MAX_CHUNK_MS) {
      group.push(word);
    } else {
      groups.push([word]);
    }
  }
  return groups.map((group, i) => {
    const nextStart = groups[i + 1]?.[0]?.startMs;
    // Hold each chunk until the next one starts, so captions don't flicker between words.
    const end = Math.min(nextStart ?? group.at(-1)!.endMs, group.at(-1)!.endMs + MAX_GAP_MS, clipEndMs);
    return {
      text: group.map((w) => w.text).join(" "),
      startMs: group[0]!.startMs - clipStartMs,
      endMs: Math.max(end, group[0]!.startMs + 1) - clipStartMs,
    };
  });
}

/** ASS timestamp: H:MM:SS.cc */
export function assTime(ms: number): string {
  const cs = Math.max(0, Math.round(ms / 10));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${Math.floor(cs / 360_000)}:${pad(Math.floor(cs / 6000) % 60)}:${pad(Math.floor(cs / 100) % 60)}.${pad(cs % 100)}`;
}

/** Text can't open an override block or break the line format. */
const assText = (s: string) => s.replace(/[{}\\]/g, "").replace(/\s+/g, " ").trim();

/**
 * Burned-in captions as an ASS file: big centred word chunks, plus the credit line
 * pinned to the top for the whole clip when one is owed.
 */
export function buildAss(opts: { words: readonly Word[]; clipStartMs: number; clipEndMs: number; credit: string | null }): string {
  const lines = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${OUT_WIDTH}`,
    `PlayResY: ${OUT_HEIGHT}`,
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Caption,Arial,88,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,6,2,2,60,60,440,1",
    "Style: Credit,Arial,40,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,3,1,8,40,40,70,1",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  if (opts.credit) {
    lines.push(`Dialogue: 1,${assTime(0)},${assTime(opts.clipEndMs - opts.clipStartMs)},Credit,,0,0,0,,${assText(opts.credit)}`);
  }
  for (const chunk of chunkWords(opts.words, opts.clipStartMs, opts.clipEndMs)) {
    lines.push(`Dialogue: 0,${assTime(chunk.startMs)},${assTime(chunk.endMs)},Caption,,0,0,0,,${assText(chunk.text).toUpperCase()}`);
  }
  return lines.join("\n") + "\n";
}
