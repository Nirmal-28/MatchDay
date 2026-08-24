// MatchDay — Tournament Intelligence.
//
// The layer that turns the data the Command Center already has into the
// judgements an organizer actually needs on tournament day: is this running
// to time, what is about to go wrong, and what should I do about it.
//
// Same discipline as analytics.js, and it matters more here because these are
// PREDICTIONS: every number traces to real rows, and anything that cannot be
// derived honestly returns an explicit `{ available: false, reason }` rather
// than a confident-looking zero. A projected finish time that is really a
// guess dressed as a fact is worse than no projection at all — an organizer
// will tell players to come at that time.
//
// Pure functions only. No Supabase, no React, no clock of its own (`now` is
// always injected) so every branch is testable.

const DONE = ["COMPLETED", "WALKOVER"];
const ACTIVE_REG = ["PENDING", "CONFIRMED", "WAITLISTED"];

const minsBetween = (a, b) => (b.getTime() - a.getTime()) / 60000;
const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/* ─────────────────────────── match duration model ───────────────────────── */

// How long a match actually takes here, and how much we trust that number.
//
// Median rather than mean: one match that sat "live" over a lunch break
// because nobody pressed finish would drag a mean badly, and that is a common
// real-world data-quality problem rather than a rare one.
export function durationModel(matches, settings = {}) {
  const configured = Number(settings.matchDurationMins) || 40;
  const observed = matches
    .filter((m) => !m.is_bye && DONE.includes(m.status) && m.started_at && m.completed_at)
    .map((m) => minsBetween(new Date(m.started_at), new Date(m.completed_at)))
    // A "duration" outside these bounds is a data artefact (a forgotten timer,
    // a clock skew), not a badminton match. Excluded from the model rather
    // than allowed to poison it.
    .filter((d) => d >= 5 && d <= 180);

  if (observed.length >= 5) {
    return { mins: Math.round(median(observed)), basis: "OBSERVED", sample: observed.length, confidence: "HIGH" };
  }
  if (observed.length >= 3) {
    return { mins: Math.round(median(observed)), basis: "OBSERVED", sample: observed.length, confidence: "MEDIUM" };
  }
  return { mins: configured, basis: "CONFIGURED", sample: observed.length, confidence: "LOW" };
}

/* ──────────────────────────── projected finish ──────────────────────────── */

// When this tournament will actually end, from throughput rather than from
// the published schedule — the published schedule is what was planned, and by
// mid-afternoon it is usually fiction.
//
// Model: remaining matches / courts that can run in parallel, times the
// per-match duration. Dependency chains (a final cannot start until its
// semifinals end) mean the true floor is at least the depth of the longest
// remaining round chain, so we take the larger of the two.
export function projectedFinish({ matches, courts, settings = {}, now = Date.now() }) {
  const real = matches.filter((m) => !m.is_bye);
  const remaining = real.filter((m) => !DONE.includes(m.status));

  if (!real.length) {
    return { available: false, reason: "No draw has been generated yet." };
  }
  if (!remaining.length) {
    const last = real
      .map((m) => m.completed_at)
      .filter(Boolean)
      .sort()
      .pop();
    return { available: true, complete: true, iso: last || null, reason: "Every match is finished." };
  }

  const activeCourts = courts.filter((c) => c.status !== "UNAVAILABLE" && c.active !== false);
  if (!activeCourts.length) {
    return { available: false, reason: "No courts are available, so nothing can be projected." };
  }

  const model = durationModel(real, settings);
  const buffer = Number(settings.bufferMins) || 5;
  const perSlot = model.mins + buffer;

  // Work still to do, in court-minutes, spread across the courts available.
  // Matches already running have only their remainder left.
  const live = remaining.filter((m) => m.status === "LIVE");
  const notStarted = remaining.length - live.length;
  const liveRemainingMins = live.reduce((s, m) => {
    const elapsed = m.started_at ? minsBetween(new Date(m.started_at), new Date(now)) : 0;
    return s + Math.max(5, model.mins - elapsed);
  }, 0);

  const throughputMins = (notStarted * perSlot + liveRemainingMins) / activeCourts.length;

  // Dependency floor: the deepest remaining chain of rounds must run in
  // sequence no matter how many courts are free.
  const roundsLeft = new Set(remaining.map((m) => m.round ?? 0)).size;
  const chainMins = roundsLeft * perSlot;

  const mins = Math.ceil(Math.max(throughputMins, chainMins));
  const iso = new Date(now + mins * 60000).toISOString();

  return {
    available: true,
    complete: false,
    iso,
    minsRemaining: mins,
    remainingMatches: remaining.length,
    courtsUsed: activeCourts.length,
    basis: model.basis,
    confidence: model.confidence,
    durationMins: model.mins,
    sample: model.sample,
    limitedBy: chainMins > throughputMins ? "DEPENDENCIES" : "COURTS",
  };
}

