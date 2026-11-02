// createTournamentFromPlan() against a small in-memory stand-in for the
// Supabase query builder (same approach as scoring.repository.test.js). The
// promise being pinned down: what the preview showed is what gets saved, and a
// failure partway never leads to a second tournament.
import { describe, it, expect, beforeEach, vi } from "vitest";

const tables = ["tournaments", "courts", "tournament_events", "entries", "entry_players", "matches", "court_availability", "schedule_audit_log"];
const db = {};
let failOn = null; // { table, op }

function makeQuery(table) {
  const q = { op: "select", filters: [], payload: null, single: false, count: false };
  const run = () => {
    if (failOn && failOn.table === table && failOn.op === q.op) {
      failOn = null;
      return { data: null, error: { message: "Network request failed" } };
    }
    const hit = () => db[table].filter((r) => q.filters.every((f) => f(r)));
    if (q.op === "insert") {
      const added = (Array.isArray(q.payload) ? q.payload : [q.payload]).map((row) => {
        const status = table === "courts" ? "AVAILABLE" : "DRAFT"; // the column defaults
        const full = { id: crypto.randomUUID(), status, created_at: new Date().toISOString(), ...row };
        db[table].push(full);
        return full;
      });
      return { data: q.single ? added[0] : added, error: null };
    }
    if (q.op === "update") {
      const rows = hit();
      rows.forEach((r) => Object.assign(r, q.payload));
      return { data: q.single ? rows[0] ?? null : rows, error: null };
    }
    const rows = hit().map((r) => ({ ...r }));
    if (q.count) return { data: null, count: rows.length, error: null };
    if (table === "tournament_events") rows.sort((a, b) => a.sort_order - b.sort_order);
    return { data: q.single ? rows[0] ?? null : rows, error: null };
  };
  const api = {
    select(_, opts) { if (opts?.count) q.count = true; return api; },
    insert(p) { q.op = "insert"; q.payload = p; return api; },
    update(p) { q.op = "update"; q.payload = p; return api; },
    eq(c, v) { q.filters.push((r) => r[c] === v); return api; },
    in(c, vs) { q.filters.push((r) => vs.includes(r[c])); return api; },
    not() { return api; },
    order() { return api; },
    single() { q.single = true; return api; },
    then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
  };
  return api;
}

vi.mock("./supabaseClient", () => ({
  supabase: {
    from: (t) => makeQuery(t),
    auth: { getSession: async () => ({ data: { session: { user: { id: "owner-1" }, access_token: "t" } } }) },
    rpc: async () => ({ data: null, error: null }),
  },
}));

const { createTournamentFromPlan } = await import("./repository");
const { buildPlan } = await import("./assistantPlan");

const draft = {
  tournament: { name: "Sunday Doubles", venue: "Smash Arena", startDate: "2026-11-08", courts: 2 },
  categories: [
    { category: "MD", format: "GROUP_KO", groupCount: 2, entries: ["Rahul / Arjun", "Kiran / Ravi", "Sneha / Divya", "Priya / Meera", "Ajith / Vijay", "Suresh / Dinesh"] },
    { category: "MS", format: "SINGLE_ELIM", entries: ["Rahul", "Arjun", "Kiran"] },
  ],
};

const nameOf = (entryId) => db.entry_players.filter((p) => p.entry_id === entryId).map((p) => p.name).join(" / ");
const savedPairs = (eventId) => db.matches
  .filter((m) => m.event_id === eventId && m.round === 1 && !m.group_label ? true : m.event_id === eventId && m.group_label)
  .map((m) => [m.entry_a ? nameOf(m.entry_a) : "bye", m.entry_b ? nameOf(m.entry_b) : "bye"]);
const plannedPairs = (category) => category.drawPlan.matches
  .map((m) => m.sides.map((s) => (s ? s.players.map((p) => p.name).join(" / ") : "bye")));

beforeEach(() => {
  tables.forEach((t) => { db[t] = []; });
  failOn = null;
});

describe("createTournamentFromPlan", () => {
  it("saves exactly the matches the preview showed", async () => {
    const plan = buildPlan(draft);
    expect(plan.ready).toBe(true);
    await createTournamentFromPlan(plan);

    const [doubles, singles] = db.tournament_events;
    expect(savedPairs(doubles.id)).toEqual(plannedPairs(plan.categories[0]));
    expect(savedPairs(singles.id)).toEqual(plannedPairs(plan.categories[1]));
  });

  it("creates each player once, confirmed, with no phone number", async () => {
    await createTournamentFromPlan(buildPlan(draft));
    expect(db.entries).toHaveLength(9);
    expect(db.entries.every((e) => e.reg_status === "CONFIRMED")).toBe(true);
    expect(db.entry_players.every((p) => p.phone === null)).toBe(true);
  });

  it("leaves the tournament ready to start, with a public page and a schedule", async () => {
    const { tournament } = await createTournamentFromPlan(buildPlan(draft));
    const saved = db.tournaments.find((t) => t.id === tournament.id);
    expect(saved.status).toBe("REGISTRATION_CLOSED");
    expect(saved.slug).toMatch(/^sunday-doubles-/);
    expect(saved.schedule_published).toBe(true);
    expect(db.courts).toHaveLength(2);
    expect(db.matches.filter((m) => m.group_label).every((m) => m.court)).toBe(true);
  });

  it("opens the courts for an evening tournament, so it still gets a schedule", async () => {
    await createTournamentFromPlan(buildPlan({ ...draft, tournament: { ...draft.tournament, startTime: "18:30" } }));
    expect(db.courts.every((c) => c.available_start === "18:30" && c.available_end === "23:00")).toBe(true);
    expect(db.matches.filter((m) => m.group_label).every((m) => m.court)).toBe(true);
  });

  it("carries the assumed match format into the tournament's settings", async () => {
    await createTournamentFromPlan(buildPlan(draft));
    expect(db.tournaments[0].settings).toMatchObject({ gamesPerMatch: 3, pointsPerGame: 21, startTime: "09:00", courtsCount: 2 });
  });

  it("reports a failed draw without throwing, so a retry can't make a second tournament", async () => {
    failOn = { table: "matches", op: "insert" };
    const result = await createTournamentFromPlan(buildPlan(draft));
    expect(result.failed).toContain("Network request failed");
    expect(result.tournament.id).toBeTruthy();
    expect(db.tournaments).toHaveLength(1);
  });

  it("throws when nothing was created yet, so the organizer can simply try again", async () => {
    failOn = { table: "tournaments", op: "insert" };
    await expect(createTournamentFromPlan(buildPlan(draft))).rejects.toBeTruthy();
    expect(db.tournaments).toHaveLength(0);
  });
});
