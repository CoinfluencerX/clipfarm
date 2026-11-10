/**
 * Picks posting times for one account. Pure: give it what's already taken and it
 * returns the next free slots inside the posting windows, never more than the daily
 * cap and never closer together than the minimum gap.
 */
export interface SchedulePolicy {
  /** Local windows like "18:00-21:00". */
  windows: readonly string[];
  timezone: string;
  maxPerDay: number;
  minGapMinutes: number;
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function localParts(instantMs: number, timezone: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(instantMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

/** Local calendar day of an instant, as YYYY-MM-DD. */
export function localDay(instantMs: number, timezone: string): string {
  const p = localParts(instantMs, timezone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** The instant at which the wall clock in `timezone` reads the given local time. */
export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timezone: string): number {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const offsetAt = (instant: number) => {
    const p = localParts(instant, timezone);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(instant / 1000) * 1000;
  };
  const first = wall - offsetAt(wall);
  // Second pass fixes the days when the offset changes (daylight saving).
  return wall - offsetAt(first);
}

function parseWindow(window: string): { startMin: number; endMin: number } {
  const m = /^(\d\d):(\d\d)-(\d\d):(\d\d)$/.exec(window);
  if (!m) throw new Error(`Bad posting window "${window}"`);
  return { startMin: Number(m[1]) * 60 + Number(m[2]), endMin: Number(m[3]) * 60 + Number(m[4]) };
}

export function planSlots(opts: { now: number; count: number; taken: readonly number[]; policy: SchedulePolicy; horizonDays?: number }): number[] {
  const { policy } = opts;
  const gapMs = policy.minGapMinutes * 60_000;
  const windows = policy.windows.map(parseWindow).sort((a, b) => a.startMin - b.startMin);
  const all = [...opts.taken];
  const perDay = new Map<string, number>();
  for (const t of all) {
    const day = localDay(t, policy.timezone);
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }

  const slots: number[] = [];
  const today = localParts(opts.now, policy.timezone);
  for (let d = 0; d < (opts.horizonDays ?? 60) && slots.length < opts.count; d++) {
    // Date.UTC normalises day overflow, which gives us "today + d" as a calendar date.
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day + d));
    const [y, mo, da] = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
    for (const w of windows) {
      for (let minute = w.startMin; minute <= w.endMin && slots.length < opts.count; minute += policy.minGapMinutes) {
        const at = zonedTimeToUtc(y, mo, da, Math.floor(minute / 60), minute % 60, policy.timezone);
        const day = localDay(at, policy.timezone);
        if (at <= opts.now) continue;
        if ((perDay.get(day) ?? 0) >= policy.maxPerDay) continue;
        if (all.some((t) => Math.abs(t - at) < gapMs)) continue;
        slots.push(at);
        all.push(at);
        perDay.set(day, (perDay.get(day) ?? 0) + 1);
      }
    }
  }
  return slots;
}