/* ─────────────────────────── schedule deviation ─────────────────────────── */

// How far behind (or ahead of) its own published schedule the tournament is
// running. Measured only against matches that actually started, because a
// match that has not started yet has not deviated — it is merely late, which
// is counted separately.
export function scheduleDeviation({ matches, now = Date.now() }) {
  const real = matches.filter((m) => !m.is_bye);
  const started = real.filter((m) => m.scheduled_at && m.started_at);
  const deltas = started.map((m) => minsBetween(new Date(m.scheduled_at), new Date(m.started_at)));

  const overdue = real.filter(
    (m) => m.scheduled_at && !m.started_at && !DONE.includes(m.status) &&
           new Date(m.scheduled_at).getTime() < now
  );
  const worstOverdueMins = overdue.length
    ? Math.max(...overdue.map((m) => minsBetween(new Date(m.scheduled_at), new Date(now))))
    : 0;

  if (deltas.length < 3) {
    return {
      available: false,
      reason: started.length
        ? `Only ${started.length} match${started.length === 1 ? " has" : "es have"} started — not enough to measure a trend yet.`
        : "No match has started yet.",
      overdueCount: overdue.length,
      worstOverdueMins: Math.round(worstOverdueMins),
    };
  }

  const meanDelta = avg(deltas);
  return {
    available: true,
    minsBehind: Math.round(meanDelta),
    direction: meanDelta > 2 ? "BEHIND" : meanDelta < -2 ? "AHEAD" : "ON_TIME",
    sample: deltas.length,
    overdueCount: overdue.length,
    worstOverdueMins: Math.round(worstOverdueMins),
  };
}

/* ───────────────────────────── court bottlenecks ────────────────────────── */

// A court is a bottleneck when the work still queued on it is materially more
// than the tournament average — that is the court that will decide when
// everyone goes home, and the one worth moving a match off.
export function courtBottlenecks({ matches, courts, settings = {}, now = Date.now() }) {
  const real = matches.filter((m) => !m.is_bye);
  const model = durationModel(real, settings);
  const perSlot = model.mins + (Number(settings.bufferMins) || 5);

  const active = courts.filter((c) => c.status !== "UNAVAILABLE" && c.active !== false);
  if (active.length < 2) return [];

  const rows = active.map((c) => {
    const queued = real.filter(
      (m) => (m.court_id === c.id || m.court === c.name) && !DONE.includes(m.status)
    );
    const liveOnCourt = queued.find((m) => m.status === "LIVE");
    // A live match that has already run past the expected duration is the
    // clearest early signal that this court is slipping.
    const overrunMins = liveOnCourt?.started_at
      ? Math.max(0, minsBetween(new Date(liveOnCourt.started_at), new Date(now)) - model.mins)
      : 0;
    return { court: c, queued: queued.length, loadMins: queued.length * perSlot, overrunMins: Math.round(overrunMins) };
  });

  const meanLoad = avg(rows.map((r) => r.loadMins)) || 0;

  return rows
    .map((r) => ({
      ...r,
      excessMins: Math.round(r.loadMins - meanLoad),
      // Flag on either dimension: a queue well above average, or a match
      // currently overrunning badly enough to matter on its own.
      isBottleneck: (meanLoad > 0 && r.loadMins > meanLoad * 1.4 && r.loadMins - meanLoad >= perSlot) || r.overrunMins >= 15,
    }))
    .filter((r) => r.isBottleneck)
    .sort((a, b) => (b.excessMins + b.overrunMins) - (a.excessMins + a.overrunMins));
}

/* ──────────────────────────── player rest risk ──────────────────────────── */

