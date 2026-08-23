// MatchDay — sport registry.
//
// The line this file draws:
//
//   GENERIC (sport-agnostic, already built and shared by every sport):
//     Tournament · Event/division · Participant · Team · Registration ·
//     Entry · Match · Draw generation (knockout / round robin / groups) ·
//     Seeding · Schedule · Court · Result · Standings · Notification ·
//     Payment · Ranking · Staff/RBAC · Check-in · Disputes · Exports
//
//   SPORT-SPECIFIC (one implementation per sport, none shared):
//     Scoring rules · Game/set/innings structure · What ends a match ·
//     Sport statistics
//
// Badminton is the only sport with a real rules engine today. Every other
// entry below is registered so the generic layer (icons, filters, a player's
// listed sports) can name it — and every one of them reports
// `hasScoringEngine: false`, which is what the UI reads before offering to run
// a tournament in that sport. Nothing here fakes support: adding a sport means
// writing its engine and setting the flag, not editing a label.

import { BadmintonScoringEngine } from "../engines";

/**
 * A sport scoring engine must provide:
 *   isGameOver(a, b)          -> boolean
 *   gameWinnerSide(a, b)      -> "A" | "B" | null
 *   canScore(a, b, side)      -> boolean
 *   matchWinnerSide(games)    -> "A" | "B" | null
 *   gameTally(games)          -> { a, b }
 * See BadmintonScoringEngine in ../engines.js for the reference implementation.
 */

export const SPORTS = {
  badminton: {
    key: "badminton",
    label: "Badminton",
    hasScoringEngine: true,
    engine: BadmintonScoringEngine,
    unit: "game",
    scoreSummary: "Best of 3 games to 21, win by 2, capped at 30.",
  },
  tennis: {
    key: "tennis", label: "Tennis", hasScoringEngine: false, engine: null,
    needs: "games/sets scoring with deuce, advantage and tiebreaks",
  },
  pickleball: {
    key: "pickleball", label: "Pickleball", hasScoringEngine: false, engine: null,
    needs: "side-out or rally scoring to 11, win by 2",
  },
  tableTennis: {
    key: "tableTennis", label: "Table Tennis", hasScoringEngine: false, engine: null,
    needs: "best of 5 or 7 games to 11, win by 2",
  },
  volleyball: {
    key: "volleyball", label: "Volleyball", hasScoringEngine: false, engine: null,
    needs: "sets to 25 (win by 2) with a deciding set to 15",
  },
  basketball: {
    key: "basketball", label: "Basketball", hasScoringEngine: false, engine: null,
    needs: "timed quarters, 1/2/3-point scoring, fouls and overtime",
  },
  football: {
    key: "football", label: "Football", hasScoringEngine: false, engine: null,
    needs: "timed halves, draws as a valid result, and league points",
  },
  cricket: {
    key: "cricket", label: "Cricket", hasScoringEngine: false, engine: null,
    needs: "innings, overs, wickets, extras and per-ball scoring",
  },
};

export const SUPPORTED_SPORTS = Object.values(SPORTS).filter((s) => s.hasScoringEngine);

export const sportMeta = (key) => SPORTS[key] || SPORTS.badminton;

// The engine to score a match with. Throws rather than silently falling back
// to badminton rules, which would produce wrong-but-plausible scores.
export function scoringEngineFor(sportKey) {
  const sport = SPORTS[sportKey];
  if (!sport) throw new Error(`Unknown sport: ${sportKey}`);
  if (!sport.hasScoringEngine) {
    throw new Error(`${sport.label} has no scoring engine yet. Required: ${sport.needs}.`);
  }
  return sport.engine;
}

export const canRunTournament = (sportKey) => !!SPORTS[sportKey]?.hasScoringEngine;
