// MatchDay Rating (MDR) — a verified skill rating for amateur racket players.
//
// Why this exists. Amateur badminton in India is graded by self-declaration:
// a player says "Grade B" and plays Grade B. Sandbagging — strong players
// entering weak categories to collect trophies — is the complaint organizers
// raise most, and nothing in the market answers it. The ranking in
// ranking.js does not either: it rewards turning up (every match played earns
// points), so it measures activity, not ability.
//
// MDR measures ability, and it is VERIFIED: every input is a match scored
// rally-by-rally on MatchDay by a tournament's own officials. A player cannot
// type their rating in. That is also the moat — a competitor can copy a
// bracket screen in a week, but not a rating graph built from thousands of
// officiated results.
//
// The model is Elo with two refinements that suit rally-point badminton:
//
//   1. Margin counts. The "actual score" fed to Elo is not just 1 or 0 but a
//      blend of the result (75%) and the share of rallies won (25%). Beating
//      someone 21-5 21-6 says more than 22-20 21-19, and a rally-level signal
//      makes a rating settle in fewer matches — which matters when an amateur
//      plays maybe six rated matches a season.
//   2. Winners never lose rating and losers never gain it. A strict margin
//      model can dock a favourite for winning narrowly; mathematically sound,
//      but it reads as a bug to the person who just won, so the delta is
//      clamped at zero on the "wrong" side.
//
// Singles and doubles are rated separately: they are different skills, and
// every serious rating system (DUPR, Playtomic) keeps them apart.
//
// Rules this module keeps, in line with the rest of the codebase:
//   - Only real, completed, played matches count. Byes, walkovers and
//     retirements are excluded: an injury is not a skill signal, and a
//     walkover has no rallies to learn from.
//   - Nothing is fabricated. A player with fewer than PROVISIONAL_UNTIL rated
//     matches is reported as provisional, and the UI says so.
//   - Pure functions only. No Supabase, no React, deterministic for a given
//     input — the same results always produce the same ratings.

import { BadmintonScoringEngine, toAB } from "./engines.js";

export const MDR = {
  START: 1500,
  PROVISIONAL_UNTIL: 5,
  RESULT_WEIGHT: 0.75, // the rest is the share of rallies won
  // Fast while a rating is still finding its level, steadier once it has.
  kFactor(matchesPlayed) {
    if (matchesPlayed < 10) return 40;
    if (matchesPlayed < 30) return 28;
    return 20;
  },
};

export const FORMATS = ["singles", "doubles"];

// Elo expectation: probability that a side rated `ra` beats one rated `rb`.
export function expectedScore(ra, rb) {
  return 1 / (1 + Math.pow(10, (rb - ra) / 400));
}

// The blended actual score for side A, from its games.
export function actualScore(games, aWon) {
  let pa = 0, pb = 0;
  for (const g of games) { pa += g.a; pb += g.b; }
  const share = pa + pb > 0 ? pa / (pa + pb) : (aWon ? 1 : 0);
  return MDR.RESULT_WEIGHT * (aWon ? 1 : 0) + (1 - MDR.RESULT_WEIGHT) * share;
}

// Which matches are allowed to move a rating at all.
export function isRatable(m) {
  if (m.status !== "COMPLETED" || m.is_bye || m.retired) return false;
  if (!m.entry_a || !m.entry_b || !m.winner_entry_id) return false;
  const games = toAB(m.games);
  if (!games.length) return false;
  // A decided match whose game scores do not produce that winner is a data
  // problem (an edited result), not a skill signal.
  const side = BadmintonScoringEngine.matchWinnerSide(games);
  const expected = m.winner_entry_id === m.entry_a ? "A" : "B";
  return side === expected;
}

const blankPlayer = () => ({ rating: MDR.START, matches: 0, wins: 0, peak: MDR.START, opponents: new Set(), history: [] });

/**
 * Replay every result in completion order and produce ratings.
 *
 * @param matches        completed matches, each with `.games`
 * @param entryPlayers   entry id -> array of player ids (1 = singles, 2 = doubles)
 * @returns {
 *   players:  { [format]: { [playerId]: PlayerRating } },
 *   byMatch:  { [matchId]: { format, before: {A, B}, expectedA, deltas: {[playerId]: n} } }
 * }
 */
