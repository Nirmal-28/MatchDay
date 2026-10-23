import { describe, it, expect } from "vitest";
import { matchWinProbability, rallyProbabilityFor, stateFromGames } from "./winProbability";
import { computeRatings, expectedScore, actualScore, isRatable, percentileOf, sideRating, sandbagFlags, seedsByRating, MDR } from "./rating";
import { normalizePoints, matchStory } from "./matchStory";

/* ───────────────────────────── win probability ───────────────────────────── */

describe("matchWinProbability", () => {
  it("is exactly 50% for evenly matched sides at 0-0", () => {
    expect(matchWinProbability({}, 0.5)).toBeCloseTo(0.5, 10);
  });

  it("is symmetric: P(A | p) = 1 - P(A | 1-p)", () => {
    for (const p of [0.4, 0.47, 0.53, 0.6]) {
      expect(matchWinProbability({ a: 7, b: 11 }, p)).toBeCloseTo(1 - matchWinProbability({ a: 11, b: 7 }, 1 - p), 10);
    }
  });

  it("amplifies a small rally edge into a large match edge", () => {
    const m = matchWinProbability({}, 0.55);
    expect(m).toBeGreaterThan(0.75);
    expect(m).toBeLessThan(0.9);
  });

  it("is certain once a side has two games", () => {
    expect(matchWinProbability({ gamesA: 2 })).toBe(1);
    expect(matchWinProbability({ gamesB: 2 })).toBe(0);
  });

  it("treats 29-29 as sudden death", () => {
    expect(matchWinProbability({ gamesA: 1, gamesB: 1, a: 29, b: 29 }, 0.5)).toBeCloseTo(0.5, 10);
    // At 29-29 in the decider with p = 0.6, A wins iff A wins the next rally.
    expect(matchWinProbability({ gamesA: 1, gamesB: 1, a: 29, b: 29 }, 0.6)).toBeCloseTo(0.6, 10);
  });

  it("rises as a side moves ahead", () => {
    const lo = matchWinProbability({ a: 10, b: 10 });
    const hi = matchWinProbability({ a: 15, b: 10 });
    expect(hi).toBeGreaterThan(lo);
  });
});

describe("rallyProbabilityFor", () => {
  it("inverts matchWinProbability", () => {
    for (const target of [0.2, 0.5, 0.76, 0.9]) {
      const p = rallyProbabilityFor(target);
      expect(matchWinProbability({}, p)).toBeCloseTo(target, 4);
    }
  });
});

describe("stateFromGames", () => {
  it("counts finished games and carries the live one", () => {
    expect(stateFromGames([{ a: 21, b: 15 }, { a: 8, b: 11 }])).toEqual({ gamesA: 1, gamesB: 0, a: 8, b: 11 });
  });
  it("starts the next game at 0-0 between games", () => {
    expect(stateFromGames([{ a: 18, b: 21 }])).toEqual({ gamesA: 0, gamesB: 1, a: 0, b: 0 });
  });
});

/* ───────────────────────────────── ratings ───────────────────────────────── */

let t = 0;
const at = () => `2026-01-01T00:00:${String(t++).padStart(2, "0")}Z`;
function m(a, b, games, extra = {}) {
  const tally = games.reduce((acc, [x, y]) => { if (x > y) acc.a++; else acc.b++; return acc; }, { a: 0, b: 0 });
  return {
    id: `m${t}`, status: "COMPLETED", entry_a: a, entry_b: b,
    winner_entry_id: tally.a > tally.b ? a : b, completed_at: at(),
    games: games.map(([x, y], i) => ({ game_number: i + 1, score_a: x, score_b: y })), ...extra,
  };
}

describe("expected/actual score", () => {
  it("is 0.5 for equal ratings and favours the higher rating", () => {
    expect(expectedScore(1500, 1500)).toBe(0.5);
    expect(expectedScore(1700, 1500)).toBeGreaterThan(0.75);
  });
  it("rewards a heavier margin", () => {
    const close = actualScore([{ a: 22, b: 20 }, { a: 21, b: 19 }], true);
    const rout = actualScore([{ a: 21, b: 5 }, { a: 21, b: 6 }], true);
    expect(rout).toBeGreaterThan(close);
    expect(close).toBeGreaterThan(MDR.RESULT_WEIGHT);
  });
});