// Players whose next match starts too soon after their previous one ends.
// Built from entries rather than the scheduling engine's Match shape so it
// works on exactly the data the Command Center already holds.
export function restRisks({ matches, entries, settings = {}, now = Date.now() }) {
  const minRest = Number(settings.minRestMins) || 20;
  const model = durationModel(matches.filter((m) => !m.is_bye), settings);

  // entry -> the people in it, so a conflict is reported per person even when
  // they play in several categories under different entries.
  const peopleByEntry = {};
  for (const e of entries) {
    peopleByEntry[e.id] = (e.entry_players || []).map((p) => p.player_id || p.name).filter(Boolean);
  }

  // Every future/live match, per person, in time order.
  const byPerson = {};
  for (const m of matches) {
    if (m.is_bye || DONE.includes(m.status)) continue;
    if (!m.scheduled_at) continue;
    for (const side of [m.entry_a, m.entry_b]) {
      for (const person of peopleByEntry[side] || []) {
        (byPerson[person] = byPerson[person] || []).push(m);
      }
    }
  }

  const risks = [];
  for (const [person, list] of Object.entries(byPerson)) {
    const sorted = [...list].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const next = sorted[i];
      // Expected end of the previous match: its own scheduled end if it has
      // one, otherwise start + the duration model.
      const prevEnd = prev.scheduled_end
        ? new Date(prev.scheduled_end)
        : new Date(new Date(prev.scheduled_at).getTime() + model.mins * 60000);
      const gap = minsBetween(prevEnd, new Date(next.scheduled_at));
      if (gap < minRest) {
        risks.push({
          person,
          restMins: Math.round(gap),
          minRestMins: minRest,
          firstMatchId: prev.id,
          secondMatchId: next.id,
          at: next.scheduled_at,
          // Only actionable while it is still ahead of us.
          upcoming: new Date(next.scheduled_at).getTime() > now,
        });
      }
    }
  }
  return risks.sort((a, b) => a.restMins - b.restMins);
}

/* ─────────────────────────── officials coverage ─────────────────────────── */

// Matches about to be played with nobody assigned to run them.
//
// Only reported when this tournament actually uses assigned officials — if an
// organizer runs matches without formally assigning a scorer (very common at
// club level), flagging every match as "missing an official" is noise that
// trains them to ignore the attention list.
export function officialsGaps({ matches, members = [], now = Date.now(), horizonMins = 90 }) {
  const real = matches.filter((m) => !m.is_bye);
  const usesOfficials =
    real.some((m) => m.scorer_id || m.referee_id) ||
    members.some((mem) => ["SCORER", "REFEREE"].includes(mem.role));

  if (!usesOfficials) {
    return { applicable: false, reason: "This tournament isn't assigning scorers or referees to matches.", matches: [] };
  }

  const horizon = now + horizonMins * 60000;
  const gaps = real.filter(
    (m) =>
      !DONE.includes(m.status) &&
      !m.scorer_id && !m.referee_id &&
      (m.status === "LIVE" ||
        (m.scheduled_at && new Date(m.scheduled_at).getTime() <= horizon))
  );
  return { applicable: true, matches: gaps };
}

/* ═══════════════════════════ THE HEALTH REPORT ══════════════════════════ */

const SEVERITY_RANK = { CRITICAL: 0, WARNING: 1, INFO: 2 };

