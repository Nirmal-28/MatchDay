// Scheduling engine test suite (Sprint 1, section 31).
// Pure Node script — no Supabase/browser needed since schedulingEngine.js has
// zero external dependencies. Run with: npm run test:scheduling
import {
  generateSchedule, detectConflicts, findBetterSlots, scoreScheduleQuality, recheckAfterMove,
} from "../src/lib/schedulingEngine.js";

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  ok  - ${name}`); }
  else { fail++; console.log(`FAIL  - ${name}${detail ? `  (${detail})` : ""}`); }
}
function section(title) { console.log(`\n${title}`); }

const BASE_CONSTRAINTS = {
  date: "2026-09-05", tournamentStart: "09:00", tournamentEnd: "18:00",
  durationMins: 30, bufferMins: 10, minRestMins: 30,
};
const court = (id, name, overrides = {}) => ({ id, name, active: true, availableStart: "09:00", availableEnd: "18:00", ...overrides });
const match = (id, overrides = {}) => ({
  id, eventId: "ev1", round: 1, matchNumber: id, participantIds: [], dependsOn: [],
  status: "PENDING", locked: false, priority: "NORMAL", scheduledStart: null, scheduledEnd: null, courtId: null,
  ...overrides,
});

/* Test 1: 4 players, 2 courts */
section("Test 1 — 4 players, 2 courts");
{
  const courts = [court("c1", "Court 1"), court("c2", "Court 2")];
  const matches = [
    match(1, { participantIds: ["p1", "p2"] }),
    match(2, { participantIds: ["p3", "p4"] }),
  ];
  const { matches: out, conflicts } = generateSchedule(matches, courts, BASE_CONSTRAINTS);
  check("both matches scheduled", out.every((m) => m.scheduledStart && m.courtId));
  check("no hard conflicts", conflicts.filter((c) => c.severity === "HARD").length === 0);
  check("matches land on different courts (parallel)", out[0].courtId !== out[1].courtId);
}

/* Test 2: 8 players, 2 courts */
section("Test 2 — 8 players, 2 courts");
{
  const courts = [court("c1", "Court 1"), court("c2", "Court 2")];
  const matches = [1, 2, 3, 4].map((i) => match(i, { participantIds: [`p${i}a`, `p${i}b`] }));
  const { matches: out, conflicts } = generateSchedule(matches, courts, BASE_CONSTRAINTS);
  check("all 4 matches scheduled", out.every((m) => m.scheduledStart));
  check("no hard conflicts", conflicts.filter((c) => c.severity === "HARD").length === 0);
  const courtsUsed = new Set(out.map((m) => m.courtId));
  check("both courts used", courtsUsed.size === 2);
}

/* Test 3: 16 players, 4 courts */
section("Test 3 — 16 players, 4 courts");
{
  const courts = [1, 2, 3, 4].map((i) => court(`c${i}`, `Court ${i}`));
  const matches = Array.from({ length: 8 }, (_, i) => match(i + 1, { participantIds: [`p${i}a`, `p${i}b`] }));
  const { matches: out, conflicts } = generateSchedule(matches, courts, BASE_CONSTRAINTS);
  check("all 8 matches scheduled", out.every((m) => m.scheduledStart));
  check("no hard conflicts", conflicts.filter((c) => c.severity === "HARD").length === 0);
  check("finishes in one round of slots (2 waves x 4 courts)", new Set(out.map((m) => m.scheduledStart)).size <= 2);
}

/* Test 4: same player in two matches -> must detect conflict */
section("Test 4 — same player double-booked");
{
  const courts = [court("c1", "Court 1"), court("c2", "Court 2")];
  const t0 = new Date(`2026-09-05T10:00:00`);
  const matches = [
    match(1, { participantIds: ["shared", "p2"], scheduledStart: t0.toISOString(), scheduledEnd: new Date(t0.getTime() + 30 * 60000).toISOString(), courtId: "c1" }),
    match(2, { participantIds: ["shared", "p3"], scheduledStart: new Date(t0.getTime() + 10 * 60000).toISOString(), scheduledEnd: new Date(t0.getTime() + 40 * 60000).toISOString(), courtId: "c2" }),
  ];
  const conflicts = detectConflicts(matches, courts, BASE_CONSTRAINTS);
  check("player conflict detected", conflicts.some((c) => c.type === "PLAYER_CONFLICT" && c.severity === "HARD"));
}

/* Test 5: same court, overlapping matches -> must detect conflict */
section("Test 5 — same court overlap");
{
  const courts = [court("c1", "Court 1")];
  const t0 = new Date(`2026-09-05T10:00:00`);
  const matches = [
    match(1, { participantIds: ["p1", "p2"], scheduledStart: t0.toISOString(), scheduledEnd: new Date(t0.getTime() + 30 * 60000).toISOString(), courtId: "c1" }),
    match(2, { participantIds: ["p3", "p4"], scheduledStart: new Date(t0.getTime() + 15 * 60000).toISOString(), scheduledEnd: new Date(t0.getTime() + 45 * 60000).toISOString(), courtId: "c1" }),
  ];
  const conflicts = detectConflicts(matches, courts, BASE_CONSTRAINTS);
  check("court conflict detected", conflicts.some((c) => c.type === "COURT_CONFLICT" && c.severity === "HARD"));
}

/* Test 6: insufficient rest -> warning */
section("Test 6 — insufficient player rest");
{
  const courts = [court("c1", "Court 1"), court("c2", "Court 2")];
  const t0 = new Date(`2026-09-05T10:00:00`);
  const matches = [
    match(1, { participantIds: ["shared", "p2"], scheduledStart: t0.toISOString(), scheduledEnd: new Date(t0.getTime() + 30 * 60000).toISOString(), courtId: "c1" }),
    match(2, { participantIds: ["shared", "p3"], scheduledStart: new Date(t0.getTime() + 45 * 60000).toISOString(), scheduledEnd: new Date(t0.getTime() + 75 * 60000).toISOString(), courtId: "c2" }),
  ];
  const conflicts = detectConflicts(matches, courts, BASE_CONSTRAINTS);
  const restConflict = conflicts.find((c) => c.type === "REST_VIOLATION");
  check("rest violation detected", !!restConflict);
  check("rest violation is a WARNING not HARD", restConflict?.severity === "WARNING");
}

/* Test 7: court unavailable at scheduled time */
section("Test 7 — court unavailable");
{
  const courts = [court("c1", "Court 1", { availableStart: "09:00", availableEnd: "14:00" })];
  const t0 = new Date(`2026-09-05T14:20:00`);
  const matches = [match(1, { participantIds: ["p1", "p2"], scheduledStart: t0.toISOString(), scheduledEnd: new Date(t0.getTime() + 30 * 60000).toISOString(), courtId: "c1" })];
  const conflicts = detectConflicts(matches, courts, BASE_CONSTRAINTS);
  check("court unavailable conflict detected", conflicts.some((c) => c.type === "COURT_UNAVAILABLE" && c.severity === "HARD"));
}

/* Test 8: match scheduled after tournament closing time */
section("Test 8 — outside tournament hours");
{
  const courts = [court("c1", "Court 1")];
  const t0 = new Date(`2026-09-05T18:10:00`);
  const matches = [match(1, { participantIds: ["p1", "p2"], scheduledStart: t0.toISOString(), scheduledEnd: new Date(t0.getTime() + 30 * 60000).toISOString(), courtId: "c1" })];
  const conflicts = detectConflicts(matches, courts, BASE_CONSTRAINTS);
  check("outside tournament hours conflict detected", conflicts.some((c) => c.type === "TOURNAMENT_WINDOW" && c.severity === "HARD"));
}

/* Test 9: locked match must not be moved by the optimizer */
section("Test 9 — locked match stays put");
{
  const courts = [court("c1", "Court 1"), court("c2", "Court 2")];
  const lockedStart = new Date(`2026-09-05T11:00:00`);
  const matches = [
    match(1, {
      participantIds: ["p1", "p2"], locked: true, status: "SCHEDULED",
      scheduledStart: lockedStart.toISOString(), scheduledEnd: new Date(lockedStart.getTime() + 30 * 60000).toISOString(), courtId: "c1",
    }),
    match(2, { participantIds: ["p3", "p4"] }),
  ];
  const { matches: out } = generateSchedule(matches, courts, BASE_CONSTRAINTS);
  const lockedAfter = out.find((m) => m.id === 1);
  check("locked match keeps its original time", lockedAfter.scheduledStart === lockedStart.toISOString());
  check("locked match keeps its original court", lockedAfter.courtId === "c1");
  check("other match still got scheduled", out.find((m) => m.id === 2).scheduledStart != null);
}

/* Test 10: partial recheck only flags matches connected to the change */
section("Test 10 — partial recheck scope");
{
  const courts = [court("c1", "Court 1"), court("c2", "Court 2"), court("c3", "Court 3")];
  const t0 = new Date(`2026-09-05T10:00:00`);
  const matches = [
    match(1, { participantIds: ["p1", "p2"], scheduledStart: t0.toISOString(), scheduledEnd: new Date(t0.getTime() + 30 * 60000).toISOString(), courtId: "c1" }),
    match(2, { participantIds: ["p3", "p4"], scheduledStart: new Date(t0.getTime() + 10 * 60000).toISOString(), scheduledEnd: new Date(t0.getTime() + 40 * 60000).toISOString(), courtId: "c1" }), // overlaps match 1 on same court
    match(3, { participantIds: ["p5", "p6"], scheduledStart: new Date(t0.getTime() + 120 * 60000).toISOString(), scheduledEnd: new Date(t0.getTime() + 150 * 60000).toISOString(), courtId: "c3" }), // unrelated
  ];
  const { affectedConflicts } = recheckAfterMove(matches, courts, BASE_CONSTRAINTS, 1);
  check("affected set includes the court conflict with match 2", affectedConflicts.some((c) => c.matchId === 1 || c.relatedMatchId === 1));
  check("affected set excludes unrelated match 3's conflicts", !affectedConflicts.some((c) => c.matchId === 3 || c.relatedMatchId === 3));
}

/* Test 11: knockout dependency — SF must not be schedulable before its QFs */
section("Test 11 — knockout dependency");
{
  const courts = [court("c1", "Court 1"), court("c2", "Court 2")];
  const qf1 = match(1, { round: 1, participantIds: ["p1", "p2"] });
  const qf2 = match(2, { round: 1, participantIds: ["p3", "p4"] });
  const sf = match(3, { round: 2, participantIds: [], dependsOn: [1, 2] }); // participants unknown yet
  const { matches: out } = generateSchedule([qf1, qf2, sf], courts, BASE_CONSTRAINTS);
  const sfAfter = out.find((m) => m.id === 3);
  check("SF with unknown participants is left unscheduled by the optimizer", sfAfter.scheduledStart == null);

  // Now simulate QFs completed and SF participants resolved — SF must be
  // placeable, and if scheduled before QFs finish it must be flagged.
  const qf1Done = { ...qf1, status: "COMPLETED", scheduledStart: new Date("2026-09-05T09:00:00").toISOString(), scheduledEnd: new Date("2026-09-05T09:30:00").toISOString(), courtId: "c1" };
  const qf2Done = { ...qf2, status: "COMPLETED", scheduledStart: new Date("2026-09-05T09:00:00").toISOString(), scheduledEnd: new Date("2026-09-05T09:30:00").toISOString(), courtId: "c2" };
  const sfTooEarly = { ...sf, participantIds: ["p1", "p3"], scheduledStart: new Date("2026-09-05T09:10:00").toISOString(), scheduledEnd: new Date("2026-09-05T09:40:00").toISOString(), courtId: "c1" };
  const conflicts = detectConflicts([qf1Done, qf2Done, sfTooEarly], courts, BASE_CONSTRAINTS);
  check("SF scheduled before QFs would finish has no dependency violation once QFs are COMPLETED", !conflicts.some((c) => c.type === "DEPENDENCY_VIOLATION"));

  const qf1Live = { ...qf1Done, status: "LIVE" };
  const conflicts2 = detectConflicts([qf1Live, qf2Done, sfTooEarly], courts, BASE_CONSTRAINTS);
  check("SF overlapping an unfinished QF IS flagged as dependency violation", conflicts2.some((c) => c.type === "DEPENDENCY_VIOLATION" && c.matchId === 3));
}

/* Test 12: multi-category participant conflict (badminton section 32) */
section("Test 12 — multi-category player conflict");
{
  const courts = [court("c1", "Court 1"), court("c2", "Court 2")];
  const t0 = new Date(`2026-09-05T10:00:00`);
  // Nirmal plays Men's Singles (ev1) and Men's Doubles (ev2) — different
  // events, same player id, overlapping times => must still be flagged.
  const matches = [
    match(1, { eventId: "ev-singles", participantIds: ["nirmal"], scheduledStart: t0.toISOString(), scheduledEnd: new Date(t0.getTime() + 30 * 60000).toISOString(), courtId: "c1" }),
    match(2, { eventId: "ev-doubles", participantIds: ["nirmal", "partner"], scheduledStart: new Date(t0.getTime() + 15 * 60000).toISOString(), scheduledEnd: new Date(t0.getTime() + 45 * 60000).toISOString(), courtId: "c2" }),
  ];
  const conflicts = detectConflicts(matches, courts, BASE_CONSTRAINTS);
  check("cross-category player conflict detected", conflicts.some((c) => c.type === "PLAYER_CONFLICT" && c.playerId === "nirmal"));
}

/* Bonus: findBetterSlots and scoreScheduleQuality don't crash and return sane shapes */
section("Bonus — findBetterSlots / scoreScheduleQuality sanity");
{
  const courts = [court("c1", "Court 1"), court("c2", "Court 2")];
  const t0 = new Date(`2026-09-05T10:00:00`);
  const matches = [
    match(1, { participantIds: ["p1", "p2"], scheduledStart: t0.toISOString(), scheduledEnd: new Date(t0.getTime() + 30 * 60000).toISOString(), courtId: "c1" }),
    match(2, { participantIds: ["p1", "p3"], scheduledStart: new Date(t0.getTime() + 10 * 60000).toISOString(), scheduledEnd: new Date(t0.getTime() + 40 * 60000).toISOString(), courtId: "c2" }),
  ];
  const alts = findBetterSlots(2, matches, courts, BASE_CONSTRAINTS, 3);
  check("returns at least one alternative slot", alts.length > 0);
  check("alternatives are sorted by score ascending", alts.every((a, i) => i === 0 || a.score >= alts[i - 1].score));

  const quality = scoreScheduleQuality(matches, courts, BASE_CONSTRAINTS);
  check("quality score is within 0-100", quality.score >= 0 && quality.score <= 100);
  check("quality reports hard conflict count", typeof quality.hardConflicts === "number");
}

/* Test 13: multi-day scheduling — more matches than one day can hold spill to day 2 */
section("Test 13 — multi-day scheduling");
{
  const courts = [court("c1", "Court 1")];
  const constraints = {
    dates: ["2026-09-05", "2026-09-06"], tournamentStart: "09:00", tournamentEnd: "09:40",
    durationMins: 20, bufferMins: 5, minRestMins: 10,
  };
  // 3 matches, 1 court, a 40-min single-day window (fits ~1.6 matches/day) -> must spill to day 2.
  const matches = [1, 2, 3].map((i) => match(i, { participantIds: [`p${i}a`, `p${i}b`] }));
  const { matches: out, conflicts, unresolved } = generateSchedule(matches, courts, constraints);
  check("all 3 matches scheduled across two days", out.every((m) => m.scheduledStart) && unresolved.length === 0);
  const dates = new Set(out.map((m) => m.scheduledStart.slice(0, 10)));
  check("matches actually span both days", dates.has("2026-09-05") && dates.has("2026-09-06"));
  check("no hard conflicts", conflicts.filter((c) => c.severity === "HARD").length === 0);
}

/* Test 14: multi-day — per-court date override is respected */
section("Test 14 — multi-day court availability override");
{
  const courts = [{
    id: "c1", name: "Court 1", active: true, availableStart: "09:00", availableEnd: "18:00",
    availabilityByDate: { "2026-09-06": { start: "09:00", end: "10:00" } }, // day 2 closes early
  }];
  const constraints = {
    dates: ["2026-09-06"], tournamentStart: "09:00", tournamentEnd: "18:00",
    durationMins: 20, bufferMins: 5, minRestMins: 10,
  };
  const t0 = new Date("2026-09-06T10:20:00");
  const matches = [match(1, { participantIds: ["p1", "p2"], scheduledStart: t0.toISOString(), scheduledEnd: new Date(t0.getTime() + 20 * 60000).toISOString(), courtId: "c1" })];
  const conflicts = detectConflicts(matches, courts, constraints);
  check("match outside the per-date court override window is flagged", conflicts.some((c) => c.type === "COURT_UNAVAILABLE"));
}

console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail > 0 ? 1 : 0);