export function computeRatings(matches, entryPlayers) {
  const pools = { singles: {}, doubles: {} };
  const byMatch = {};

  const ordered = (matches || [])
    .filter(isRatable)
    .sort((x, y) => (x.completed_at || "").localeCompare(y.completed_at || "") || String(x.id).localeCompare(String(y.id)));

  for (const m of ordered) {
    const sideA = entryPlayers[m.entry_a] || [];
    const sideB = entryPlayers[m.entry_b] || [];
    // Both sides must be identifiable people, and the same shape. A side
    // with no linked player (no phone captured) has no rating history to
    // learn from, and its opponent should not be moved by a stranger.
    if (!sideA.length || sideA.length !== sideB.length || sideA.length > 2) continue;
    const format = sideA.length === 1 ? "singles" : "doubles";
    const pool = pools[format];
    const get = (id) => (pool[id] = pool[id] || blankPlayer());

    const ra = avg(sideA.map((id) => get(id).rating));
    const rb = avg(sideB.map((id) => get(id).rating));
    const games = toAB(m.games);
    const aWon = m.winner_entry_id === m.entry_a;
    const expectedA = expectedScore(ra, rb);
    const actualA = actualScore(games, aWon);

    const deltas = {};
    const apply = (ids, oppIds, exp, act, won) => {
      for (const id of ids) {
        const p = get(id);
        let d = MDR.kFactor(p.matches) * (act - exp);
        if (won) d = Math.max(d, 0); else d = Math.min(d, 0);
        d = Math.round(d);
        p.rating += d;
        p.matches += 1;
        if (won) p.wins += 1;
        p.peak = Math.max(p.peak, p.rating);
        oppIds.forEach((o) => p.opponents.add(o));
        p.history.push({ at: m.completed_at, rating: p.rating, delta: d, matchId: m.id, won });
        deltas[id] = d;
      }
    };
    apply(sideA, sideB, expectedA, actualA, aWon);
    apply(sideB, sideA, 1 - expectedA, 1 - actualA, !aWon);

    byMatch[m.id] = { format, before: { A: Math.round(ra), B: Math.round(rb) }, expectedA, deltas };
  }

  // Freeze into plain objects for the UI.
  const players = {};
  for (const format of FORMATS) {
    players[format] = {};
    for (const [id, p] of Object.entries(pools[format])) {
      players[format][id] = {
        rating: p.rating, matches: p.matches, wins: p.wins, peak: p.peak,
        opponents: p.opponents.size, provisional: p.matches < MDR.PROVISIONAL_UNTIL,
        history: p.history,
      };
    }
  }
  return { players, byMatch };
}

const avg = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

// Where a rating sits among everyone established in the same format, as
// "top N%". Computed, never estimated; null when there is nobody to compare
// against, so the UI can say nothing rather than something made up.
export function percentileOf(pool, playerId) {
  const me = pool?.[playerId];
  if (!me || me.provisional) return null;
  const established = Object.values(pool).filter((p) => !p.provisional);
  if (established.length < 5) return null;
  const above = established.filter((p) => p.rating > me.rating).length;
  return Math.max(1, Math.round(((above + 1) / established.length) * 100));
}

// The player's headline rating: the format they have played most.
export function primaryRating(players, playerId) {
  const s = players?.singles?.[playerId];
  const d = players?.doubles?.[playerId];
  if (!s && !d) return null;
  if (s && (!d || s.matches >= d.matches)) return { format: "singles", ...s };
  return { format: "doubles", ...d };
}

// A side's rating going into a match: the mean of its players' current
// ratings, and whether every one of them is established.
export function sideRating(pool, playerIds) {
  const rated = (playerIds || []).map((id) => pool?.[id]).filter(Boolean);
  if (!playerIds?.length || rated.length !== playerIds.length) return null;
  return {
    rating: Math.round(avg(rated.map((p) => p.rating))),
    provisional: rated.some((p) => p.provisional),
  };
}

/**
 * Fair Draw: flags entries rated well above the rest of their category.
 * Returns [{ entryId, rating, aboveMedian }] for entries more than
 * `threshold` points above the category median, established ratings only —
 * a provisional number is not strong enough evidence to accuse anyone.
 */
export function sandbagFlags(entries, pool, entryPlayersOf, threshold = 150) {
  const rated = entries
    .map((e) => ({ entryId: e.id, side: sideRating(pool, entryPlayersOf(e)) }))
    .filter((r) => r.side && !r.side.provisional);
  if (rated.length < 4) return [];
  const sorted = rated.map((r) => r.side.rating).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return rated
    .filter((r) => r.side.rating - median > threshold)
    .map((r) => ({ entryId: r.entryId, rating: r.side.rating, aboveMedian: Math.round(r.side.rating - median) }))
    .sort((a, b) => b.aboveMedian - a.aboveMedian);
}

/**
 * Seed order by rating: established ratings first (highest first), then
 * provisional ones, then unrated entries in their existing order. Returns a
 * seed map { entryId: seedNumber } for rated entries only — an unrated entry
 * is left unseeded rather than guessed at.
 */
export function seedsByRating(entries, pool, entryPlayersOf) {
  const rows = entries.map((e, i) => ({ e, i, side: sideRating(pool, entryPlayersOf(e)) }));
  const rated = rows.filter((r) => r.side)
    .sort((x, y) => (x.side.provisional - y.side.provisional) || (y.side.rating - x.side.rating) || (x.i - y.i));
  const map = {};
  rated.forEach((r, idx) => { map[r.e.id] = idx + 1; });
  rows.filter((r) => !r.side).forEach((r) => { map[r.e.id] = null; });
  return map;
}