// One call, everything the Tournament Health panel renders.
export function tournamentHealth({
  tournament, courts = [], entries = [], matches = [], members = [], now = Date.now(),
}) {
  const settings = tournament?.settings || {};
  const real = matches.filter((m) => !m.is_bye);
  const completed = real.filter((m) => DONE.includes(m.status));
  const activeEntries = entries.filter((e) => ACTIVE_REG.includes(e.reg_status));
  const checkedIn = activeEntries.filter((e) => e.check_in_status === "CHECKED_IN").length;

  const finish = projectedFinish({ matches, courts, settings, now });
  const deviation = scheduleDeviation({ matches, now });
  const bottlenecks = courtBottlenecks({ matches, courts, settings, now });
  const rest = restRisks({ matches, entries, settings, now }).filter((r) => r.upcoming);
  const officials = officialsGaps({ matches, members, now });
  const duration = durationModel(real, settings);

  /* ── Issues, most urgent first ──────────────────────────────────────── */
  const issues = [];

  if (deviation.available && deviation.direction === "BEHIND" && deviation.minsBehind >= 10) {
    issues.push({
      key: "behind",
      severity: deviation.minsBehind >= 25 ? "CRITICAL" : "WARNING",
      title: `Running ${Math.round(deviation.minsBehind)} min behind schedule`,
      detail: `Measured across ${deviation.sample} matches that have started.`,
      tab: "schedule",
    });
  }

  for (const b of bottlenecks.slice(0, 3)) {
    issues.push({
      key: `bottleneck-${b.court.id}`,
      severity: b.overrunMins >= 25 ? "CRITICAL" : "WARNING",
      title: b.overrunMins > 0
        ? `${b.court.name} is ${b.overrunMins} min into overtime`
        : `${b.court.name} is carrying ${b.queued} matches`,
      detail: b.overrunMins > 0
        ? "The match on this court has run past the expected length."
        : `About ${Math.round(b.excessMins)} min more work than the average court.`,
      tab: "schedule",
    });
  }

  if (rest.length) {
    issues.push({
      key: "rest",
      severity: "WARNING",
      title: `${rest.length} player${rest.length === 1 ? " has" : "s have"} insufficient rest`,
      detail: `Shortest gap is ${rest[0].restMins} min against a ${rest[0].minRestMins} min minimum.`,
      tab: "schedule",
    });
  }

  if (officials.applicable && officials.matches.length) {
    issues.push({
      key: "officials",
      severity: "WARNING",
      title: `${officials.matches.length} match${officials.matches.length === 1 ? "" : "es"} need an official`,
      detail: "Starting soon with no scorer or referee assigned.",
      tab: "staff",
    });
  }

  const notCheckedIn = activeEntries.length - checkedIn;
  if (tournament?.status === "LIVE" && notCheckedIn > 0) {
    const pct = activeEntries.length ? Math.round((checkedIn / activeEntries.length) * 100) : 0;
    issues.push({
      key: "checkin",
      severity: pct < 70 ? "WARNING" : "INFO",
      title: `${notCheckedIn} participant${notCheckedIn === 1 ? " has" : "s have"} not checked in`,
      detail: `${pct}% checked in.`,
      tab: "checkin",
    });
  }

  if (deviation.overdueCount > 0) {
    issues.push({
      key: "overdue",
      severity: deviation.worstOverdueMins >= 20 ? "CRITICAL" : "WARNING",
      title: `${deviation.overdueCount} match${deviation.overdueCount === 1 ? "" : "es"} past their start time`,
      detail: `The longest has been waiting ${deviation.worstOverdueMins} min.`,
      tab: "schedule",
    });
  }

  const noShows = activeEntries.filter((e) => e.check_in_status === "NO_SHOW").length;
  if (noShows > 0) {
    issues.push({
      key: "noshow",
      severity: "WARNING",
      title: `${noShows} participant${noShows === 1 ? " is" : "s are"} marked no-show`,
      detail: "Their matches may need a walkover recording.",
      tab: "checkin",
    });
  }

  const unpaid = entries.filter(
    (e) => !["REJECTED", "CANCELLED"].includes(e.reg_status) &&
           e.payment_status !== "PAID" && Number(e.fee_inr || 0) > 0
  ).length;
  if (unpaid > 0) {
    issues.push({
      key: "unpaid",
      severity: "INFO",
      title: `${unpaid} unpaid ${unpaid === 1 ? "entry" : "entries"}`,
      detail: "Entry fees not yet recorded against these registrations.",
      tab: "finance",
    });
  }

  const unscheduled = real.filter((m) => !m.scheduled_at && !DONE.includes(m.status)).length;
  if (unscheduled > 0 && tournament?.status !== "DRAFT") {
    issues.push({
      key: "unscheduled",
      severity: "WARNING",
      title: `${unscheduled} match${unscheduled === 1 ? " has" : "es have"} no time yet`,
      detail: "These are not in the projected finish time.",
      tab: "schedule",
    });
  }

  if (tournament?.status === "LIVE" && !tournament?.schedule_published) {
    issues.push({
      key: "unpublished",
      severity: "WARNING",
      title: "The schedule is not published to players",
      detail: "Players cannot see their court or start time.",
      tab: "schedule",
    });
  }

  issues.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);

  /* ── The single recommended action ──────────────────────────────────── */
  // One recommendation, not a list: an organizer mid-tournament needs to know
  // the next thing to do, and a menu of six is the same as none.
  let recommendation = null;
  if (unscheduled > 0) {
    recommendation = { action: "OPTIMIZE_SCHEDULE", label: "Optimize schedule", why: `${unscheduled} match${unscheduled === 1 ? "" : "es"} still need a time and court.`, tab: "schedule" };
  } else if (tournament?.status === "LIVE" && !tournament?.schedule_published) {
    recommendation = { action: "PUBLISH_SCHEDULE", label: "Publish schedule", why: "Players cannot see when or where they play.", tab: "schedule" };
  } else if (bottlenecks.length || (deviation.available && deviation.minsBehind >= 15)) {
    recommendation = { action: "OPTIMIZE_SCHEDULE", label: "Re-optimize remaining matches", why: bottlenecks.length ? `${bottlenecks[0].court.name} is holding up the finish time.` : `The tournament is ${Math.round(deviation.minsBehind)} min behind.`, tab: "schedule" };
  } else if (tournament?.status === "LIVE" && notCheckedIn > 0) {
    recommendation = { action: "OPEN_CHECKIN", label: "Chase check-in", why: `${notCheckedIn} still to arrive.`, tab: "checkin" };
  } else if (officials.applicable && officials.matches.length) {
    recommendation = { action: "ASSIGN_OFFICIALS", label: "Assign officials", why: `${officials.matches.length} upcoming match${officials.matches.length === 1 ? "" : "es"} have nobody assigned.`, tab: "staff" };
  }

  /* ── Headline grade ─────────────────────────────────────────────────── */
  const critical = issues.filter((i) => i.severity === "CRITICAL").length;
  const warnings = issues.filter((i) => i.severity === "WARNING").length;
  const status = critical > 0 ? "AT_RISK" : warnings > 1 ? "WATCH" : "ON_TRACK";

  return {
    status,
    progress: {
      completed: completed.length,
      total: real.length,
      pct: real.length ? Math.round((completed.length / real.length) * 100) : 0,
    },
    checkIn: {
      checkedIn,
      expected: activeEntries.length,
      pct: activeEntries.length ? Math.round((checkedIn / activeEntries.length) * 100) : null,
    },
    finish,
    deviation,
    bottlenecks,
    restRisks: rest,
    officials,
    duration,
    issues,
    recommendation,
    counts: { critical, warnings },
  };
}

