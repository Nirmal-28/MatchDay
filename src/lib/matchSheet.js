/* The one-page paper version of a tournament: who is in each group, every
   match with a box for the points, for the organizer who keeps score with a
   pen. Printing mid-tournament fills in whatever has already been played, so
   the sheet never disagrees with the app. Byes never appear: nobody plays them. */

import {
  entryName, divisionLabel, fmtDateRange, fmtTime, groupDisplayName, roundLabel, toAB, parseGroupLabel, FORMAT_META,
} from "./engines";

function byGroup(matches) {
  const groups = new Map();
  matches.forEach((m) => {
    if (!groups.has(m.group_label)) groups.set(m.group_label, []);
    groups.get(m.group_label).push(m);
  });
  return [...groups].sort(([a], [b]) => {
    const x = parseGroupLabel(a), y = parseGroupLabel(b);
    return x.stage - y.stage || String(x.group).localeCompare(String(y.group));
  });
}

function buildCategory(event, entries, matches) {
  const entryById = Object.fromEntries(entries.map((e) => [e.id, e]));
  const name = (id) => entryName(entryById[id]);

  // A later knockout round has no players yet, so say whose winner goes there.
  const feederOf = {};
  matches.forEach((m) => {
    if (m.next_match_id && !m.is_bye) feederOf[`${m.next_match_id}:${m.next_slot}`] = m.match_number;
  });
  const side = (match, id, slot) => {
    if (id) return name(id);
    const from = feederOf[`${match.id}:${slot}`];
    return from ? `Winner of M${from}` : "";
  };

  const row = (m) => ({
    id: m.id,
    number: m.match_number,
    time: m.scheduled_at ? fmtTime(m.scheduled_at) : "",
    court: m.court || "",
    a: side(m, m.entry_a, "A"),
    b: side(m, m.entry_b, "B"),
    games: toAB(m.games).map((g) => `${g.a}-${g.b}`),
    note: m.status === "WALKOVER" ? "Walkover" : "",
  });

  const played = matches.filter((m) => !m.is_bye);
  const roundOrder = (a, b) => (a.round - b.round) || (a.match_number - b.match_number);
  const sections = [];

  byGroup(played.filter((m) => m.group_label)).forEach(([label, list]) => {
    const players = [...new Set(list.flatMap((m) => [m.entry_a, m.entry_b]).filter(Boolean))].map(name);
    sections.push({
      key: label,
      title: label === "RR" ? "Everyone plays everyone" : groupDisplayName(label),
      players,
      matches: [...list].sort(roundOrder).map(row),
    });
  });

  const knockout = played.filter((m) => !m.group_label);
  [...new Set(knockout.map((m) => m.round))].sort((a, b) => a - b).forEach((round) => {
    sections.push({
      key: `round-${round}`,
      title: roundLabel(round, event.total_rounds),
      players: [],
      matches: knockout.filter((m) => m.round === round).sort(roundOrder).map(row),
    });
  });

  // Groups first, knockout drawn from their results: leave lines to write it on.
  const advancing = (event.group_count || 2) * (event.advance_per_group || 2);
  const knockoutToCome = event.format === "GROUP_KO" && knockout.length === 0
    ? { note: `Top ${event.advance_per_group || 2} from each group go through.`, rows: Math.max(advancing - 1, 1) }
    : null;

  return { id: event.id, label: divisionLabel(event), format: FORMAT_META[event.format || "SINGLE_ELIM"].label, sections, knockoutToCome };
}

export function buildMatchSheet({ tournament, events, entriesByEvent, matchesByEvent }) {
  const settings = tournament.settings || {};
  const gameCount = Number(settings.gamesPerMatch) === 1 ? 1 : 3;
  return {
    title: tournament.name,
    meta: [tournament.venue, fmtDateRange(tournament.start_date, tournament.end_date)].filter(Boolean).join(" · "),
    rules: `${gameCount === 1 ? "One game" : "Best of 3"} to ${Number(settings.pointsPerGame) === 15 ? 15 : 21}`,
    gameCount,
    categories: events
      .map((e) => buildCategory(e, entriesByEvent[e.id] || [], matchesByEvent[e.id] || []))
      .filter((c) => c.sections.length > 0),
  };
}
