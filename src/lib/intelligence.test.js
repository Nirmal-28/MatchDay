import { describe, it, expect } from "vitest";
import {
  durationModel, projectedFinish, scheduleDeviation, courtBottlenecks,
  restRisks, officialsGaps, tournamentHealth, matchCountFor, estimateTournament,
} from "./intelligence";

/* The whole point of this module is that it predicts things. A prediction that
   is quietly wrong is worse than an absent one, because an organizer will tell
   players to show up at that time. So these tests assert two properties above
   all: the numbers are right when the data supports them, and the module
   REFUSES to answer when it doesn't. */

const T0 = new Date("2026-03-14T10:00:00Z").getTime();
const iso = (minsFromT0) => new Date(T0 + minsFromT0 * 60000).toISOString();

const court = (id, name, extra = {}) => ({ id, name, status: "AVAILABLE", ...extra });
const match = (id, extra = {}) => ({
  id, is_bye: false, status: "SCHEDULED", round: 1, entry_a: "e1", entry_b: "e2", ...extra,
});
const done = (id, startMins, durMins, extra = {}) =>
  match(id, { status: "COMPLETED", started_at: iso(startMins), completed_at: iso(startMins + durMins), ...extra });

/* ────────────────────────────── duration model ─────────────────────────── */

describe("durationModel", () => {
  it("falls back to the configured duration and says so when nothing has finished", () => {
    const m = durationModel([], { matchDurationMins: 35 });
    expect(m.mins).toBe(35);
    expect(m.basis).toBe("CONFIGURED");
    expect(m.confidence).toBe("LOW");
    expect(m.sample).toBe(0);
  });

  it("uses observed durations once enough matches have finished", () => {
    const matches = [done("a", 0, 30), done("b", 0, 40), done("c", 0, 50), done("d", 0, 40), done("e", 0, 40)];
    const m = durationModel(matches, { matchDurationMins: 90 });
    expect(m.basis).toBe("OBSERVED");
    expect(m.confidence).toBe("HIGH");
    expect(m.mins).toBe(40); // median, not the wildly wrong configured 90
  });

  it("uses the median so one forgotten timer cannot poison the model", () => {
    // Four normal matches plus one that sat 'live' for hours before anyone
    // pressed finish — a real and common data problem.
    const matches = [done("a", 0, 38), done("b", 0, 40), done("c", 0, 42), done("d", 0, 40), done("e", 0, 175)];
    const m = durationModel(matches, {});
    expect(m.mins).toBe(40);
  });

  it("discards impossible durations rather than modelling them", () => {
    const matches = [
      done("a", 0, 40), done("b", 0, 40), done("c", 0, 40),
      done("junk1", 0, 2),    // 2 minutes — not a real match
      done("junk2", 0, 600),  // 10 hours — clock artefact
    ];
    const m = durationModel(matches, {});
    expect(m.sample).toBe(3);
    expect(m.mins).toBe(40);
  });
});

/* ──────────────────────────── projected finish ─────────────────────────── */