/* ═════════════════════ FIRST-TIME ORGANIZER ESTIMATES ═══════════════════ */

// How many matches a format actually produces. Mirrors the generators in
// repository.js exactly — if these disagree, the preview is lying.
export function matchCountFor({ format = "SINGLE_ELIM", entries = 0, groupCount = 2, advancePerGroup = 2 }) {
  const n = Math.max(0, Math.floor(entries));
  if (n < 2) return 0;
  if (format === "ROUND_ROBIN") return (n * (n - 1)) / 2;
  if (format === "GROUP_KO") {
    const groups = Math.max(1, groupCount);
    // Groups are snake-filled, so sizes differ by at most one.
    const base = Math.floor(n / groups);
    const bigger = n % groups;
    const groupMatches =
      bigger * ((base + 1) * base) / 2 + (groups - bigger) * (base * (base - 1)) / 2;
    const koField = groups * advancePerGroup;
    let size = 1;
    while (size < koField) size *= 2;
    return groupMatches + Math.max(0, size - 1);
  }
  return n - 1; // single elimination: every entry but the winner loses once
}

// The honest answer to "can I actually run this in a day?" for the create
// wizard. Everything here is arithmetic over what the organizer just typed —
// no promises the scheduling engine cannot keep.
export function estimateTournament({
  categories = [], courtsCount = 2, matchDurationMins = 40, bufferMins = 5,
  startTime = "09:00", endTime = "21:00", days = 1,
}) {
  const perCategory = categories.map((c) => ({
    category: c.category,
    entries: Number(c.maxEntries) || 0,
    format: c.format || "SINGLE_ELIM",
    matches: matchCountFor({
      format: c.format || "SINGLE_ELIM",
      entries: Number(c.maxEntries) || 0,
      groupCount: Number(c.groupCount) || 2,
      advancePerGroup: Number(c.advancePerGroup) || 2,
    }),
  }));

  const totalMatches = perCategory.reduce((s, c) => s + c.matches, 0);
  const totalEntries = perCategory.reduce((s, c) => s + c.entries, 0);
  const courts = Math.max(1, Number(courtsCount) || 1);
  const perSlot = (Number(matchDurationMins) || 40) + (Number(bufferMins) || 5);

  const [sh, sm] = String(startTime).split(":").map(Number);
  const [eh, em] = String(endTime).split(":").map(Number);
  const dayMins = Math.max(0, (eh * 60 + em) - (sh * 60 + sm));
  const capacityMins = dayMins * courts * Math.max(1, days);
  const requiredMins = totalMatches * perSlot;

  // Court-minutes needed vs available. Rounds cannot run in parallel with
  // themselves, so a deep knockout has a floor no number of courts removes.
  const deepestChain = Math.max(
    0,
    ...perCategory.map((c) => {
      if (!c.entries || c.entries < 2) return 0;
      if (c.format === "ROUND_ROBIN") return c.entries % 2 === 0 ? c.entries - 1 : c.entries;
      return Math.ceil(Math.log2(c.entries));
    })
  );
  const chainMins = deepestChain * perSlot;
  const runMins = Math.max(Math.ceil(requiredMins / courts), chainMins);

  const warnings = [];
  if (!totalMatches) {
    warnings.push("No categories configured yet, so there's nothing to estimate.");
  } else if (capacityMins > 0 && requiredMins > capacityMins) {
    const shortfallCourts = Math.ceil(requiredMins / (dayMins * Math.max(1, days))) - courts;
    warnings.push(
      `This needs about ${Math.round(requiredMins / 60)} court-hours but you have ${Math.round(capacityMins / 60)}. ` +
      `Add ${shortfallCourts} more court${shortfallCourts === 1 ? "" : "s"}, another day, or fewer entries.`
    );
  }
  if (dayMins <= 0) warnings.push("The daily end time is not after the start time.");
  if (chainMins > dayMins * Math.max(1, days)) {
    warnings.push("Even with unlimited courts, the rounds have to run one after another and won't fit in the day.");
  }

  const finishMins = sh * 60 + sm + runMins;
  const fits = totalMatches > 0 && capacityMins > 0 && requiredMins <= capacityMins && chainMins <= dayMins * Math.max(1, days);

  return {
    totalMatches,
    totalEntries,
    perCategory,
    courts,
    perSlotMins: perSlot,
    courtHoursNeeded: Math.round((requiredMins / 60) * 10) / 10,
    courtHoursAvailable: Math.round((capacityMins / 60) * 10) / 10,
    estimatedRunMins: runMins,
    // Only meaningful when it lands inside the day it started.
    estimatedFinish: finishMins <= 24 * 60
      ? `${String(Math.floor(finishMins / 60)).padStart(2, "0")}:${String(finishMins % 60).padStart(2, "0")}`
      : null,
    recommendedCourts: dayMins > 0 ? Math.max(1, Math.ceil(requiredMins / (dayMins * Math.max(1, days)))) : courts,
    fits,
    warnings,
  };
}

/* ─────────────────────────── presentation helpers ───────────────────────── */

export const HEALTH_STATUS_META = {
  ON_TRACK: { label: "On track", tone: "emerald" },
  WATCH: { label: "Watch", tone: "amber" },
  AT_RISK: { label: "At risk", tone: "red" },
};

export const SEVERITY_TONE = { CRITICAL: "red", WARNING: "amber", INFO: "slate" };

// "7:42 PM" — the format an organizer reads off a screen at a glance.
export function fmtClock(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  } catch { return "—"; }
}

// Confidence stated in words, because "7:42 PM" implies a precision that a
// three-match sample does not have.
export const CONFIDENCE_NOTE = {
  HIGH: "based on how long matches are actually taking here",
  MEDIUM: "based on a small sample of completed matches",
  LOW: "based on your configured match length — no matches have finished yet",
};
