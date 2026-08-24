import { describe, it, expect } from "vitest";
import { commandCenter } from "./analytics";

/* Regression guard for a contradiction visible on one screen.

   The Command Center header read "Courts free 0" directly above a Court
   Status panel listing two idle courts as NEXT UP. `courtsFree` counted only
   the AVAILABLE state, which excludes a court whose next match is merely
   booked — so a court doing nothing for the next three months counted as
   busy. The header was the panel that was wrong. */

const T0 = new Date("2026-08-25T10:00:00").getTime();
const iso = (m) => new Date(T0 + m * 60000).toISOString();

const base = {
  tournament: { status: "LIVE", schedule_published: true, settings: {} },
  events: [{ id: "e1" }],
  entries: [],
  now: T0,
};
const courts = [
  { id: "c1", name: "Court 1", status: "AVAILABLE" },
  { id: "c2", name: "Court 2", status: "AVAILABLE" },
];
const match = (id, extra) => ({
  id, event_id: "e1", is_bye: false, status: "SCHEDULED",
  entry_a: "a", entry_b: "b", round: 1, ...extra,
});

describe("courtsFree", () => {
  it("counts a court with only a future booking as free right now", () => {
    // Both courts have a match booked but nothing is being played.
    const cc = commandCenter({
      ...base, courts,
      matches: [
        match("m1", { court_id: "c1", scheduled_at: iso(60) }),
        match("m2", { court_id: "c2", scheduled_at: iso(60) }),
      ],
    });
    expect(cc.courtsFree).toBe(2);
    expect(cc.courtsBusy).toBe(0);
  });

  it("does not count a court that is actually in play", () => {
    const cc = commandCenter({
      ...base, courts,
      matches: [
        match("m1", { court_id: "c1", status: "LIVE", started_at: iso(-10) }),
        match("m2", { court_id: "c2", scheduled_at: iso(60) }),
      ],
    });
    expect(cc.courtsBusy).toBe(1);
    expect(cc.courtsFree).toBe(1);
  });

  it("does not count a closed court as free", () => {
    const cc = commandCenter({
      ...base,
      courts: [courts[0], { id: "c2", name: "Court 2", status: "UNAVAILABLE" }],
      matches: [match("m1", { court_id: "c1", scheduled_at: iso(60) })],
    });
    expect(cc.courtsFree).toBe(1);
  });

  it("free + in-play never exceeds the courts that exist", () => {
    const cc = commandCenter({
      ...base, courts,
      matches: [
        match("m1", { court_id: "c1", status: "LIVE", started_at: iso(-5) }),
        match("m2", { court_id: "c2", scheduled_at: iso(30) }),
      ],
    });
    expect(cc.courtsFree + cc.courtsBusy).toBeLessThanOrEqual(courts.length);
  });

  it("reports every court free when nothing is scheduled at all", () => {
    const cc = commandCenter({ ...base, courts, matches: [] });
    expect(cc.courtsFree).toBe(2);
  });
});
