// Live win probability for rally-point badminton.
//
// This is exact, not a heuristic. Under rally scoring every rally awards a
// point, so a match is a Markov chain over (games won, current game score):
// a game goes to 21, must be won by 2, and is capped at 30 (29-29 is sudden
// death); the match is best of three. Given the probability `p` that side A
// wins any single rally, the chance A wins the match from ANY score follows
// by dynamic programming.
//
// Where does `p` come from? From the MatchDay Ratings of the two sides. Elo
// gives a MATCH win probability, and because the scoring system amplifies a
// small per-rally edge into a large match edge (a 55% rally winner takes the
// match about 80% of the time), the rally probability is recovered by
// inverting the model numerically. With no ratings on one side, p = 0.5 and
// the number reflects the score alone — the UI labels which one it is.
//
// Pure functions; no React, no Supabase.

const CAP = 30;
const TO_WIN = 21;

function gameOver(a, b) {
  return a >= CAP || b >= CAP || (Math.max(a, b) >= TO_WIN && Math.abs(a - b) >= 2);
}

// P(A wins the current game | score a-b, rally probability p).
function makeGameProb(p) {
  const memo = new Map();
  const f = (a, b) => {
    if (gameOver(a, b)) return a > b ? 1 : 0;
    const k = a * 64 + b;
    const hit = memo.get(k);
    if (hit !== undefined) return hit;
    const v = p * f(a + 1, b) + (1 - p) * f(a, b + 1);
    memo.set(k, v);
    return v;
  };
  return f;
}

/**
 * P(A wins the match) from a given state.
 * @param state { gamesA, gamesB, a, b } — games already won, and the score
 *              of the game in progress (0-0 between games)
 * @param p     probability A wins a rally
 */
export function matchWinProbability(state, p = 0.5) {
  const { gamesA = 0, gamesB = 0, a = 0, b = 0 } = state || {};
  if (gamesA >= 2) return 1;
  if (gamesB >= 2) return 0;
  const g = makeGameProb(p);
  const fresh = g(0, 0);
  const fromGames = (x, y) => {
    if (x >= 2) return 1;
    if (y >= 2) return 0;
    return fresh * fromGames(x + 1, y) + (1 - fresh) * fromGames(x, y + 1);
  };
  const cur = g(a, b);
  return cur * fromGames(gamesA + 1, gamesB) + (1 - cur) * fromGames(gamesA, gamesB + 1);
}

/**
 * The per-rally edge that makes a match from 0-0 come out at `matchProb`.
 * Bisection: matchWinProbability is monotonic in p.
 */
export function rallyProbabilityFor(matchProb) {
  const target = Math.min(0.995, Math.max(0.005, matchProb));
  let lo = 0.2, hi = 0.8;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (matchWinProbability({}, mid) < target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Match state from DB-shaped games ({a, b} per game, in order). A game that
 * is already won counts toward games; the next game starts at 0-0.
 */
export function stateFromGames(games) {
  let gamesA = 0, gamesB = 0, a = 0, b = 0;
  (games || []).forEach((g) => {
    if (gameOver(g.a, g.b)) { if (g.a > g.b) gamesA++; else gamesB++; }
    else { a = g.a; b = g.b; }
  });
  return { gamesA, gamesB, a, b };
}

/**
 * Win-probability series over a normalized point list (see matchStory.js),
 * one value before the first rally and one after every rally.
 * Returns [{ index, game, a, b, gamesA, gamesB, pA }].
 */
export function probabilitySeries(points, p = 0.5) {
  const out = [{ index: 0, game: 1, a: 0, b: 0, gamesA: 0, gamesB: 0, pA: matchWinProbability({}, p) }];
  let gamesA = 0, gamesB = 0;
  points.forEach((pt, i) => {
    let state = { gamesA, gamesB, a: pt.a, b: pt.b };
    if (gameOver(pt.a, pt.b)) {
      if (pt.a > pt.b) gamesA++; else gamesB++;
      state = { gamesA, gamesB, a: 0, b: 0 };
    }
    out.push({ index: i + 1, game: pt.game, a: pt.a, b: pt.b, gamesA, gamesB, pA: matchWinProbability(state, p) });
  });
  return out;
}

export { gameOver as isBadmintonGameOver };
