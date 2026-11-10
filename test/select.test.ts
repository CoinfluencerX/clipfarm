import { describe, expect, it } from "vitest";
import { chatPeaks } from "../src/analyze/signals.ts";
import { parseTranscriptJson } from "../src/analyze/transcript.ts";
import { selectHeuristic, splitSentences } from "../src/select/heuristic.ts";
import { maxClipsFor } from "../src/select/types.ts";
import { spokenWords } from "./helpers.ts";

const limits = { minMs: 20_000, maxMs: 60_000, maxClips: 3 };

describe("transcript parsing", () => {
  it("reads whisperX JSON (seconds) and drops words without timestamps", () => {
    const t = parseTranscriptJson(
      JSON.stringify({ segments: [{ words: [{ word: " Hello", start: 0.5, end: 0.9 }, { word: "2026" }, { word: "world.", start: 1.0, end: 1.4 }] }] }),
    );
    expect(t.words).toEqual([
      { text: "Hello", startMs: 500, endMs: 900 },
      { text: "world.", startMs: 1000, endMs: 1400 },
    ]);
  });

  it("reads the flat millisecond form", () => {
    expect(parseTranscriptJson(JSON.stringify({ words: [{ text: "hi", startMs: 10, endMs: 20 }] })).words).toHaveLength(1);
  });
});

describe("sentences", () => {
  it("splits on full stops and on long pauses", () => {
    const words = [
      { text: "One", startMs: 0, endMs: 200 },
      { text: "two.", startMs: 300, endMs: 500 },
      { text: "Three", startMs: 600, endMs: 800 },
      { text: "four", startMs: 2000, endMs: 2200 },
    ];
    expect(splitSentences(words).map((s) => s.words.length)).toEqual([2, 1, 1]);
  });
});

describe("heuristic selector", () => {
  const words = spokenWords(600); // 240 s of steady speech
  const pick = (peaks: Parameters<typeof selectHeuristic>[0]["peaks"] = []) =>
    selectHeuristic({ transcript: { words }, durationMs: 240_000, peaks, limits });

  it("returns clips inside the length limits, in order, never overlapping", () => {
    const clips = pick();
    expect(clips.length).toBeGreaterThan(0);
    expect(clips.length).toBeLessThanOrEqual(limits.maxClips);
    clips.forEach((c, i) => {
      // lead-in and tail padding sit outside the spoken window
      expect(c.endMs - c.startMs).toBeGreaterThanOrEqual(limits.minMs);
      expect(c.endMs - c.startMs).toBeLessThanOrEqual(limits.maxMs + 400);
      if (i > 0) expect(c.startMs).toBeGreaterThanOrEqual(clips[i - 1]!.endMs);
      expect(c.confidence).toBeGreaterThanOrEqual(0);
      expect(c.confidence).toBeLessThanOrEqual(1);
    });
  });

  it("starts every clip on a sentence boundary", () => {
    const starts = new Set(splitSentences(words).map((s) => Math.max(0, s.startMs - 150)));
    for (const c of pick()) expect(starts.has(c.startMs)).toBe(true);
  });

  it("prefers the window the audience reacted to", () => {
    const top = pick([{ atMs: 150_000, strength: 1, kind: "chat" }]).sort((a, b) => b.score - a.score)[0]!;
    expect(top.startMs).toBeLessThanOrEqual(150_000);
    expect(top.endMs).toBeGreaterThanOrEqual(150_000);
  });

  it("returns nothing when the recording is shorter than the minimum clip", () => {
    expect(selectHeuristic({ transcript: { words: spokenWords(10) }, durationMs: 4000, peaks: [], limits })).toEqual([]);
  });

  it("scales the clip count with the length of the recording", () => {
    expect(maxClipsFor(10 * 60_000, 4)).toBe(1);
    expect(maxClipsFor(3 * 3_600_000, 4)).toBe(12);
  });
});

describe("chat peaks", () => {
  it("finds the burst and ignores steady chatter", () => {
    const steady = Array.from({ length: 60 }, (_, i) => i * 10_000 + 1000);
    const burst = Array.from({ length: 40 }, (_, i) => 300_000 + i * 200);
    const peaks = chatPeaks([...steady, ...burst]);
    expect(peaks).toHaveLength(1);
    expect(peaks[0]!.atMs).toBe(305_000);
    expect(chatPeaks(steady)).toEqual([]);
  });
});