describe("projectedFinish", () => {
  it("refuses to project when there is no draw", () => {
    const p = projectedFinish({ matches: [], courts: [court("c1", "Court 1")], now: T0 });
    expect(p.available).toBe(false);
    expect(p.reason).toMatch(/draw/i);
  });

  it("refuses to project when no court is available", () => {
    const p = projectedFinish({
      matches: [match("m1")],
      courts: [court("c1", "Court 1", { status: "UNAVAILABLE" })],
      now: T0,
    });
    expect(p.available).toBe(false);
    expect(p.reason).toMatch(/court/i);
  });

  it("reports completion rather than a future time when everything is done", () => {
    const p = projectedFinish({ matches: [done("a", 0, 40)], courts: [court("c1", "C1")], now: T0 });
    expect(p.complete).toBe(true);
    expect(p.iso).toBe(iso(40));
  });

  it("divides remaining work across courts", () => {
    // 8 matches left, 4 courts, 45 min per slot (40 + 5 buffer) => 2 rounds
    // of work = 90 min. Rounds present = 1, so throughput governs.
    const matches = Array.from({ length: 8 }, (_, i) => match(`m${i}`, { round: 1 }));
    const courts = [court("c1", "1"), court("c2", "2"), court("c3", "3"), court("c4", "4")];
    const p = projectedFinish({ matches, courts, settings: { matchDurationMins: 40, bufferMins: 5 }, now: T0 });
    expect(p.minsRemaining).toBe(90);
    expect(p.limitedBy).toBe("COURTS");
  });

  it("respects the dependency floor when courts are plentiful", () => {
    // 4 matches spread over 4 rounds (a knockout tail). Even with 8 courts
    // they must run in sequence, so the answer is 4 slots, not half of one.
    const matches = [match("m1", { round: 1 }), match("m2", { round: 2 }), match("m3", { round: 3 }), match("m4", { round: 4 })];
    const courts = Array.from({ length: 8 }, (_, i) => court(`c${i}`, `${i}`));
    const p = projectedFinish({ matches, courts, settings: { matchDurationMins: 40, bufferMins: 5 }, now: T0 });
    expect(p.minsRemaining).toBe(180);
    expect(p.limitedBy).toBe("DEPENDENCIES");
  });

  it("counts only the remainder of a match already in progress", () => {
    const matches = [match("m1", { status: "LIVE", started_at: iso(-30) })];
    const p = projectedFinish({
      matches, courts: [court("c1", "1")],
      settings: { matchDurationMins: 40, bufferMins: 5 }, now: T0,
    });
    // 10 min left of the live match, and one round, so the chain floor (45)
    // governs — but crucially it is nowhere near a fresh 45-minute match.
    expect(p.minsRemaining).toBeLessThanOrEqual(45);
    expect(p.remainingMatches).toBe(1);
  });

  it("passes through the confidence of the duration model", () => {
    const p = projectedFinish({
      matches: [match("m1")], courts: [court("c1", "1")],
      settings: { matchDurationMins: 40 }, now: T0,
    });
    expect(p.confidence).toBe("LOW");
    expect(p.basis).toBe("CONFIGURED");
  });
});

/* ─────────────────────────── schedule deviation ────────────────────────── */

describe("scheduleDeviation", () => {
  it("will not claim a trend from fewer than three started matches", () => {
    const matches = [match("m1", { scheduled_at: iso(0), started_at: iso(20) })];
    const d = scheduleDeviation({ matches, now: T0 });
    expect(d.available).toBe(false);
    expect(d.reason).toMatch(/not enough|has started/i);
  });

  it("measures how far behind the tournament is running", () => {
    const matches = [
      match("m1", { scheduled_at: iso(0), started_at: iso(10) }),
      match("m2", { scheduled_at: iso(0), started_at: iso(20) }),
      match("m3", { scheduled_at: iso(0), started_at: iso(30) }),
    ];
    const d = scheduleDeviation({ matches, now: T0 });
    expect(d.available).toBe(true);
    expect(d.minsBehind).toBe(20);
    expect(d.direction).toBe("BEHIND");
  });

  it("recognises running ahead of schedule", () => {
    const matches = [
      match("m1", { scheduled_at: iso(30), started_at: iso(20) }),
      match("m2", { scheduled_at: iso(30), started_at: iso(20) }),
      match("m3", { scheduled_at: iso(30), started_at: iso(20) }),
    ];
    expect(scheduleDeviation({ matches, now: T0 }).direction).toBe("AHEAD");
  });

  it("counts overdue matches separately from deviation", () => {
    // Not started, scheduled 45 min ago.
    const matches = [match("m1", { scheduled_at: iso(-45) })];
    const d = scheduleDeviation({ matches, now: T0 });
    expect(d.overdueCount).toBe(1);
    expect(d.worstOverdueMins).toBe(45);
  });
});

/* ──────────────────────────── court bottlenecks ────────────────────────── */

