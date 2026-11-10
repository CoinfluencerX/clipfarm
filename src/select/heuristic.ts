import type { Word } from "../analyze/transcript.ts";
import type { Candidate, SelectInput, Selector } from "./types.ts";

/**
 * Free, offline selector. It can't judge whether a moment is funny or useful;
 * it finds windows that start on a sentence, are dense with speech, open on
 * something hook-shaped, and overlap audience-reaction peaks. Good enough to
 * fill a review queue. The Claude selector (M3) replaces the judgment.
 */
const SENTENCE_END = /[.!?]["')\]]?$/;
const PAUSE_MS = 700;
const HOOK_START = /^(how|why|what|here's|here is|this is|the secret|stop|never|nobody|i just|i built|i made|watch|look)\b/i;
const FAST_SPEECH_WPS = 3.5;
const LEAD_IN_MS = 150;
const TAIL_MS = 250;
const TARGET_MS = 45_000;

interface Sentence {
  words: Word[];
  startMs: number;
  endMs: number;
}

export function splitSentences(words: readonly Word[]): Sentence[] {
  const sentences: Sentence[] = [];
  let current: Word[] = [];
  words.forEach((word, i) => {
    current.push(word);
    const next = words[i + 1];
    if (!next || SENTENCE_END.test(word.text) || next.startMs - word.endMs > PAUSE_MS) {
      sentences.push({ words: current, startMs: current[0]!.startMs, endMs: word.endMs });
      current = [];
    }
  });
  return sentences;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const text = (s: Sentence) => s.words.map((w) => w.text).join(" ");

function hookScore(first: Sentence): number {
  const t = text(first);
  return HOOK_START.test(t) || t.endsWith("?") || /\d/.test(t) ? 1 : 0;
}

function shorten(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

export function selectHeuristic(input: SelectInput): Candidate[] {
  const { minMs, maxMs, maxClips } = input.limits;
  const target = Math.min(maxMs, Math.max(minMs, TARGET_MS));
  const sentences = splitSentences(input.transcript.words);
  const candidates: Candidate[] = [];

  for (let i = 0; i < sentences.length; i++) {
    const first = sentences[i]!;
    // Grow the window sentence by sentence; keep the length closest to the target.
    let best: number | null = null;
    for (let j = i; j < sentences.length; j++) {
      const length = sentences[j]!.endMs - first.startMs;
      if (length > maxMs) break;
      if (length < minMs) continue;
      if (best === null || Math.abs(length - target) < Math.abs(sentences[best]!.endMs - first.startMs - target)) best = j;
    }
    if (best === null) continue;

    const last = sentences[best]!;
    const startMs = Math.max(0, first.startMs - LEAD_IN_MS);
    const endMs = Math.min(input.durationMs, last.endMs + TAIL_MS);
    const wordCount = sentences.slice(i, best + 1).reduce((n, s) => n + s.words.length, 0);
    const density = clamp01(wordCount / ((last.endMs - first.startMs) / 1000) / FAST_SPEECH_WPS);
    const peak = clamp01(input.peaks.filter((p) => p.atMs >= startMs && p.atMs <= endMs).reduce((sum, p) => sum + p.strength, 0));
    const score = 0.5 * density + 0.2 * hookScore(first) + 0.3 * peak;
    const title = shorten(text(first), 80);
    candidates.push({ startMs, endMs, score, confidence: score, title, caption: title });
  }

  // Best first, then keep only windows that don't overlap one already kept.
  candidates.sort((a, b) => b.score - a.score || a.startMs - b.startMs);
  const kept: Candidate[] = [];
  for (const c of candidates) {
    if (kept.length >= maxClips) break;
    if (kept.every((k) => c.endMs <= k.startMs || c.startMs >= k.endMs)) kept.push(c);
  }
  return kept.sort((a, b) => a.startMs - b.startMs);
}

export const heuristicSelector: Selector = {
  name: "heuristic",
  select: async (input) => selectHeuristic(input),
};
