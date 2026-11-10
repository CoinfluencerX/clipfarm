/** A moment the audience reacted to. Selection gives windows that contain peaks a higher score. */
export interface SignalPeak {
  atMs: number;
  /** 0..1 */
  strength: number;
  kind: "chat" | "audio" | "community-clip";
}

/**
 * Chat-rate spikes: buckets whose message count sits well above the stream's average.
 * `timestampsMs` are message times relative to the start of the recording.
 */
export function chatPeaks(timestampsMs: readonly number[], bucketMs = 10_000): SignalPeak[] {
  if (timestampsMs.length === 0) return [];
  const last = Math.max(...timestampsMs);
  const counts = new Array<number>(Math.floor(last / bucketMs) + 1).fill(0);
  for (const t of timestampsMs) {
    if (t >= 0) counts[Math.floor(t / bucketMs)]!++;
  }
  const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
  const std = Math.sqrt(counts.reduce((a, c) => a + (c - mean) ** 2, 0) / counts.length);
  if (std === 0) return [];
  const peaks: SignalPeak[] = [];
  counts.forEach((count, i) => {
    const z = (count - mean) / std;
    if (z >= 2) peaks.push({ atMs: i * bucketMs + bucketMs / 2, strength: Math.min(1, z / 4), kind: "chat" });
  });
  return peaks;
}