describe("courtBottlenecks", () => {
  it("says nothing when there is only one court to compare", () => {
    expect(courtBottlenecks({ matches: [match("m1", { court_id: "c1" })], courts: [court("c1", "1")], now: T0 })).toEqual([]);
  });

  it("finds the court carrying materially more work than the others", () => {
    const matches = [
      ...Array.from({ length: 6 }, (_, i) => match(`a${i}`, { court_id: "c1" })),
      match("b1", { court_id: "c2" }),
    ];
    const out = courtBottlenecks({ matches, courts: [court("c1", "Court 1"), court("c2", "Court 2")], now: T0 });
    expect(out).toHaveLength(1);
    expect(out[0].court.name).toBe("Court 1");
    expect(out[0].queued).toBe(6);
  });

  it("flags a live match that has run past the expected length", () => {
    const matches = [
      match("m1", { court_id: "c1", status: "LIVE", started_at: iso(-70) }),
      match("m2", { court_id: "c2" }),
    ];
    const out = courtBottlenecks({
      matches, courts: [court("c1", "Court 1"), court("c2", "Court 2")],
      settings: { matchDurationMins: 40 }, now: T0,
    });
    expect(out[0].court.name).toBe("Court 1");
    expect(out[0].overrunMins).toBe(30);
  });

  it("treats evenly loaded courts as healthy", () => {
    const matches = [
      match("a1", { court_id: "c1" }), match("a2", { court_id: "c1" }),
      match("b1", { court_id: "c2" }), match("b2", { court_id: "c2" }),
    ];
    expect(courtBottlenecks({ matches, courts: [court("c1", "1"), court("c2", "2")], now: T0 })).toEqual([]);
  });
});

/* ───────────────────────────── rest risks ──────────────────────────────── */

describe("restRisks", () => {
  const entries = [
    { id: "e1", entry_players: [{ player_id: "p1", name: "A" }] },
    { id: "e2", entry_players: [{ player_id: "p2", name: "B" }] },
    { id: "e3", entry_players: [{ player_id: "p1", name: "A" }] }, // same person, second category
  ];

  it("flags a player whose next match starts too soon", () => {
    const matches = [
      match("m1", { entry_a: "e1", entry_b: "e2", scheduled_at: iso(0), scheduled_end: iso(40) }),
      match("m2", { entry_a: "e3", entry_b: "e2", scheduled_at: iso(45) }), // only 5 min later
    ];
    const risks = restRisks({ matches, entries, settings: { minRestMins: 20 }, now: T0 });
    // p2 is in both matches too, so both players are genuinely at risk here —
    // the flag is per person, not per match.
    expect(risks.map((r) => r.person).sort()).toEqual(["p1", "p2"]);
    expect(risks.every((r) => r.restMins === 5)).toBe(true);
  });

  it("catches conflicts that span two different categories", () => {
    // p1 plays under e1 and e3 — the entries differ, the person does not.
    const matches = [
      match("m1", { entry_a: "e1", entry_b: "e2", scheduled_at: iso(0), scheduled_end: iso(40) }),
      match("m2", { entry_a: "e3", entry_b: "e2", scheduled_at: iso(50) }),
    ];
    expect(restRisks({ matches, entries, settings: { minRestMins: 30 }, now: T0 }).some((r) => r.person === "p1")).toBe(true);
  });

  it("stays quiet when rest is adequate", () => {
    const matches = [
      match("m1", { entry_a: "e1", entry_b: "e2", scheduled_at: iso(0), scheduled_end: iso(40) }),
      match("m2", { entry_a: "e3", entry_b: "e2", scheduled_at: iso(120) }),
    ];
    expect(restRisks({ matches, entries, settings: { minRestMins: 20 }, now: T0 })).toEqual([]);
  });

  it("ignores completed matches — a played match cannot be rescheduled", () => {
    const matches = [
      { ...done("m1", 0, 40), entry_a: "e1", entry_b: "e2", scheduled_at: iso(0), scheduled_end: iso(40) },
      { ...done("m2", 45, 40), entry_a: "e3", entry_b: "e2", scheduled_at: iso(45) },
    ];
    expect(restRisks({ matches, entries, settings: { minRestMins: 60 }, now: T0 })).toEqual([]);
  });
});

/* ──────────────────────────── officials gaps ───────────────────────────── */