describe("isRatable", () => {
  it("excludes byes, walkovers and retirements", () => {
    expect(isRatable(m("a", "b", [[21, 10], [21, 10]], { is_bye: true }))).toBe(false);
    expect(isRatable(m("a", "b", [[21, 10], [21, 10]], { status: "WALKOVER" }))).toBe(false);
    expect(isRatable(m("a", "b", [[21, 10], [5, 3]], { retired: true }))).toBe(false);
    expect(isRatable(m("a", "b", [[21, 10], [21, 10]]))).toBe(true);
  });
  it("excludes a result whose games do not produce the recorded winner", () => {
    const bad = m("a", "b", [[21, 10], [21, 10]]);
    bad.winner_entry_id = "b";
    expect(isRatable(bad)).toBe(false);
  });
});

describe("computeRatings", () => {
  const ep = { a: ["P1"], b: ["P2"], c: ["P3"], d1: ["P1", "P2"], d2: ["P3", "P4"] };

  it("moves the winner up and the loser down by the same amount for equal ratings", () => {
    const { players } = computeRatings([m("a", "b", [[21, 15], [21, 17]])], ep);
    const w = players.singles.P1, l = players.singles.P2;
    expect(w.rating).toBeGreaterThan(MDR.START);
    expect(l.rating).toBeLessThan(MDR.START);
    expect(w.rating - MDR.START).toBe(MDR.START - l.rating);
  });

  it("never docks a winner or rewards a loser", () => {
    const matches = [];
    for (let i = 0; i < 12; i++) matches.push(m("a", "b", [[21, 2], [21, 3]]));
    matches.push(m("a", "b", [[22, 20], [29, 27]])); // narrow win as a heavy favourite
    const { byMatch } = computeRatings(matches, ep);
    const last = byMatch[matches[matches.length - 1].id];
    expect(last.deltas.P1).toBeGreaterThanOrEqual(0);
    expect(last.deltas.P2).toBeLessThanOrEqual(0);
  });

  it("keeps singles and doubles separate", () => {
    const { players } = computeRatings([m("d1", "d2", [[21, 12], [21, 12]])], ep);
    expect(players.doubles.P1.rating).toBeGreaterThan(MDR.START);
    expect(players.singles.P1).toBeUndefined();
  });

  it("is provisional until enough matches", () => {
    const matches = Array.from({ length: MDR.PROVISIONAL_UNTIL }, () => m("a", "c", [[21, 15], [21, 15]]));
    const r1 = computeRatings(matches.slice(0, -1), ep).players.singles.P1;
    const r2 = computeRatings(matches, ep).players.singles.P1;
    expect(r1.provisional).toBe(true);
    expect(r2.provisional).toBe(false);
  });

  it("skips a match with an unlinked side", () => {
    const { players } = computeRatings([m("a", "ghost", [[21, 15], [21, 15]])], ep);
    expect(players.singles.P1).toBeUndefined();
  });

  it("is deterministic regardless of input order", () => {
    const ms = [m("a", "b", [[21, 15], [21, 17]]), m("b", "c", [[21, 19], [19, 21], [21, 18]]), m("c", "a", [[21, 10], [21, 11]])];
    const x = computeRatings(ms, ep).players.singles;
    const y = computeRatings([...ms].reverse(), ep).players.singles;
    expect(x).toEqual(y);
  });
});

