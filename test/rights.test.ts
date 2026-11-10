import { describe, expect, it } from "vitest";
import { parseYamlConfig } from "../src/config/load.ts";
import { SourcesSchema } from "../src/config/schemas.ts";
import { buildCaption, checkIngest, checkPublish, creditLine, utcDay } from "../src/rights/gate.ts";
import { licensedSource, toYaml } from "./helpers.ts";

const source = (overrides: Record<string, unknown> = {}) =>
  parseYamlConfig(toYaml({ sources: [licensedSource(overrides)] }), SourcesSchema, "sources.yaml").sources[0]!;
const own = parseYamlConfig(toYaml({ sources: [{ ...licensedSource(), rights: { basis: "own" } }] }), SourcesSchema, "sources.yaml").sources[0]!;

describe("rights gate", () => {
  it("your own footage is allowed everywhere, with no credit line", () => {
    expect(checkIngest(own, "2030-01-01")).toEqual({ ok: true });
    expect(checkPublish(own.rights, own.id, "tiktok", "2030-01-01")).toEqual({ ok: true });
    expect(creditLine(own.rights)).toBeNull();
    expect(buildCaption("My build", own.rights)).toBe("My build");
  });

  it("a license only covers the platforms it names", () => {
    const s = source({ platforms: ["youtube", "tiktok"] });
    expect(checkPublish(s.rights, s.id, "youtube", "2026-11-10")).toEqual({ ok: true });
    expect(checkPublish(s.rights, s.id, "instagram", "2026-11-10")).toEqual({ ok: false, reason: `permission for "creator-a" doesn't cover instagram` });
  });

  it("stops ingest and publishing the day after a permission expires", () => {
    const s = source({ expires: "2026-12-31" });
    expect(checkIngest(s, "2026-12-31").ok).toBe(true);
    expect(checkPublish(s.rights, s.id, "youtube", "2026-12-31").ok).toBe(true);
    expect(checkIngest(s, "2027-01-01")).toEqual({ ok: false, reason: `permission for "creator-a" expired on 2026-12-31` });
    expect(checkPublish(s.rights, s.id, "youtube", "2027-01-01").ok).toBe(false);
  });

  it("adds the credit line to every licensed caption, once", () => {
    const s = source();
    expect(buildCaption("He actually did it", s.rights)).toBe("He actually did it\n\n🎥 @creatora");
    expect(buildCaption("", s.rights)).toBe("🎥 @creatora");
    expect(buildCaption("He did it 🎥 @creatora", s.rights)).toBe("He did it 🎥 @creatora");
  });

  it("utcDay formats a date as YYYY-MM-DD", () => {
    expect(utcDay(new Date("2026-11-10T23:59:59Z"))).toBe("2026-11-10");
  });
});
