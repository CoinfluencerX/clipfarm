import type { SignalPeak } from "../analyze/signals.ts";
import type { Transcript } from "../analyze/transcript.ts";

export interface SelectInput {
  transcript: Transcript;
  durationMs: number;
  peaks: readonly SignalPeak[];
  limits: { minMs: number; maxMs: number; maxClips: number };
}

export interface Candidate {
  startMs: number;
  endMs: number;
  /** Ranking score, 0..1. */
  score: number;
  /** How sure the selector is that this stands alone as a clip, 0..1. Auto-review compares against this. */
  confidence: number;
  title: string;
  caption: string;
}

/** Picks the moments worth cutting. The heuristic ships now; the Claude selector (M3) implements the same interface. */
export interface Selector {
  /** Stored with each segment, e.g. "heuristic" or "claude:<model>". */
  readonly name: string;
  select(input: SelectInput): Promise<Candidate[]>;
}

/** How many clips one recording may yield. */
export function maxClipsFor(durationMs: number, maxPerSourceHour: number): number {
  return Math.max(1, Math.ceil((durationMs / 3_600_000) * maxPerSourceHour));
}
