// Series standings test suite.
//
// Pure Node script — seriesStandings.js and ranking.js have no Supabase or
// browser dependency, so the aggregation can be exercised directly. This
// matters because no live tournament yet spans multiple matchdays, so without
// this the cross-matchday maths would ship unverified.
//
// The fixtures here are test inputs to a pure function; nothing is written to
// the database. Run with: npm run test:series
import { computeSeriesStandings, playerSeriesPosition, SERIES_SCORING } from "../src/lib/seriesStandings.js";

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  ok  - ${name}`); }
  else { fail++; console.log(`FAIL  - ${name}${detail ? `  (${detail})` : ""}`); }
}
function section(title) { console.log(`\n${title}`); }

/* A two-matchday series.
   Matchday 1 (T1): 4-entry knockout, total_rounds 2. Alice beats Bob in the
                    semi, then beats Cara in the final -> Alice is champion.
   Matchday 2 (T2): 4-entry knockout. Bob beats Alice in the semi, then loses
                    the final to Cara -> Cara is champion.
   Dan enters T2 only and loses his first match.                             */
const tournaments = [
  { id: "T1", name: "Matchday 1", series_round: 1, start_date: "2026-03-01", status: "COMPLETED" },
  { id: "T2", name: "Matchday 2", series_round: 2, start_date: "2026-04-01", status: "COMPLETED" },
];

const eventById = {
  E1: { id: "E1", tournament_id: "T1", total_rounds: 2, champion_entry_id: "a1" },
  E2: { id: "E2", tournament_id: "T2", total_rounds: 2, champion_entry_id: "c2" },
};
const tournamentByEvent = { E1: "T1", E2: "T2" };

// entry id -> player id. Each player gets a fresh entry per matchday, which is
// exactly how the real schema works.
const entryToPlayer = {
  a1: "alice", b1: "bob", c1: "cara",
  a2: "alice", b2: "bob", c2: "cara", d2: "dan",
};

const entries = [
  { id: "a1", event_id: "E1", reg_status: "CONFIRMED" },
  { id: "b1", event_id: "E1", reg_status: "CONFIRMED" },
  { id: "c1", event_id: "E1", reg_status: "CONFIRMED" },
  { id: "a2", event_id: "E2", reg_status: "CONFIRMED" },
  { id: "b2", event_id: "E2", reg_status: "CONFIRMED" },
  { id: "c2", event_id: "E2", reg_status: "CONFIRMED" },
  { id: "d2", event_id: "E2", reg_status: "CONFIRMED" },
];

const matches = [
  // Matchday 1
  { id: "m1", event_id: "E1", round: 1, status: "COMPLETED", entry_a: "a1", entry_b: "b1", winner_entry_id: "a1", completed_at: "2026-03-01T10:00:00Z" },
  { id: "m2", event_id: "E1", round: 2, status: "COMPLETED", entry_a: "a1", entry_b: "c1", winner_entry_id: "a1", completed_at: "2026-03-01T12:00:00Z" },
  // Matchday 2
  { id: "m3", event_id: "E2", round: 1, status: "COMPLETED", entry_a: "b2", entry_b: "a2", winner_entry_id: "b2", completed_at: "2026-04-01T10:00:00Z" },
  { id: "m4", event_id: "E2", round: 1, status: "COMPLETED", entry_a: "c2", entry_b: "d2", winner_entry_id: "c2", completed_at: "2026-04-01T10:30:00Z" },
  { id: "m5", event_id: "E2", round: 2, status: "COMPLETED", entry_a: "c2", entry_b: "b2", winner_entry_id: "c2", completed_at: "2026-04-01T12:00:00Z" },
];

const players = [
  { id: "alice", name: "Alice" }, { id: "bob", name: "Bob" },
  { id: "cara", name: "Cara" }, { id: "dan", name: "Dan" },
];

const data = { series: { id: "S1", sport: "badminton" }, tournaments, events: Object.values(eventById), matches, entries, players, entryToPlayer, eventById, tournamentByEvent };
const row = (t, id) => t.find((r) => r.playerId === id);

/* ---------------------------------------------------------------------- */
section("Test 1 — standard scoring aggregates across matchdays");
{
  const { table, playedMatchdays } = computeSeriesStandings(data, { scoring: "standard" });
  check("both matchdays counted as played", playedMatchdays === 2, `got ${playedMatchdays}`);
  check("all four players appear", table.length === 4, `got ${table.length}`);
  check("positions are 1..n with no gaps", table.every((r, i) => r.position === i + 1));

  const alice = row(table, "alice");
  check("Alice played 2 matchdays", alice.matchdays === 2, `got ${alice.matchdays}`);
  check("Alice has 3 matches (2 + 1)", alice.matches === 3, `got ${alice.matches}`);
  check("Alice 2W 1L", alice.won === 2 && alice.lost === 1, `${alice.won}W ${alice.lost}L`);
  check("Alice has exactly 1 title", alice.titles === 1, `got ${alice.titles}`);

  const cara = row(table, "cara");
  check("Cara has 1 title (matchday 2)", cara.titles === 1, `got ${cara.titles}`);
  check("Cara reached 2 finals", cara.finals === 2, `got ${cara.finals}`);

  const dan = row(table, "dan");
  check("Dan played 1 matchday", dan.matchdays === 1, `got ${dan.matchdays}`);
  check("Dan has 0 wins", dan.won === 0, `got ${dan.won}`);
  check("Dan is placed last", dan.position === table.length, `got ${dan.position}`);
}

section("Test 2 — a title is never double counted");
{
  const { table } = computeSeriesStandings(data, { scoring: "standard" });
  const total = table.reduce((n, r) => n + r.titles, 0);
  check("exactly 2 titles across the series (one per matchday)", total === 2, `got ${total}`);
}

section("Test 3 — points arithmetic is exactly the config, not a fudge");
{
  const cfg = SERIES_SCORING.winsOnly; // perWin 100, everything else 0
  const { table } = computeSeriesStandings(data, { scoring: "winsOnly" });
  const alice = row(table, "alice");
  check("winsOnly gives Alice exactly 2 x perWin", alice.points === 2 * cfg.perWin, `got ${alice.points}`);
  const dan = row(table, "dan");
  check("winsOnly gives a winless player 0", dan.points === 0, `got ${dan.points}`);
}

section("Test 4 — scoring model changes the order, not the data");
{
  const std = computeSeriesStandings(data, { scoring: "standard" }).table;
  const att = computeSeriesStandings(data, { scoring: "attendance" }).table;
  check("attendance model excludes single-matchday players (minMatchdays 2)",
    !att.some((r) => r.playerId === "dan"), "Dan should be filtered out");
  check("standard model includes them", std.some((r) => r.playerId === "dan"));
  check("attendance reports the exclusion rather than hiding it",
    computeSeriesStandings(data, { scoring: "attendance" }).excludedBelowMinimum === 1);
  check("match counts are identical across models",
    row(std, "alice").matches === row(att, "alice").matches);
}

section("Test 5 — unplayed matchdays contribute nothing");
{
  const withFuture = {
    ...data,
    tournaments: [...tournaments, { id: "T3", name: "Matchday 3", series_round: 3, start_date: "2026-05-01", status: "REGISTRATION_OPEN" }],
    entries: [...entries, { id: "a3", event_id: "E3", reg_status: "CONFIRMED" }],
    entryToPlayer: { ...entryToPlayer, a3: "alice" },
    eventById: { ...eventById, E3: { id: "E3", tournament_id: "T3", total_rounds: 2 } },
    tournamentByEvent: { ...tournamentByEvent, E3: "T3" },
  };
  const before = computeSeriesStandings(data, { scoring: "standard" });
  const after = computeSeriesStandings(withFuture, { scoring: "standard" });
  check("played matchday count is unchanged by a scheduled-but-unplayed one",
    after.playedMatchdays === before.playedMatchdays, `${after.playedMatchdays} vs ${before.playedMatchdays}`);
  check("an entry in an unplayed matchday adds no points",
    row(after.table, "alice").points === row(before.table, "alice").points);
  check("an entry in an unplayed matchday adds no matchday credit",
    row(after.table, "alice").matchdays === row(before.table, "alice").matchdays);
}

section("Test 6 — rejected and cancelled entries are excluded");
{
  const withDropouts = {
    ...data,
    entries: [...entries, { id: "x2", event_id: "E2", reg_status: "REJECTED" }],
    entryToPlayer: { ...entryToPlayer, x2: "eve" },
    players: [...players, { id: "eve", name: "Eve" }],
  };
  const { table } = computeSeriesStandings(withDropouts, { scoring: "standard" });
  check("a rejected entry does not create a standings row", !table.some((r) => r.playerId === "eve"));
}

section("Test 7 — movement is only reported when it can be derived");
{
  // After matchday 2 there is a previous table to compare against.
  const bob = playerSeriesPosition(data, "bob", { scoring: "standard" });
  check("a player present in the table gets their row", !!bob.mine);
  check("movement is a number once two matchdays have been played",
    typeof bob.movement === "number", `got ${bob.movement}`);

  // With only matchday 1 played there is no previous position to compare to.
  const onlyOne = {
    ...data,
    tournaments: [tournaments[0]],
    matches: matches.filter((m) => tournamentByEvent[m.event_id] === "T1"),
    entries: entries.filter((e) => tournamentByEvent[e.event_id] === "T1"),
  };
  const single = playerSeriesPosition(onlyOne, "alice", { scoring: "standard" });
  check("movement is null with only one played matchday", single.movement === null, `got ${single.movement}`);
  check("a player absent from the series gets mine=null",
    playerSeriesPosition(data, "nobody", { scoring: "standard" }).mine === null);
}

section("Test 8 — empty and malformed inputs do not throw");
{
  let threw = null;
  try {
    const empty = computeSeriesStandings({ matches: [], entries: [], players: [], eventById: {}, tournamentByEvent: {} }, {});
    check("empty series yields an empty table", empty.table.length === 0);
    check("empty series reports 0 played matchdays", empty.playedMatchdays === 0);
    computeSeriesStandings(null, {});
    computeSeriesStandings(undefined, {});
  } catch (e) { threw = e; }
  check("null/undefined data is handled without throwing", threw === null, threw?.message);
}

console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail === 0 ? 0 : 1);
