import { describe, expect, it } from "vitest";
import { parseFfprobeJson } from "../src/media/ffprobe.ts";
import { assTime, buildAss, chunkWords } from "../src/render/captions.ts";
import { buildRenderArgs } from "../src/render/ffmpeg.ts";
import { cropFor916 } from "../src/render/plan.ts";

describe("9:16 crop", () => {
  it("centre-crops 16:9 footage to full height", () => {
    expect(cropFor916(1920, 1080)).toEqual({ w: 606, h: 1080, x: 657, y: 0 });
  });

  it("follows the subject but never leaves the frame", () => {
    expect(cropFor916(1920, 1080, 0).x).toBe(0);
    expect(cropFor916(1920, 1080, 1).x).toBe(1920 - 606);
    expect(cropFor916(1920, 1080, 0.25).x).toBe(177);
  });

  it("keeps full width for footage that's already vertical", () => {
    expect(cropFor916(1080, 1920)).toEqual({ w: 1080, h: 1920, x: 0, y: 0 });
    expect(cropFor916(1080, 2340)).toEqual({ w: 1080, h: 1920, x: 0, y: 210 });
  });

  it("always returns even sizes (x264 needs them)", () => {
    const c = cropFor916(1279, 719);
    expect(c.w % 2).toBe(0);
    expect(c.h % 2).toBe(0);
  });
});

describe("captions", () => {
  const words = [
    { text: "This", startMs: 10_000, endMs: 10_200 },
    { text: "is", startMs: 10_250, endMs: 10_400 },
    { text: "the", startMs: 10_450, endMs: 10_600 },
    { text: "moment", startMs: 10_650, endMs: 11_000 },
    { text: "{\\b1}wow", startMs: 13_000, endMs: 13_300 },
    { text: "late", startMs: 20_000, endMs: 20_300 },
  ];

  it("chunks at most three words, timed from the start of the clip", () => {
    const chunks = chunkWords(words, 10_000, 15_000);
    expect(chunks.map((c) => c.text)).toEqual(["This is the", "moment", "{\\b1}wow"]);
    expect(chunks[0]).toMatchObject({ startMs: 0, endMs: 650 });
    expect(chunks.at(-1)!.endMs).toBeLessThanOrEqual(5000);
  });

  it("formats ASS timestamps", () => {
    expect(assTime(0)).toBe("0:00:00.00");
    expect(assTime(61_230)).toBe("0:01:01.23");
    expect(assTime(3_600_000)).toBe("1:00:00.00");
  });

  it("writes upper-case caption lines and strips override codes", () => {
    const ass = buildAss({ words, clipStartMs: 10_000, clipEndMs: 15_000, credit: null });
    expect(ass).toContain("PlayResX: 1080");
    expect(ass).toContain("Dialogue: 0,0:00:00.00,0:00:00.65,Caption,,0,0,0,,THIS IS THE");
    expect(ass).toContain(",,B1WOW");
    expect(ass).not.toContain("LATE");
    expect(ass).not.toContain("Credit,,");
  });

  it("pins the credit line for the whole clip when one is owed", () => {
    const ass = buildAss({ words, clipStartMs: 10_000, clipEndMs: 15_000, credit: "🎥 @creatora" });
    expect(ass).toContain("Dialogue: 1,0:00:00.00,0:00:05.00,Credit,,0,0,0,,🎥 @creatora");
  });
});

describe("ffmpeg arguments", () => {
  it("cuts, crops, scales, burns captions, normalises loudness", () => {
    const args = buildRenderArgs({ input: "/abs/talk.mp4", startMs: 65_250, endMs: 107_000, crop: { w: 606, h: 1080, x: 657, y: 0 } });
    expect(args.slice(args.indexOf("-ss"), args.indexOf("-ss") + 6)).toEqual(["-ss", "65.250", "-to", "107.000", "-i", "/abs/talk.mp4"]);
    expect(args[args.indexOf("-vf") + 1]).toBe("crop=606:1080:657:0,scale=1080:1920,setsar=1,subtitles=captions.ass");
    expect(args[args.indexOf("-af") + 1]).toContain("loudnorm");
    expect(args.at(-1)).toBe("clip.mp4");
  });
});

describe("ffprobe output", () => {
  it("reads duration and frame size", () => {
    const json = JSON.stringify({ streams: [{ codec_type: "audio" }, { codec_type: "video", width: 1920, height: 1080 }], format: { duration: "3723.5" } });
    expect(parseFfprobeJson(json)).toEqual({ durationMs: 3_723_500, width: 1920, height: 1080 });
  });

  it("rejects a file with no video stream", () => {
    expect(() => parseFfprobeJson(JSON.stringify({ streams: [{ codec_type: "audio" }], format: { duration: "10" } }))).toThrow(/no video stream/);
  });
});
