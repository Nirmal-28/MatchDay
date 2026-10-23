// "Kab hai mera match?" — when will this match actually get on court.
//
// The most-asked question at any Indian club tournament, by players and by
// the parents who drove them there. The printed schedule answers it at 9am;
// by 2pm it is an hour or two out, and the only way to find out is to stand
// at the organizer's desk. The organizer's Command Center already models
// real pace (intelligence.js); this turns that into a per-match answer a
// player can read on their phone.
//
// Model, deliberately simple enough to explain on screen:
//   on-court-at = now
//               + what is left of the match on court now
//               + (matches queued ahead on the same court) × (match length + changeover)
//   and never earlier than the match's own scheduled time.
// Match length is the median of matches actually played at this tournament
// (durationModel), falling back to the organizer's configured length — and
// the result says which, so a guess is never shown as a measurement.
//
// Pure: `now` is injected.

import { durationModel } from "./intelligence.js";

const DONE = ["COMPLETED", "WALKOVER"];
const courtKey = (m) => m.court_id || (m.court ? `name:${m.court}` : null);
const minsBetween = (a, b) => (new Date(b).getTime() - new Date(a).getTime()) / 60000;

// Only worth estimating on the day: a match next week has its scheduled time.
const HORIZON_MINS = 12 * 60;

/**
 * @param match     the match to estimate
 * @param matches   every match in the tournament (all categories share courts)
 * @param settings  tournament.settings (matchDurationMins, bufferMins)
 * @returns {
 *   available, reason?,
 *   etaIso, aheadCount, liveOnCourt, minsLate, court,
 *   basis: 'OBSERVED'|'CONFIGURED', sample, durationMins, waitingOnResult
 * }
 */
export function matchEta({ match, matches, settings = {}, now = Date.now() }) {
  if (!match) return { available: false, reason: "No match." };
  if (DONE.includes(match.status)) return { available: false, reason: "This match is finished." };
  if (match.status === "LIVE") return { available: false, reason: "This match is on court now.", onCourtNow: true };
  const key = courtKey(match);
  if (!key || !match.scheduled_at) return { available: false, reason: "No court and time assigned yet." };
  if (minsBetween(now, match.scheduled_at) > HORIZON_MINS) {
    return { available: false, reason: "Too far ahead to estimate — see the scheduled time." };
  }

  const real = (matches || []).filter((m) => !m.is_bye);
  const model = durationModel(real, settings);
  const changeover = Number(settings.bufferMins) || 5;
  const perMatch = model.mins + changeover;

  const onCourt = real.filter((m) => courtKey(m) === key && m.id !== match.id && !DONE.includes(m.status));
  const live = onCourt.filter((m) => m.status === "LIVE");
  // Ahead in the court's order: scheduled earlier, or same slot with a lower
  // match number. Matches not yet given a time are not in the queue.
  const ahead = onCourt.filter((m) => m.status !== "LIVE" && m.scheduled_at && (
    m.scheduled_at < match.scheduled_at ||
    (m.scheduled_at === match.scheduled_at && (m.match_number ?? 0) < (match.match_number ?? 0))
  ));

  const liveLeft = live.reduce((s, m) => {
    const elapsed = m.started_at ? minsBetween(m.started_at, now) : 0;
    return s + Math.max(5, model.mins - elapsed) + changeover;
  }, 0);
  const work = liveLeft + ahead.length * perMatch;
  const etaMs = Math.max(new Date(match.scheduled_at).getTime(), now + work * 60000);

  return {
    available: true,
    etaIso: new Date(etaMs).toISOString(),
    aheadCount: ahead.length,
    liveOnCourt: live.length > 0,
    minsLate: Math.max(0, Math.round((etaMs - new Date(match.scheduled_at).getTime()) / 60000)),
    court: match.court || null,
    basis: model.basis,
    sample: model.sample,
    durationMins: model.mins,
    // A knockout match whose players are not both known yet still has a
    // court slot, but its line-up depends on a result.
    waitingOnResult: !match.entry_a || !match.entry_b,
  };
}

// One line a player can read in a hall: "2 matches ahead · around 4:40 PM".
export function etaSentence(eta, fmtTime) {
  if (!eta?.available) return eta?.reason || "";
  const queue = eta.aheadCount === 0
    ? (eta.liveOnCourt ? "Next on court after the current match" : "Next up on this court")
    : `${eta.aheadCount} match${eta.aheadCount === 1 ? "" : "es"} ahead of you${eta.liveOnCourt ? ", plus the one on court" : ""}`;
  return `${queue} · around ${fmtTime(eta.etaIso)}`;
}