describe("officialsGaps", () => {
  it("does not apply when the tournament never assigns officials", () => {
    const out = officialsGaps({ matches: [match("m1", { status: "LIVE" })], members: [], now: T0 });
    expect(out.applicable).toBe(false);
    expect(out.matches).toEqual([]);
  });

  it("applies once the tournament has scorers on staff", () => {
    const out = officialsGaps({
      matches: [match("m1", { status: "LIVE" })],
      members: [{ role: "SCORER" }],
      now: T0,
    });
    expect(out.applicable).toBe(true);
    expect(out.matches).toHaveLength(1);
  });

  it("only looks at matches inside the horizon", () => {
    const matches = [
      match("soon", { scheduled_at: iso(30) }),
      match("later", { scheduled_at: iso(600) }),
    ];
    const out = officialsGaps({ matches, members: [{ role: "REFEREE" }], now: T0, horizonMins: 90 });
    expect(out.matches.map((m) => m.id)).toEqual(["soon"]);
  });

  it("does not flag a match that already has someone assigned", () => {
    const out = officialsGaps({
      matches: [match("m1", { status: "LIVE", scorer_id: "u1" })],
      members: [{ role: "SCORER" }], now: T0,
    });
    expect(out.matches).toEqual([]);
  });
});

/* ─────────────────────────── the health report ─────────────────────────── */

describe("tournamentHealth", () => {
  const base = {
    tournament: { status: "LIVE", schedule_published: true, settings: { matchDurationMins: 40, bufferMins: 5, minRestMins: 20 } },
    courts: [court("c1", "Court 1"), court("c2", "Court 2")],
    entries: [
      { id: "e1", reg_status: "CONFIRMED", check_in_status: "CHECKED_IN", entry_players: [{ player_id: "p1" }] },
      { id: "e2", reg_status: "CONFIRMED", check_in_status: "CHECKED_IN", entry_players: [{ player_id: "p2" }] },
    ],
    now: T0,
  };

  it("reports a healthy tournament as on track with no issues", () => {
    const h = tournamentHealth({
      ...base,
      matches: [done("m1", -60, 40, { court_id: "c1", scheduled_at: iso(-60) }), match("m2", { court_id: "c2", scheduled_at: iso(30) })],
    });
    expect(h.status).toBe("ON_TRACK");
    expect(h.progress).toEqual({ completed: 1, total: 2, pct: 50 });
    expect(h.checkIn.pct).toBe(100);
  });

  it("escalates to at-risk when something is badly overdue", () => {
    const h = tournamentHealth({ ...base, matches: [match("m1", { scheduled_at: iso(-45), court_id: "c1" })] });
    expect(h.status).toBe("AT_RISK");
    expect(h.issues.some((i) => i.key === "overdue" && i.severity === "CRITICAL")).toBe(true);
  });

  it("recommends publishing before anything else when players are blind", () => {
    const h = tournamentHealth({
      ...base,
      tournament: { ...base.tournament, schedule_published: false },
      matches: [match("m1", { scheduled_at: iso(30), court_id: "c1" })],
    });
    expect(h.recommendation.action).toBe("PUBLISH_SCHEDULE");
  });

  it("prioritises scheduling matches that have no time at all", () => {
    const h = tournamentHealth({ ...base, matches: [match("m1", { scheduled_at: null })] });
    expect(h.recommendation.action).toBe("OPTIMIZE_SCHEDULE");
    expect(h.issues.some((i) => i.key === "unscheduled")).toBe(true);
  });

  it("gives no recommendation when there is genuinely nothing to do", () => {
    const h = tournamentHealth({
      ...base,
      matches: [done("m1", -60, 40, { court_id: "c1" }), done("m2", -60, 40, { court_id: "c2" })],
    });
    expect(h.recommendation).toBeNull();
    expect(h.finish.complete).toBe(true);
  });

  it("never invents a check-in percentage with no participants", () => {
    const h = tournamentHealth({ ...base, entries: [], matches: [match("m1", { scheduled_at: iso(30) })] });
    expect(h.checkIn.pct).toBeNull();
  });
});

/* ──────────────────────── organizer-facing estimates ───────────────────── */

