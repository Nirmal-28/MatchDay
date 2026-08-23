// Ranking points — sport-specific and configurable.
//
// Every number here is derived from completed matches that actually exist in
// the database. Nothing is seeded, decayed toward a fake baseline, or
// back-filled. A player with no completed matches has no ranking, and the UI
// says so rather than showing a zero that looks like a real position.
//
// Badminton is the only sport with a scoring engine, so it is the only sport
// with a ranking config. Adding a sport means adding a config block, not
// editing this logic — the calculator is sport-agnostic.

import { roundLabel } from "./engines.js";

/**
 * A ranking config declares:
 *   perWin / perLoss   points for playing a match out
 *   stageBonus(match, event) extra points for how deep a player got
 *   titleBonus         extra for winning a division
 *   finalistBonus      extra for reaching the final
 *   minMatches         matches needed before a ranking is meaningful at all
 */
export const RANKING_CONFIGS = {
  badminton: {
    key: "badminton",
    label: "Badminton ranking",
    perWin: 100,
    perLoss: 25,          // showing up and playing still counts for something
    titleBonus: 400,
    finalistBonus: 200,
    minMatches: 3,
    // Knockout wins are worth more the later the round. Group/round-robin
    // matches have no "depth", so they score the flat perWin only.
    stageBonus(match, event) {
      if (!event?.total_rounds || match.group_label) return 0;
      const remaining = event.total_rounds - match.round;
      if (remaining === 0) return 150;  // final
      if (remaining === 1) return 100;  // semi
      if (remaining === 2) return 50;   // quarter
      return 0;
    },
  },
};

export const rankingConfigFor = (sport) => RANKING_CONFIGS[sport] || null;
export const sportHasRanking = (sport) => !!RANKING_CONFIGS[sport];

const DONE = ["COMPLETED", "WALKOVER"];

// Did one of this player's entries win the division? `champion_entry_id` is
// the single source of truth across every format.
const isChampionOf = (event, myEntryIds) =>
  !!(event?.champion_entry_id && myEntryIds.has(event.champion_entry_id));

/**
 * Full competitive record for one player.
 *
 * @param matches      every match the player appears in (with .games)
 * @param entryIds     all entry ids this player has competed under
 * @param eventById    event_id -> event row (for total_rounds / champion)
 * @param sport        sport key; falls back to badminton config
 */
export function computeRanking(matches, entryIds, eventById = {}, sport = "badminton") {
  const cfg = rankingConfigFor(sport);
  const mine = new Set(entryIds || []);

  const played = (matches || [])
    .filter((m) => DONE.includes(m.status) && (mine.has(m.entry_a) || mine.has(m.entry_b)))
    .sort((a, b) => (a.completed_at || "").localeCompare(b.completed_at || ""));

  let won = 0, lost = 0, points = 0;
  const history = [];      // cumulative points over time, for a trend line
  const titles = [];
  const finals = [];

  for (const m of played) {
    const event = eventById[m.event_id];
    const iWon = m.winner_entry_id && mine.has(m.winner_entry_id);
    if (iWon) won++; else lost++;

    if (cfg) {
      let gained = iWon ? cfg.perWin : cfg.perLoss;
      if (iWon) gained += cfg.stageBonus(m, event) || 0;

      // A final is the last round of a knockout; the winner of it takes the
      // division. Both facts come from the draw itself, not a flag.
      const isFinal = !!(event?.total_rounds && !m.group_label && m.round === event.total_rounds);
      if (isFinal) {
        finals.push({ match: m, event });
        gained += iWon ? cfg.titleBonus : cfg.finalistBonus;
      }
      // The title bonus is awarded once per division. Previously a knockout
      // champion collected it twice — once on an earlier match via
      // champion_entry_id, and again on the final — which silently inflated
      // their points. Round-robin divisions have no final, so they take the
      // bonus here instead.
      const alreadyTitled = titles.some((t) => t.event?.id === event?.id);
      if (isChampionOf(event, mine) && !alreadyTitled && !(isFinal && iWon)) {
        gained += cfg.titleBonus;
      }
      points += gained;
    }

    if (isChampionOf(event, mine) && !titles.some((t) => t.event?.id === event?.id)) {
      titles.push({ event, at: m.completed_at });
    }

    history.push({ at: m.completed_at, points, played: won + lost });
  }

  const total = won + lost;
  return {
    sport,
    hasRanking: !!cfg,
    // A ranking based on one or two matches is noise, so it is withheld rather
    // than published as a number people would read as meaningful.
    ranked: !!cfg && total >= cfg.minMatches,
    minMatches: cfg?.minMatches ?? null,
    played: total,
    won,
    lost,
    winPct: total ? Math.round((won / total) * 100) : 0,
    points: cfg ? points : null,
    titles: titles.length,
    titleList: titles,
    finals: finals.length,
    history,
  };
}

// Human label for how far a player got in one division.
export function bestFinish(matches, entryIds, event) {
  const mine = new Set(entryIds || []);
  const inEvent = (matches || []).filter((m) => m.event_id === event?.id && DONE.includes(m.status)
    && (mine.has(m.entry_a) || mine.has(m.entry_b)));
  if (!inEvent.length) return null;
  if (event?.champion_entry_id && mine.has(event.champion_entry_id)) return "Champion";
  if (!event?.total_rounds) return "Played";
  const deepest = Math.max(...inEvent.map((m) => m.round));
  const lastPlayed = inEvent.find((m) => m.round === deepest);
  const wonIt = lastPlayed?.winner_entry_id && mine.has(lastPlayed.winner_entry_id);
  const reached = wonIt ? deepest + 1 : deepest;
  if (reached > event.total_rounds) return "Champion";
  return roundLabel(reached, event.total_rounds);
}

/**
 * Site-wide ranking table. Takes the per-player aggregates the repository
 * already assembles and orders them; players below the minimum match count
 * are excluded rather than shown with a provisional number.
 */
export function rankPlayers(rows, sport = "badminton") {
  const cfg = rankingConfigFor(sport);
  if (!cfg) return [];
  return rows
    .filter((r) => r.played >= cfg.minMatches)
    .sort((a, b) => b.points - a.points || b.winPct - a.winPct || b.won - a.won)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}
