import { describe, it, expect } from "vitest";
import { relativeTime } from "./engines";
import { fmtClock } from "./intelligence";

/* Regression guards for two formatters that were technically correct and
   practically useless far from "now".

   Observed in the live Control Center: Up Next rows reading "Court 1 · in 80d"
   for a tournament in November, and Tournament Health reporting a projected
   finish of "4:14 am" for a tournament whose first match is 9:00 am — because
   a bare clock time silently reads as *today*. */

const AT = (s) => new Date(s).getTime();
const NOW = AT("2026-08-25T10:00:00");

describe("relativeTime", () => {
  it("stays relative near the event, which is where it reads best", () => {
    expect(relativeTime("2026-08-25T10:25:00", NOW)).toBe("in 25 min");
    expect(relativeTime("2026-08-25T09:48:00", NOW)).toBe("12 min ago");
    expect(relativeTime("2026-08-25T14:00:00", NOW)).toBe("in 4h");
  });

  it("switches to a date once relative time stops being useful", () => {
    // The bug: this used to render "in 80d".
    const out = relativeTime("2026-11-14T09:00:00", NOW);
    expect(out).not.toMatch(/\d+d/);
    expect(out).toMatch(/Nov/);
  });

  it("uses a date for anything past the ~18h horizon", () => {
    // 20 hours out is tomorrow; "in 20h" makes the reader do that conversion.
    const out = relativeTime("2026-08-26T06:00:00", NOW);
    expect(out).toMatch(/Aug/);
    expect(out).not.toMatch(/in \d+h/);
  });

  it("keeps the hour form right up to the horizon", () => {
    expect(relativeTime("2026-08-26T02:00:00", NOW)).toBe("in 16h");
  });

  it("includes the year only when it differs", () => {
    expect(relativeTime("2026-11-14T09:00:00", NOW)).not.toMatch(/2026/);
    expect(relativeTime("2027-02-01T09:00:00", NOW)).toMatch(/2027/);
  });

  it("handles past dates beyond the horizon too", () => {
    expect(relativeTime("2026-01-10T09:00:00", NOW)).toMatch(/Jan/);
  });

  it("returns empty for missing or unparseable input rather than NaN", () => {
    expect(relativeTime(null, NOW)).toBe("");
    expect(relativeTime("", NOW)).toBe("");
    expect(relativeTime("not-a-date", NOW)).toBe("");
  });
});

describe("fmtClock", () => {
  it("stays terse on the day itself — the tournament-day case", () => {
    const out = fmtClock("2026-08-25T18:42:00", NOW);
    expect(out).toMatch(/6:42/);
    expect(out).not.toMatch(/Aug/);
  });

  it("adds the date when it is NOT today, so it cannot read as tonight", () => {
    // The bug: a finish months away rendered as a bare "6:20 pm".
    const out = fmtClock("2026-11-14T18:20:00", NOW);
    expect(out).toMatch(/Nov/);
    expect(out).toMatch(/6:20/);
  });

  it("adds the date for tomorrow as well as for months away", () => {
    expect(fmtClock("2026-08-26T09:00:00", NOW)).toMatch(/Aug/);
  });

  it("returns a dash for missing or unparseable input", () => {
    expect(fmtClock(null, NOW)).toBe("—");
    expect(fmtClock("nonsense", NOW)).toBe("—");
  });
});