describe("matchCountFor", () => {
  it("counts a single-elimination draw", () => {
    expect(matchCountFor({ format: "SINGLE_ELIM", entries: 16 })).toBe(15);
    expect(matchCountFor({ format: "SINGLE_ELIM", entries: 12 })).toBe(11); // byes play no match
  });

  it("counts a round robin", () => {
    expect(matchCountFor({ format: "ROUND_ROBIN", entries: 6 })).toBe(15);
    expect(matchCountFor({ format: "ROUND_ROBIN", entries: 4 })).toBe(6);
  });

  it("counts groups plus the knockout they feed", () => {
    // 16 in 4 groups of 4 = 4 x 6 = 24 group matches; top 2 each = 8-slot
    // knockout = 7 more.
    expect(matchCountFor({ format: "GROUP_KO", entries: 16, groupCount: 4, advancePerGroup: 2 })).toBe(31);
  });

  it("handles groups that do not divide evenly", () => {
    // 10 across 3 groups => sizes 4,3,3 => 6 + 3 + 3 = 12 group matches,
    // plus a 8-slot knockout (top 2 of 3 groups = 6 -> 8) = 7.
    expect(matchCountFor({ format: "GROUP_KO", entries: 10, groupCount: 3, advancePerGroup: 2 })).toBe(19);
  });

  it("returns zero rather than a negative for an empty draw", () => {
    expect(matchCountFor({ format: "SINGLE_ELIM", entries: 1 })).toBe(0);
    expect(matchCountFor({ format: "SINGLE_ELIM", entries: 0 })).toBe(0);
  });
});

describe("estimateTournament", () => {
  it("estimates a tournament that comfortably fits", () => {
    const e = estimateTournament({
      categories: [{ category: "MS", maxEntries: 16, format: "SINGLE_ELIM" }],
      courtsCount: 4, matchDurationMins: 40, bufferMins: 5, startTime: "09:00", endTime: "21:00",
    });
    expect(e.totalMatches).toBe(15);
    expect(e.fits).toBe(true);
    expect(e.warnings).toEqual([]);
    // 12-hour clock with AM/PM — a bare "09:34" is ambiguous, and this is the
    // number an organizer repeats verbatim to every player.
    expect(e.estimatedFinish).toMatch(/^\d{1,2}:\d{2} (AM|PM)$/);
  });

  it("states the finish time with AM/PM even when it lands in the morning", () => {
    const e = estimateTournament({
      categories: [{ category: "MS", maxEntries: 4, format: "SINGLE_ELIM" }],
      courtsCount: 4, matchDurationMins: 40, bufferMins: 5, startTime: "00:00", endTime: "21:00",
    });
    // 4 entries is a 2-round chain (semis, then final) — 2 x 45 min from
    // midnight, so the dependency floor governs even with courts to spare.
    expect(e.estimatedFinish).toBe("1:30 AM");
  });

  it("warns — with a concrete fix — when the day is too short", () => {
    const e = estimateTournament({
      categories: [{ category: "MS", maxEntries: 64, format: "ROUND_ROBIN" }],
      courtsCount: 2, matchDurationMins: 40, startTime: "09:00", endTime: "17:00",
    });
    expect(e.fits).toBe(false);
    expect(e.warnings[0]).toMatch(/court-hours/);
    expect(e.recommendedCourts).toBeGreaterThan(2);
  });

  it("notices that rounds cannot be parallelised away", () => {
    // A 64-draw knockout is 6 sequential rounds; at 45 min a round that is
    // 4.5 hours minimum however many courts are thrown at it.
    const e = estimateTournament({
      categories: [{ category: "MS", maxEntries: 64, format: "SINGLE_ELIM" }],
      courtsCount: 40, matchDurationMins: 40, startTime: "09:00", endTime: "12:00",
    });
    expect(e.warnings.some((w) => /one after another/i.test(w))).toBe(true);
  });

  it("says there is nothing to estimate rather than guessing", () => {
    const e = estimateTournament({ categories: [], courtsCount: 4 });
    expect(e.totalMatches).toBe(0);
    expect(e.fits).toBe(false);
    expect(e.warnings[0]).toMatch(/nothing to estimate/i);
  });

  it("adds up across several categories", () => {
    const e = estimateTournament({
      categories: [
        { category: "MS", maxEntries: 16, format: "SINGLE_ELIM" },   // 15
        { category: "WS", maxEntries: 8, format: "SINGLE_ELIM" },    // 7
        { category: "MD", maxEntries: 4, format: "ROUND_ROBIN" },    // 6
      ],
      courtsCount: 4, matchDurationMins: 40, startTime: "09:00", endTime: "21:00",
    });
    expect(e.totalMatches).toBe(28);
    expect(e.perCategory).toHaveLength(3);
  });
});
