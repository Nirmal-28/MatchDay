// Series standings — one table across every matchday in a series.
//
// This aggregates results that already exist. A player appears only because
// they have a real entry, and their numbers move only when a match is actually
// completed. Nothing is projected, decayed or back-filled, and a matchday that
// has not been played contributes nothing rather than zeros.
//
// The points model is configurable and separate from the single-tournament
// ranking in ./ranking.js, which is left untouched: a series can reward
// turning up every matchday, which a one-off tournament ranking should not.

import { rankingConfigFor } from "./ranking.js";

const DONE = ["COMPLETED", "WALKOVER"];

/**
 * A series scoring config declares:
 *   perWin / perLoss     points per completed match
 *   perMatchday          points for competing in a matchday at all
 *   titleBonus           points for winning a division on a matchday
 *   finalistBonus        points for reaching a division final
 *   stageBonus           reuses the sport ranking's round-depth curve
 *   minMatchdays         matchdays needed before a position is published
 */
export const SERIES_SCORING = {
  standard: {
    key: "standard",
    label: "Standard series scoring",
    description: "Match wins carry the table, with a small credit for turning up to each matchday.",
    perWin: 100,
    perLoss: 25,
    perMatchday: 50,
    titleBonus: 400,
    finalistBonus: 200,
    useStageBonus: true,
    minMatchdays: 1,
  },
  attendance: {
    key: "attendance",
    label: "Attendance-weighted",
    description: "Rewards competing across the whole series, not just winning one matchday.",
    perWin: 60,
    perLoss: 30,
    perMatchday: 150,
    titleBonus: 200,
    finalistBonus: 100,
    useStageBonus: false,
    minMatchdays: 2,
  },
  winsOnly: {
    key: "winsOnly",
    label: "Wins only",
    description: "Purely match wins. No participation or progression credit.",
    perWin: 100,
    perLoss: 0,
    perMatchday: 0,
    titleBonus: 0,
    finalistBonus: 0,
    useStageBonus: false,
    minMatchdays: 1,
  },
};

export const seriesScoringConfig = (key) => SERIES_SCORING[key] || SERIES_SCORING.standard;

/**
 * Build the cross-matchday table.
 *
 * @param data   the shape returned by repository.getSeriesData()
 * @param opts   { scoring: keyof SERIES_SCORING, sport }
 */
