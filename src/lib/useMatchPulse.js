// Everything MatchDay Pulse knows about one match, as a React hook: the rally
// log, both sides' MatchDay Ratings, the live win probability, the momentum
// series and the Match Story.
//
// Honesty rules, applied here so every surface inherits them:
//   - The win probability says what it is based on. With both sides rated it
//     is "ratings + score"; otherwise it is the score alone, with p = 0.5.
//   - For a finished match the pre-match ratings come from the replay
//     (byMatch.before), never from today's ratings, which already include
//     this result and would make the favourite look prophetic in hindsight.
//   - The momentum chart is only drawn from a rally log that reconciles with
//     the official game scores. A partial log (a dropped insert, or a match
//     that started before migration 015) is reported as partial and the
//     story falls back to what the game scores can say.

import { useEffect, useMemo, useState } from "react";
import { toAB } from "./engines";
import { getRatingData, listMatchPoints, subscribeToMatchPoints } from "./repository";
import { expectedScore, sideRating, MDR } from "./rating";
import { matchWinProbability, rallyProbabilityFor, stateFromGames } from "./winProbability";
import { normalizePoints, matchStory } from "./matchStory";

const playerIdsOf = (entry) => (entry?.entry_players || []).map((p) => p.player_id).filter(Boolean);

// Does the cleaned rally log reproduce the official score of every game?
// `liveSlack` tolerates the log being one rally ahead of or behind the score
// in the game in progress: the rally insert and the score update are two
// writes that reach a spectator a few milliseconds apart, and without the
// slack a live chart would vanish and reappear on every point. Finished
// games must always match exactly.
export function logReconciles(points, games, { liveSlack = false } = {}) {
  if (!points.length) return false;
  return games.every((g, i) => {
    const inGame = points.filter((p) => p.game === i + 1);
    const last = inGame[inGame.length - 1] || { a: 0, b: 0 };
    if (last.a === g.a && last.b === g.b) return true;
    const isCurrent = i === games.length - 1;
    return liveSlack && isCurrent && Math.abs(last.a + last.b - (g.a + g.b)) <= 1 &&
      Math.abs(last.a - g.a) <= 1 && Math.abs(last.b - g.b) <= 1;
  });
}

export function useMatchPulse(match, entriesById) {
  const [rows, setRows] = useState([]);
  const [ratings, setRatings] = useState(null);

  const matchId = match?.id;
  const games = useMemo(() => toAB(match?.games), [match?.games]);
  // Re-read the log whenever the official score moves; the realtime insert
  // below makes it immediate, this makes it correct if an event was missed.
  const scoreKey = games.map((g) => `${g.a}-${g.b}`).join("|");

  useEffect(() => {
    if (!matchId) return;
    let cancelled = false;
    listMatchPoints(matchId).then((r) => { if (!cancelled) setRows(r); });
    return () => { cancelled = true; };
  }, [matchId, scoreKey]);

  useEffect(() => {
    if (!matchId || match?.status !== "LIVE") return;
    return subscribeToMatchPoints(matchId, (payload) => {
      const row = payload?.new;
      // The refetch above may already hold this rally; never count it twice.
      if (row) setRows((rs) => (rs.some((r) => r.id === row.id) ? rs : [...rs, row].sort((x, y) => x.id - y.id)));
    });
  }, [matchId, match?.status]);

  useEffect(() => {
    let cancelled = false;
    getRatingData().then((r) => { if (!cancelled) setRatings(r); }).catch(() => { if (!cancelled) setRatings(false); });
    return () => { cancelled = true; };
  }, []);

  return useMemo(() => {
    if (!match) return null;
    const a = entriesById?.[match.entry_a];
    const b = entriesById?.[match.entry_b];
    const idsA = playerIdsOf(a), idsB = playerIdsOf(b);
    const format = Math.max(idsA.length, (a?.entry_players || []).length) > 1 ? "doubles" : "singles";
    const pool = ratings?.players?.[format] || {};
    const replay = ratings?.byMatch?.[match.id] || null;
    const done = match.status === "COMPLETED" || match.status === "WALKOVER";

    // Pre-match ratings: from the replay for a finished match, current for
    // anything not yet played.
    let rating = { A: null, B: null };
    if (replay) {
      rating = {
        A: { rating: replay.before.A, provisional: false },
        B: { rating: replay.before.B, provisional: false },
      };
    } else if (!done) {
      rating = { A: sideRating(pool, idsA), B: sideRating(pool, idsB) };
    }

    const rated = !!(rating.A && rating.B);
    const expectedA = replay ? replay.expectedA : rated ? expectedScore(rating.A.rating, rating.B.rating) : 0.5;
    const p = rated ? rallyProbabilityFor(expectedA) : 0.5;
    const isLive = match.status === "LIVE";
    const live = isLive ? matchWinProbability(stateFromGames(games), p) : null;

    const points = normalizePoints(rows);
    const complete = logReconciles(points, games, { liveSlack: isLive });
    const story = matchStory(complete ? points : [], games, { p });

    // Rating change per side: every player on a side moves by the same delta.
    const deltaOf = (ids) => (replay && ids.length ? replay.deltas[ids[0]] ?? null : null);
    const current = (ids) => (ids.length === 1 ? pool[ids[0]] || null : null);

    return {
      format,
      basis: rated ? "ratings" : "score",
      ratingsLoaded: ratings !== null,
      rating,
      preMatchA: expectedA,
      rallyEdge: p,
      live,
      points,
      logComplete: complete,
      // Only claimed once play is over; mid-match the next rally may fix it.
      logPartial: !isLive && points.length > 0 && !complete,
      story,
      delta: { A: deltaOf(idsA), B: deltaOf(idsB) },
      currentRating: { A: current(idsA), B: current(idsB) },
      provisionalUntil: MDR.PROVISIONAL_UNTIL,
    };
  }, [match, entriesById, ratings, rows, games]);
}