describe("Fair Draw helpers", () => {
  const pool = {
    p1: { rating: 1800, provisional: false }, p2: { rating: 1500, provisional: false },
    p3: { rating: 1480, provisional: false }, p4: { rating: 1510, provisional: false },
    p5: { rating: 1490, provisional: false }, p6: { rating: 1900, provisional: true },
  };
  const entries = ["p1", "p2", "p3", "p4", "p5", "p6", "x"].map((id) => ({ id: `e-${id}`, pid: id }));
  const of = (e) => [e.pid];

  it("flags only established ratings far above the median", () => {
    const flags = sandbagFlags(entries, pool, of);
    expect(flags.map((f) => f.entryId)).toEqual(["e-p1"]);
    expect(flags[0].aboveMedian).toBe(300);
  });

  it("seeds established ratings first, then provisional, and leaves unrated unseeded", () => {
    const seeds = seedsByRating(entries, pool, of);
    expect(seeds["e-p1"]).toBe(1);
    expect(seeds["e-p4"]).toBe(2);
    expect(seeds["e-p6"]).toBe(6);
    expect(seeds["e-x"]).toBeNull();
  });

  it("sideRating needs every player rated", () => {
    expect(sideRating(pool, ["p1", "x"])).toBeNull();
    expect(sideRating(pool, ["p1", "p2"])).toEqual({ rating: 1650, provisional: false });
  });

  it("percentile is withheld for provisional players and tiny pools", () => {
    expect(percentileOf(pool, "p6")).toBeNull();
    expect(percentileOf(pool, "p1")).toBe(20);
    expect(percentileOf({ a: { rating: 1, provisional: false } }, "a")).toBeNull();
  });
});

/* ─────────────────────────────── match story ─────────────────────────────── */

// Build a point log from a string of winners per game, e.g. ["AABBA...", "..."]
function log(gamesStr) {
  const rows = [];
  gamesStr.forEach((s, gi) => {
    let a = 0, b = 0;
    for (const ch of s) {
      if (ch === "A") a++; else b++;
      rows.push({ game_number: gi + 1, side: ch, delta: 1, score_a: a, score_b: b });
    }
  });
  return rows;
}

describe("normalizePoints", () => {
  it("removes a mis-tap and its correction", () => {
    const rows = [
      { game_number: 1, side: "A", delta: 1, score_a: 1, score_b: 0 },
      { game_number: 1, side: "B", delta: 1, score_a: 1, score_b: 1 },
      { game_number: 1, side: "B", delta: -1, score_a: 1, score_b: 0 },
      { game_number: 1, side: "A", delta: 1, score_a: 2, score_b: 0 },
    ];
    expect(normalizePoints(rows)).toEqual([
      { game: 1, side: "A", a: 1, b: 0 },
      { game: 1, side: "A", a: 2, b: 0 },
    ]);
  });
});

describe("matchStory", () => {
  it("finds a comeback, a run and the winner", () => {
    // Game 1: B leads 15-9, then A wins 12 straight -> 21-15.
    const g1 = "B".repeat(6) + "AB".repeat(9).slice(0, 18) + "A".repeat(12);
    const pts = normalizePoints(log([g1, "A".repeat(21)]));
    const last1 = pts.filter((p) => p.game === 1).at(-1);
    expect(last1.a).toBeGreaterThan(last1.b);
    const games = [{ a: last1.a, b: last1.b }, { a: 21, b: 0 }];
    const story = matchStory(pts, games);
    expect(story.winner).toBe("A");
    const keys = story.moments.map((x) => x.key);
    expect(keys).toContain("comeback");
    expect(keys).toContain("run");
    expect(story.series.length).toBe(pts.length + 1);
  });

  it("counts match points saved", () => {
    // A wins game 1, then in game 2 trails 0-15, reaches 20-15 (match point)
    // and B wins the last 7 rallies: points saved at 20-15 … 20-19 = 5.
    const seq = "B".repeat(15) + "A".repeat(20) + "B".repeat(7);
    const pts = normalizePoints(log(["A".repeat(21), seq]));
    const story = matchStory(pts, [{ a: 21, b: 0 }, { a: 20, b: 22 }]);
    const mp = story.moments.find((x) => x.key === "mp-B");
    expect(mp).toBeDefined();
    expect(mp.title).toBe("5 match points saved");
  });

  it("falls back to game scores without a rally log", () => {
    const story = matchStory([], [{ a: 24, b: 22 }, { a: 18, b: 21 }, { a: 21, b: 19 }]);
    const keys = story.moments.map((x) => x.key);
    expect(keys).toContain("deuce-0");
    expect(keys).toContain("decider");
    expect(story.series).toEqual([]);
  });
});
