import { describe, it, expect } from "vitest";
import { todayLocal } from "./engines";

/* Guards a whole class of bug: deriving a calendar day by way of UTC.
 *
 * `new Date(...).toISOString().slice(0, 10)` looks like "the date part" and is
 * wrong everywhere east of Greenwich, because it converts to UTC first. In IST
 * (UTC+5:30) it yields YESTERDAY between 00:00 and 05:30 local.
 *
 * Two live consequences, both found by driving the real app:
 *   • dateRange() in repository.js scheduled a 14–15 Nov tournament entirely
 *     on 13 Nov — every match placed a day before the tournament existed.
 *   • PublicDiscovery treated a registration deadline as not-yet-passed for
 *     the first five and a half hours of every day.
 *
 * These tests pin the local-calendar behaviour so neither can come back. They
 * construct dates with explicit local components (new Date(y, m, d, ...)),
 * which is timezone-independent as an *input*, so the assertions hold in CI
 * regardless of the runner's zone.
 */

describe("todayLocal", () => {
  it("returns the local calendar day, not the UTC one", () => {
    // 00:30 local on 14 Nov. In any timezone ahead of UTC this instant is
    // still 13 Nov in UTC — which is exactly what broke the scheduler.
    const justAfterLocalMidnight = new Date(2026, 10, 14, 0, 30, 0);
    expect(todayLocal(justAfterLocalMidnight)).toBe("2026-11-14");
  });

  it("holds at the very start of the local day", () => {
    expect(todayLocal(new Date(2026, 10, 14, 0, 0, 0))).toBe("2026-11-14");
  });

  it("holds at the very end of the local day", () => {
    // 23:59 local. In any timezone behind UTC this is already tomorrow in UTC.
    expect(todayLocal(new Date(2026, 10, 14, 23, 59, 59))).toBe("2026-11-14");
  });

  it("zero-pads month and day", () => {
    expect(todayLocal(new Date(2026, 0, 5, 12, 0, 0))).toBe("2026-01-05");
  });

  it("rolls over correctly at a month boundary", () => {
    expect(todayLocal(new Date(2026, 0, 31, 23, 30, 0))).toBe("2026-01-31");
    expect(todayLocal(new Date(2026, 1, 1, 0, 30, 0))).toBe("2026-02-01");
  });

  it("handles a leap day", () => {
    expect(todayLocal(new Date(2028, 1, 29, 1, 0, 0))).toBe("2028-02-29");
  });

  it("disagrees with the naive UTC slice exactly when it should", () => {
    // This is the bug, stated as a test: at 00:30 local in a UTC+ zone the
    // naive version reports the previous day. Only assert the difference
    // where the runner actually has a positive UTC offset, so this stays
    // meaningful in IST and honest (skipped) elsewhere.
    const d = new Date(2026, 10, 14, 0, 30, 0);
    const naive = d.toISOString().slice(0, 10);
    if (d.getTimezoneOffset() < 0) {
      // Ahead of UTC (e.g. IST): the naive form is a day behind.
      expect(naive).toBe("2026-11-13");
      expect(todayLocal(d)).not.toBe(naive);
    } else {
      // At or behind UTC the two agree at this instant; nothing to prove.
      expect(todayLocal(d)).toBe("2026-11-14");
    }
  });
});
