// Regression tests for the scoring writes in repository.js, against a small
// in-memory stand-in for the Supabase query builder. They pin down three bugs
// that reached production code:
//
//   1. retireMatch() crowned a "champion" and closed the whole division when a
//      player retired in ANY round-robin or group match.
//   2. startMatch()/retireMatch()/undoLastGame() resolved even when the write
//      failed, so the offline queue deleted actions it had never delivered.
//   3. A game that closed without its follow-up write left the match stuck
//      between games: every later tap returned early.
import { describe, it, expect, beforeEach, vi } from "vitest";

const db = { matches: [], games: [], tournament_events: [] };
let failNext = null; // { table, op } -> the next matching call resolves with an error

function makeQuery(table) {
  const q = { table, op: "select", filters: [], payload: null, single: false, embedGames: false };
  const run = () => {
    if (failNext && failNext.table === table && failNext.op === q.op) {
      failNext = null;
      return { data: null, error: { message: "TypeError: Failed to fetch" } };
    }
    const rows = db[table];
    const match = (r) => q.filters.every(([c, v]) => r[c] === v);
    if (q.op === "insert") {
      const list = Array.isArray(q.payload) ? q.payload : [q.payload];
      for (const row of list) {
        if (table === "games" && rows.some((g) => g.match_id === row.match_id && g.game_number === row.game_number)) {
          return { data: null, error: { code: "23505", message: "duplicate key" } };
        }
        rows.push({ id: crypto.randomUUID(), ...row });
      }
      return { data: null, error: null };
    }
    if (q.op === "update") {
      const hit = rows.filter(match);
      hit.forEach((r) => Object.assign(r, q.payload));
      return { data: q.single ? hit[0] ?? null : hit, error: null };
    }
    if (q.op === "delete") {
      db[table] = rows.filter((r) => !match(r));
      return { data: null, error: null };
    }
    let out = rows.filter(match).map((r) => ({ ...r }));
    if (q.embedGames) out = out.map((m) => ({ ...m, games: db.games.filter((g) => g.match_id === m.id).map((g) => ({ ...g })) }));
    return { data: q.single ? out[0] ?? null : out, error: null };
  };
  const api = {
    // After update(), select() only asks for the row back; the op stays "update".
    select(cols = "*") { q.embedGames = /games\(/.test(cols); return api; },
    insert(p) { q.op = "insert"; q.payload = p; return api; },
    update(p) { q.op = "update"; q.payload = p; return api; },
    delete() { q.op = "delete"; return api; },
    eq(c, v) { q.filters.push([c, v]); return api; },
    single() { q.single = true; return api; },
    maybeSingle() { q.single = true; return api; },
    order() { return api; },
    then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
  };
  return api;
}

vi.mock("./supabaseClient", () => ({
  supabase: {
    from: (t) => makeQuery(t),
    // Behave like a project where migration 010 is not applied yet, so the
    // client-side increment path is exercised.
    rpc: async () => ({ data: null, error: { code: "PGRST202", message: "score_point_atomic not found" } }),
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel: async () => {},
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  },
}));

const { startMatch, scorePoint, retireMatch, undoLastGame } = await import("./repository");

function seedMatch(patch = {}) {
  const m = {
    id: crypto.randomUUID(), event_id: "ev1", round: 1, match_number: 1,
    entry_a: "A", entry_b: "B", status: "READY", next_match_id: null, next_slot: null,
    group_label: null, winner_entry_id: null, ...patch,
  };
  db.matches.push(m);
  return m;
}

beforeEach(() => {
  db.matches = []; db.games = [];
  db.tournament_events = [{ id: "ev1", status: "LIVE", champion_entry_id: null }];
  failNext = null;
});

describe("retireMatch", () => {
  it("does not crown a champion when a round-robin match ends in retirement", async () => {
    const m = seedMatch({ group_label: "RR", status: "LIVE" });
    seedMatch({ group_label: "RR", entry_a: "A", entry_b: "C", status: "READY", match_number: 2 });
    await retireMatch(m.id, "A");
    expect(db.matches[0]).toMatchObject({ status: "COMPLETED", winner_entry_id: "B", retired: true });
    expect(db.tournament_events[0]).toMatchObject({ status: "LIVE", champion_entry_id: null });
  });

  it("does not crown a champion from a group-stage retirement", async () => {
    const m = seedMatch({ group_label: "A", status: "LIVE" });
    await retireMatch(m.id, "B");
    expect(db.tournament_events[0].champion_entry_id).toBeNull();
  });

  it("advances the winner and marks a fully-filled, scheduled next match READY", async () => {
    const next = seedMatch({ id: "final", round: 2, entry_a: "C", entry_b: null, status: "SCHEDULED", scheduled_at: "2026-11-14T10:00:00Z" });
    const m = seedMatch({ status: "LIVE", next_match_id: next.id, next_slot: "B" });
    await retireMatch(m.id, "A");
    expect(db.matches.find((x) => x.id === "final")).toMatchObject({ entry_b: "B", status: "READY" });
  });

  it("is a no-op when replayed on a match that is already decided", async () => {
    const m = seedMatch({ status: "COMPLETED", winner_entry_id: "A" });
    await retireMatch(m.id, "A");
    expect(db.matches[0].winner_entry_id).toBe("A");
  });

  it("still crowns the champion when the knockout final ends in retirement", async () => {
    const m = seedMatch({ status: "LIVE" });
    await retireMatch(m.id, "B");
    expect(db.tournament_events[0]).toMatchObject({ status: "COMPLETED", champion_entry_id: "A" });
  });
});

describe("writes reject on failure so the offline queue keeps them", () => {
  it("startMatch throws when the status update fails", async () => {
    const m = seedMatch();
    failNext = { table: "matches", op: "update" };
    await expect(startMatch(m.id)).rejects.toThrow(/Failed to fetch/);
  });

  it("retireMatch throws when the result write fails", async () => {
    const m = seedMatch({ status: "LIVE" });
    failNext = { table: "matches", op: "update" };
    await expect(retireMatch(m.id, "A")).rejects.toThrow(/Failed to fetch/);
  });

  it("undoLastGame throws when the read fails", async () => {
    const m = seedMatch({ status: "LIVE" });
    failNext = { table: "matches", op: "select" };
    await expect(undoLastGame(m.id)).rejects.toThrow(/Failed to fetch/);
  });
});

describe("startMatch is idempotent", () => {
  it("opens exactly one game when replayed", async () => {
    const m = seedMatch();
    await startMatch(m.id);
    await startMatch(m.id);
    expect(db.games.filter((g) => g.match_id === m.id)).toHaveLength(1);
    expect(db.matches[0].status).toBe("LIVE");
  });

  it("does not revive a completed match", async () => {
    const m = seedMatch({ status: "COMPLETED" });
    await startMatch(m.id);
    expect(db.matches[0].status).toBe("COMPLETED");
    expect(db.games).toHaveLength(0);
  });
});

describe("scorePoint", () => {
  it("opens game 2 when game 1 is won", async () => {
    const m = seedMatch({ status: "LIVE" });
    db.games.push({ id: "g1", match_id: m.id, game_number: 1, score_a: 20, score_b: 10 });
    await scorePoint(m.id, "A", 1);
    expect(db.games.find((g) => g.id === "g1").score_a).toBe(21);
    expect(db.games.filter((g) => g.match_id === m.id)).toHaveLength(2);
  });

  it("recovers a match left stuck after a won game whose follow-up write was lost", async () => {
    const m = seedMatch({ status: "LIVE" });
    // Game 1 already won, but game 2 was never created.
    db.games.push({ id: "g1", match_id: m.id, game_number: 1, score_a: 21, score_b: 15 });
    await scorePoint(m.id, "B", 1);
    const games = db.games.filter((g) => g.match_id === m.id);
    expect(games).toHaveLength(2);
    expect(games.find((g) => g.id === "g1")).toMatchObject({ score_a: 21, score_b: 15 }); // untouched
  });

  it("decides the match when the second game is won", async () => {
    const m = seedMatch({ status: "LIVE" });
    db.games.push({ id: "g1", match_id: m.id, game_number: 1, score_a: 21, score_b: 15 });
    db.games.push({ id: "g2", match_id: m.id, game_number: 2, score_a: 20, score_b: 18 });
    await scorePoint(m.id, "A", 1);
    expect(db.matches[0]).toMatchObject({ status: "COMPLETED", winner_entry_id: "A" });
  });
});
