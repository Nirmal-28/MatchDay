// Match Story — the moments that made a match, read from its rally log.
//
// A final score says who won. The rally log says HOW: the 7-point run that
// turned game two, the three match points saved, the comeback from 9-15. That
// story is what a player shares, and a shared match card is how a scoring app
// grows (CricHeroes reached 16M users on ~90% organic growth this way). Every
// line produced here is counted from rallies that were actually scored; when
// there is no rally log (matches scored before it existed), the story falls
// back to what the game scores alone can honestly say.
//
// Pure functions; no React, no Supabase.

import { isBadmintonGameOver as gameOver, probabilitySeries } from "./winProbability.js";

/**
 * Raw match_points rows -> a clean list of rallies won, in order.
 * The log records corrections too (delta -1). A correction removes the most
 * recent rally that side won in that game, so a mis-tap and its undo leave
 * no trace in the story.
 *
 * @param rows [{ game_number, side: 'A'|'B', delta, score_a, score_b }] in insert order
 * @returns    [{ game, side, a, b }] — a/b are the score AFTER the rally
 */
export function normalizePoints(rows) {
  const out = [];
  for (const r of rows || []) {
    if (r.delta > 0) {
      out.push({ game: r.game_number, side: r.side, a: r.score_a, b: r.score_b });
    } else if (r.delta < 0) {
      for (let i = out.length - 1; i >= 0; i--) {
        if (out[i].game === r.game_number && out[i].side === r.side) { out.splice(i, 1); break; }
      }
    }
  }
  // Re-derive the running score from the cleaned sequence so a removed rally
  // cannot leave later states inconsistent.
  const running = {};
  return out.map((pt) => {
    const s = (running[pt.game] = running[pt.game] || { a: 0, b: 0 });
    if (pt.side === "A") s.a++; else s.b++;
    return { game: pt.game, side: pt.side, a: s.a, b: s.b };
  });
}

// Would the side that is `ahead` win the game with the next rally?
function isGamePoint(a, b, side) {
  const mine = side === "A" ? a : b;
  const theirs = side === "A" ? b : a;
  return !gameOver(a, b) && (mine === 29 || (mine >= 20 && mine > theirs));
}

const other = (s) => (s === "A" ? "B" : "A");
const fmt = (a, b, side) => (side === "A" ? `${a}–${b}` : `${b}–${a}`);

/**
 * The story of a match.
 * @param points     normalizePoints() output (may be empty)
 * @param games      [{a, b}] final game scores, in order
 * @param opts.p     rally probability for side A (from ratings), default 0.5
 * @returns { moments: [{ key, side, title, detail, weight }], series, stats }
 */
