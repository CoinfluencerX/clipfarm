import { describe, expect, it } from "vitest";
import { localDay, planSlots, zonedTimeToUtc, type SchedulePolicy } from "../src/publish/scheduler.ts";

const policy: SchedulePolicy = { windows: ["11:00-13:00", "18:00-21:00"], timezone: "America/New_York", maxPerDay: 2, minGapMinutes: 180 };
const iso = (ms: number) => new Date(ms).toISOString();

describe("time zones", () => {
  it("converts local wall time to UTC in winter and summer", () => {
    expect(iso(zonedTimeToUtc(2026, 11, 10, 18, 0, "America/New_York"))).toBe("2026-11-10T23:00:00.000Z"); // EST, UTC-5
    expect(iso(zonedTimeToUtc(2026, 7, 10, 18, 0, "America/New_York"))).toBe("2026-07-10T22:00:00.000Z"); // EDT, UTC-4
  });

  it("names the local day, not the UTC day", () => {
    expect(localDay(Date.parse("2026-11-11T02:00:00Z"), "America/New_York")).toBe("2026-11-10");
  });
});

describe("planSlots", () => {
  const now = Date.parse("2026-11-10T14:00:00Z"); // 09:00 in New York

  it("fills today's windows first, then tomorrow's", () => {
    const slots = planSlots({ now, count: 3, taken: [], policy });
    expect(slots.map(iso)).toEqual(["2026-11-10T16:00:00.000Z", "2026-11-10T23:00:00.000Z", "2026-11-11T16:00:00.000Z"]);
  });

  it("never schedules in the past", () => {
    const afternoon = Date.parse("2026-11-10T19:30:00Z"); // 14:30 local, first window is over
    expect(iso(planSlots({ now: afternoon, count: 1, taken: [], policy })[0]!)).toBe("2026-11-10T23:00:00.000Z");
  });

  it("respects the daily cap, counting posts already taken", () => {
    const taken = [Date.parse("2026-11-10T16:00:00Z"), Date.parse("2026-11-10T23:00:00Z")];
    const [next] = planSlots({ now, count: 1, taken, policy });
    expect(localDay(next!, policy.timezone)).toBe("2026-11-11");
  });

  it("keeps the minimum gap from posts already taken", () => {
    const taken = [Date.parse("2026-11-10T17:30:00Z")]; // 12:30 local
    const [next] = planSlots({ now, count: 1, taken, policy });
    expect(Math.abs(next! - taken[0]!)).toBeGreaterThanOrEqual(180 * 60_000);
  });

  it("holds the cap and the gap across a whole week", () => {
    const slots = planSlots({ now, count: 14, taken: [], policy });
    expect(slots).toHaveLength(14);
    const perDay = new Map<string, number>();
    slots.forEach((s, i) => {
      perDay.set(localDay(s, policy.timezone), (perDay.get(localDay(s, policy.timezone)) ?? 0) + 1);
      if (i > 0) expect(s - slots[i - 1]!).toBeGreaterThanOrEqual(180 * 60_000);
    });
    expect(Math.max(...perDay.values())).toBe(2);
  });

  it("returns fewer slots than asked when the horizon runs out", () => {
    expect(planSlots({ now, count: 10, taken: [], policy, horizonDays: 2 })).toHaveLength(4);
  });
});