export function computeSeriesStandings(data, { scoring = "standard", sport = "badminton" } = {}) {
  const cfg = seriesScoringConfig(scoring);
  const sportCfg = rankingConfigFor(sport);
  const { matches = [], entries = [], entryToPlayer = {}, players = [], eventById = {}, tournamentByEvent = {} } = data || {};

  // Only matchdays that have actually produced a result count as "played".
  const playedTournamentIds = new Set(
    matches.filter((m) => DONE.includes(m.status)).map((m) => tournamentByEvent[m.event_id]).filter(Boolean)
  );

  const rows = {};
  const row = (playerId) => (rows[playerId] = rows[playerId] || {
    playerId, matchdays: new Set(), matches: 0, won: 0, lost: 0, points: 0,
    titles: 0, finals: 0, perMatchday: {},
  });

  // 1. Participation — an entry in a matchday that has been played.
  for (const e of entries) {
    if (["REJECTED", "CANCELLED"].includes(e.reg_status)) continue;
    const pid = entryToPlayer[e.id];
    const tId = tournamentByEvent[e.event_id];
    if (!pid || !tId || !playedTournamentIds.has(tId)) continue;
    const r = row(pid);
    if (!r.matchdays.has(tId)) {
      r.matchdays.add(tId);
      r.points += cfg.perMatchday;
      r.perMatchday[tId] = r.perMatchday[tId] || { points: cfg.perMatchday, won: 0, lost: 0 };
    }
  }

  // 2. Match results.
  const countedTitles = new Set(); // playerId|eventId, so a title counts once
  for (const m of matches) {
    if (!DONE.includes(m.status)) continue;
    const event = eventById[m.event_id];
    const tId = tournamentByEvent[m.event_id];

    for (const entryId of [m.entry_a, m.entry_b]) {
      const pid = entryToPlayer[entryId];
      if (!pid) continue;
      const r = row(pid);
      const won = m.winner_entry_id === entryId;

      r.matches++;
      if (won) r.won++; else r.lost++;

      let gained = won ? cfg.perWin : cfg.perLoss;
      if (won && cfg.useStageBonus && sportCfg?.stageBonus) {
        gained += sportCfg.stageBonus(m, event) || 0;
      }

      // A final is the last round of a knockout. Both facts come from the
      // draw, not from a flag someone could set by hand.
      const isFinal = !!(event?.total_rounds && !m.group_label && m.round === event.total_rounds);
      if (isFinal) {
        r.finals++;
        gained += won ? cfg.titleBonus : cfg.finalistBonus;
      }

      // A title is "this player's entry is the champion of this event", which
      // `champion_entry_id` records for every format. Counting it here rather
      // than inside the isFinal branch is what stops a knockout champion being
      // credited twice — once for winning the final, and again for every
      // earlier match in the same event. Round-robin divisions have no final,
      // so the fallback only applies when the champion was never stamped.
      const titleKey = `${pid}|${m.event_id}`;
      const isChampion = event?.champion_entry_id
        ? event.champion_entry_id === entryId
        : (isFinal && won);
      if (isChampion && !countedTitles.has(titleKey)) {
        countedTitles.add(titleKey);
        r.titles++;
        // The bonus is already in `gained` when they won the final; only add
        // it here for formats that decide a champion without one.
        if (!(isFinal && won)) gained += cfg.titleBonus;
      }

      r.points += gained;
      if (tId) {
        const md = (r.perMatchday[tId] = r.perMatchday[tId] || { points: 0, won: 0, lost: 0 });
        md.points += gained;
        if (won) md.won++; else md.lost++;
      }
    }
  }

  const playerById = Object.fromEntries(players.map((p) => [p.id, p]));

  const table = Object.values(rows)
    .map((r) => ({
      ...r,
      player: playerById[r.playerId] || null,
      matchdays: r.matchdays.size,
      winPct: r.matches ? Math.round((r.won / r.matches) * 100) : 0,
    }))
    .filter((r) => r.player && r.matchdays >= cfg.minMatchdays)
    .sort((a, b) => b.points - a.points || b.won - a.won || b.winPct - a.winPct)
    .map((r, i) => ({ ...r, position: i + 1 }));

  return {
    config: cfg,
    table,
    playedMatchdays: playedTournamentIds.size,
    // Surfaced so the UI can say why someone is missing instead of appearing
    // to have silently dropped them.
    excludedBelowMinimum: Object.keys(rows).length - table.length,
  };
}

/**
 * One player's line in a series, plus movement.
 *
 * Movement is only reported when it can be derived honestly: we recompute the
 * table as it stood before the most recent played matchday and compare. With
 * fewer than two played matchdays there is no previous position, so it returns
 * null rather than implying a trend.
 */
export function playerSeriesPosition(data, playerId, opts = {}) {
  const now = computeSeriesStandings(data, opts);
  const mine = now.table.find((r) => r.playerId === playerId) || null;

  let movement = null;
  // Only matchdays that actually produced a completed match count as played —
  // a scheduled-but-unplayed one must not shift anybody's position.
  const playedIds = new Set(
    (data.matches || [])
      .filter((m) => DONE.includes(m.status))
      .map((m) => data.tournamentByEvent?.[m.event_id])
      .filter(Boolean)
  );
  const played = (data.tournaments || [])
    .filter((t) => playedIds.has(t.id))
    .sort((a, b) => (a.series_round ?? 999) - (b.series_round ?? 999) || (a.start_date || "").localeCompare(b.start_date || ""));

  if (mine && played.length >= 2) {
    const latestId = played[played.length - 1].id;
    const before = computeSeriesStandings({
      ...data,
      tournaments: played.slice(0, -1),
      matches: (data.matches || []).filter((m) => data.tournamentByEvent[m.event_id] !== latestId),
      entries: (data.entries || []).filter((e) => data.tournamentByEvent[e.event_id] !== latestId),
    }, opts);
    const prev = before.table.find((r) => r.playerId === playerId);
    if (prev) movement = prev.position - mine.position; // positive = moved up
  }

  return { ...now, mine, movement };
}