export function matchStory(points, games, { p = 0.5 } = {}) {
  const moments = [];
  const gamesWon = { A: 0, B: 0 };
  (games || []).forEach((g) => { if (gameOver(g.a, g.b)) gamesWon[g.a > g.b ? "A" : "B"]++; });
  const winner = gamesWon.A >= 2 ? "A" : gamesWon.B >= 2 ? "B" : null;

  if (points?.length) {
    // ── Longest run ────────────────────────────────────────────────────
    let best = { side: null, len: 0, from: null, to: null, game: null };
    let run = { side: null, len: 0, from: null };
    let prev = { a: 0, b: 0, game: points[0].game };
    for (const pt of points) {
      if (pt.game !== prev.game) prev = { a: 0, b: 0, game: pt.game };
      if (pt.side === run.side && pt.game === run.game) run.len++;
      else run = { side: pt.side, len: 1, from: { a: prev.a, b: prev.b }, game: pt.game };
      if (run.len > best.len) best = { ...run, to: { a: pt.a, b: pt.b } };
      prev = { a: pt.a, b: pt.b, game: pt.game };
    }
    if (best.len >= 5) {
      moments.push({
        key: "run", side: best.side, weight: best.len,
        title: `${best.len} points in a row`,
        detail: `From ${fmt(best.from.a, best.from.b, best.side)} to ${fmt(best.to.a, best.to.b, best.side)} in game ${best.game}`,
      });
    }

    // ── Comebacks: the largest deficit a game winner overturned ─────────
    const byGame = groupBy(points, (pt) => pt.game);
    let comeback = null;
    for (const [game, pts] of Object.entries(byGame)) {
      const last = pts[pts.length - 1];
      if (!gameOver(last.a, last.b)) continue;
      const gw = last.a > last.b ? "A" : "B";
      let worst = 0, at = null;
      for (const pt of pts) {
        const deficit = gw === "A" ? pt.b - pt.a : pt.a - pt.b;
        if (deficit > worst) { worst = deficit; at = pt; }
      }
      if (worst >= 4 && (!comeback || worst > comeback.deficit)) comeback = { game: Number(game), side: gw, deficit: worst, at, final: last };
    }
    if (comeback) {
      moments.push({
        key: "comeback", side: comeback.side, weight: comeback.deficit + 2,
        title: `Came back from ${comeback.deficit} down`,
        detail: `Trailed ${fmt(comeback.at.a, comeback.at.b, comeback.side)}, took game ${comeback.game} ${fmt(comeback.final.a, comeback.final.b, comeback.side)}`,
      });
    }

    // ── Game points and match points saved ─────────────────────────────
    const saved = { A: { game: 0, match: 0 }, B: { game: 0, match: 0 } };
    const won = { A: 0, B: 0 };
    let before = { a: 0, b: 0, game: points[0].game };
    for (const pt of points) {
      if (pt.game !== before.game) before = { a: 0, b: 0, game: pt.game };
      for (const threat of ["A", "B"]) {
        if (pt.side === threat || !isGamePoint(before.a, before.b, threat)) continue;
        const isMatchPoint = won[threat] === 1;
        saved[other(threat)][isMatchPoint ? "match" : "game"]++;
      }
      if (gameOver(pt.a, pt.b)) won[pt.a > pt.b ? "A" : "B"]++;
      before = { a: pt.a, b: pt.b, game: pt.game };
    }
    for (const side of ["A", "B"]) {
      if (saved[side].match > 0) {
        moments.push({
          key: `mp-${side}`, side, weight: 6 + saved[side].match * 2,
          title: `${saved[side].match} match point${saved[side].match === 1 ? "" : "s"} saved`,
          detail: side === winner ? "Saved them and went on to win" : "Fought off defeat before it finally came",
        });
      } else if (saved[side].game >= 2) {
        moments.push({
          key: `gp-${side}`, side, weight: 3 + saved[side].game,
          title: `${saved[side].game} game points saved`,
          detail: "Refused to give the game away",
        });
      }
    }

    // ── Lead changes within one game ────────────────────────────────────
    let swings = { n: 0, game: null };
    for (const [game, pts] of Object.entries(byGame)) {
      let leader = null, n = 0;
      for (const pt of pts) {
        const l = pt.a > pt.b ? "A" : pt.b > pt.a ? "B" : null;
        if (l && leader && l !== leader) n++;
        if (l) leader = l;
      }
      if (n > swings.n) swings = { n, game: Number(game) };
    }
    if (swings.n >= 5) {
      moments.push({ key: "swings", side: null, weight: swings.n, title: `Lead changed ${swings.n} times`, detail: `A see-saw game ${swings.game}` });
    }
  }

  // ── Win probability: the lowest point the winner came back from ───────
  const series = points?.length ? probabilitySeries(points, p) : [];
  if (winner && series.length > 2) {
    const low = Math.min(...series.map((s) => (winner === "A" ? s.pA : 1 - s.pA)));
    if (low <= 0.3) {
      moments.push({
        key: "lowpoint", side: winner, weight: 10 - low * 10,
        title: `Won from ${Math.max(1, Math.round(low * 100))}% win probability`,
        detail: "At their lowest point, the numbers gave them little chance",
      });
    }
  }

  // ── What the game scores alone can say ─────────────────────────────────
  (games || []).forEach((g, i) => {
    if (gameOver(g.a, g.b) && g.a >= 20 && g.b >= 20) {
      const s = g.a > g.b ? "A" : "B";
      moments.push({ key: `deuce-${i}`, side: s, weight: 3 + Math.max(g.a, g.b) - 21, title: `Game ${i + 1} went beyond 20-all`, detail: `Settled ${fmt(g.a, g.b, s)}` });
    }
  });
  if ((games || []).length === 3 && winner) {
    moments.push({ key: "decider", side: winner, weight: 2.5, title: "Won it in a decider", detail: "Three games to separate them" });
  }
  if (winner && (games || []).length === 2 && games.every((g) => Math.min(g.a, g.b) <= 10)) {
    moments.push({ key: "dominant", side: winner, weight: 2, title: "A dominant win", detail: "The opponent never reached 11 in either game" });
  }

  moments.sort((x, y) => y.weight - x.weight);

  const stats = points?.length
    ? {
        rallies: points.length,
        pointsWon: { A: points.filter((x) => x.side === "A").length, B: points.filter((x) => x.side === "B").length },
      }
    : null;

  return { moments, series, stats, winner };
}

function groupBy(xs, key) {
  const out = {};
  for (const x of xs) (out[key(x)] = out[key(x)] || []).push(x);
  return out;
}
