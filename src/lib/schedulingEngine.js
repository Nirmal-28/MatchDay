// MatchDay — Smart Scheduling + Conflict Detection engine.
//
// Pure, framework-agnostic functions: no Supabase, no React. Works over a
// generic Match/Court/Constraint shape so it can later serve any sport, not
// just badminton (see repository.js for how the real data gets mapped into
// this shape and back).
//
//   Match {
//     id, eventId, round, matchNumber,
//     participantIds: string[]           // player ids on both sides, flattened
//     dependsOn: string[]                // match ids that must finish first
//     status, locked, priority: 'NORMAL'|'HIGH'|'CRITICAL'
//     scheduledStart, scheduledEnd: ISO string | null
//     courtId: string | null
//   }
//   Court {
//     id, name, active, availableStart: 'HH:MM', availableEnd: 'HH:MM',
//     availabilityByDate?: { [date]: { start: 'HH:MM', end: 'HH:MM' } }  // per-day override
//   }
//   Constraints {
//     dates: string[]                    // ordered 'YYYY-MM-DD' — one or more days
//     tournamentStart, tournamentEnd: 'HH:MM'  // daily hours, same every active day
//     durationMins, bufferMins, minRestMins,
//   }
// Single-day callers may still pass `date` instead of `dates` — normalized
// by activeDates() below, so multi-day support is additive, not breaking.

const SLOT_GRANULARITY_MINS = 5;

/* ------------------------------- time helpers ----------------------------- */

function toDate(dateStr, hhmm) {
  return new Date(`${dateStr}T${hhmm}:00`);
}
function addMins(date, mins) {
  return new Date(date.getTime() + mins * 60000);
}
function minsBetween(a, b) {
  return (b.getTime() - a.getTime()) / 60000;
}
function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}
function localDateStr(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function activeDates(constraints) {
  return constraints.dates && constraints.dates.length ? constraints.dates : [constraints.date];
}
function courtWindowForDate(court, dateStr) {
  const override = court.availabilityByDate && court.availabilityByDate[dateStr];
  return {
    start: override ? override.start : court.availableStart,
    end: override ? override.end : court.availableEnd,
  };
}

/* ------------------------------ dependency graph --------------------------- */

// A match "depends on" the matches that must complete before its participants
// are known (knockout: the two matches feeding it via next_match_id). Callers
// building the Match[] should already resolve `dependsOn`; this helper exists
// for callers working from raw matches with next_match_id/next_slot instead.
export function dependencyMapFromNextMatchId(rawMatches) {
  const dependsOn = {};
  rawMatches.forEach((m) => (dependsOn[m.id] = []));
  rawMatches.forEach((m) => {
    if (m.next_match_id && dependsOn[m.next_match_id]) dependsOn[m.next_match_id].push(m.id);
  });
  return dependsOn;
}

function isKnownParticipants(match) {
  return (match.participantIds || []).length > 0;
}

/* ------------------------------ conflict detection -------------------------- */

// Detects every conflict across the given matches. `matches` should include
// ALL scheduled matches across the whole tournament (every category/event),
// since a player conflict can span categories (section 32).
export function detectConflicts(matches, courts, constraints) {
  const conflicts = [];
  const courtsById = Object.fromEntries(courts.map((c) => [c.id, c]));
  const scheduled = matches.filter((m) => m.scheduledStart && m.scheduledEnd);
  const dates = activeDates(constraints);
  const dateSet = new Set(dates);

  for (const m of scheduled) {
    const start = new Date(m.scheduledStart);
    const end = new Date(m.scheduledEnd);
    const court = m.courtId ? courtsById[m.courtId] : null;
    const dateStr = localDateStr(start);
    const tWindowStart = toDate(dateStr, constraints.tournamentStart);
    const tWindowEnd = toDate(dateStr, constraints.tournamentEnd);

    // Tournament window (including: is this even one of the tournament's active days?)
    if (!dateSet.has(dateStr) || start < tWindowStart || end > tWindowEnd) {
      conflicts.push({
        id: `WINDOW-${m.id}`, type: "TOURNAMENT_WINDOW", severity: "HARD",
        matchId: m.id,
        message: dateSet.has(dateStr)
          ? `Match finishes outside tournament hours (${constraints.tournamentStart}–${constraints.tournamentEnd}).`
          : `Match is scheduled on ${dateStr}, which isn't one of the tournament's active days.`,
        suggestion: "Move it earlier, extend tournament hours, or add another court.",
      });
    }

    // Court availability
    if (court) {
      if (!court.active) {
        conflicts.push({
          id: `COURT_INACTIVE-${m.id}`, type: "COURT_UNAVAILABLE", severity: "HARD",
          matchId: m.id, courtId: court.id,
          message: `${court.name} is marked inactive.`,
          suggestion: "Reassign to an active court.",
        });
      } else {
        const win = courtWindowForDate(court, dateStr);
        const availStart = toDate(dateStr, win.start);
        const availEnd = toDate(dateStr, win.end);
        if (start < availStart || end > availEnd) {
          conflicts.push({
            id: `COURT_AVAIL-${m.id}`, type: "COURT_UNAVAILABLE", severity: "HARD",
            matchId: m.id, courtId: court.id,
            message: `${court.name} is only available ${win.start}–${win.end} on ${dateStr}.`,
            suggestion: "Move to a court that's open at this time.",
          });
        }
      }
    }

    // Dependency: must not start before its predecessor matches finish (+buffer)
    for (const depId of m.dependsOn || []) {
      const dep = matches.find((x) => x.id === depId);
      if (!dep) continue;
      const depFinished = dep.status === "COMPLETED" || dep.status === "WALKOVER";
      if (depFinished) continue;
      const depEnd = dep.scheduledEnd ? new Date(dep.scheduledEnd) : null;
      if (!depEnd || start.getTime() < addMins(depEnd, constraints.bufferMins).getTime()) {
        conflicts.push({
          id: `DEP-${m.id}-${depId}`, type: "DEPENDENCY_VIOLATION", severity: "HARD",
          matchId: m.id, relatedMatchId: depId,
          message: `This match is scheduled before match #${dep.matchNumber ?? depId} (its result isn't known yet).`,
          suggestion: "Schedule after the prerequisite match completes.",
        });
      }
    }
  }

  // Court conflicts: same court, overlapping times
  const byCourt = {};
  scheduled.filter((m) => m.courtId).forEach((m) => (byCourt[m.courtId] = byCourt[m.courtId] || []).push(m));
  for (const list of Object.values(byCourt)) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (overlaps(new Date(a.scheduledStart), new Date(a.scheduledEnd), new Date(b.scheduledStart), new Date(b.scheduledEnd))) {
          conflicts.push({
            id: `COURT-${a.id}-${b.id}`, type: "COURT_CONFLICT", severity: "HARD",
            matchId: a.id, relatedMatchId: b.id, courtId: a.courtId,
            message: `Two matches are booked on the same court at overlapping times.`,
            suggestion: "Move one match to a different court or time.",
          });
        }
      }
    }
  }

  // Player conflicts + rest violations: group by participant across ALL matches
  const byPlayer = {};
  scheduled.forEach((m) => {
    (m.participantIds || []).forEach((pid) => (byPlayer[pid] = byPlayer[pid] || []).push(m));
  });
  for (const [playerId, list] of Object.entries(byPlayer)) {
    const sorted = [...list].sort((a, b) => new Date(a.scheduledStart) - new Date(b.scheduledStart));
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i], b = sorted[j];
        const aEnd = new Date(a.scheduledEnd), bStart = new Date(b.scheduledStart);
        if (overlaps(new Date(a.scheduledStart), aEnd, bStart, new Date(b.scheduledEnd))) {
          conflicts.push({
            id: `PLAYER-${a.id}-${b.id}-${playerId}`, type: "PLAYER_CONFLICT", severity: "HARD",
            matchId: a.id, relatedMatchId: b.id, playerId,
            message: `A participant is booked in two overlapping matches.`,
            suggestion: "Reschedule one of these matches to a non-overlapping time.",
          });
        } else if (bStart > aEnd) {
          const rest = minsBetween(aEnd, bStart);
          if (rest < constraints.minRestMins) {
            conflicts.push({
              id: `REST-${a.id}-${b.id}-${playerId}`, type: "REST_VIOLATION", severity: "WARNING",
              matchId: a.id, relatedMatchId: b.id, playerId,
              message: `A participant has only ${Math.round(rest)} min rest between matches (recommended minimum: ${constraints.minRestMins} min).`,
              suggestion: "Push the second match later, or move it to reduce back-to-back play.",
            });
          }
        }
      }
    }
  }

  // Informational: court idle gaps within each active day's window
  for (const court of courts.filter((c) => c.active)) {
    for (const dateStr of dates) {
      const list = (byCourt[court.id] || [])
        .filter((m) => localDateStr(new Date(m.scheduledStart)) === dateStr)
        .sort((a, b) => new Date(a.scheduledStart) - new Date(b.scheduledStart));
      const tWindowStart = toDate(dateStr, constraints.tournamentStart);
      const tWindowEnd = toDate(dateStr, constraints.tournamentEnd);
      const win = courtWindowForDate(court, dateStr);
      const availStart = toDate(dateStr, win.start);
      const availEnd = toDate(dateStr, win.end);
      let cursor = availStart < tWindowStart ? tWindowStart : availStart;
      const hardEnd = availEnd < tWindowEnd ? availEnd : tWindowEnd;
      for (const m of list) {
        const start = new Date(m.scheduledStart);
        const gap = minsBetween(cursor, start);
        if (gap >= constraints.durationMins + constraints.bufferMins + 30) {
          conflicts.push({
            id: `IDLE-${court.id}-${cursor.toISOString()}`, type: "COURT_IDLE", severity: "INFO",
            courtId: court.id,
            message: `${court.name} is unused for ${Math.round(gap)} min before ${start.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} on ${dateStr}.`,
            suggestion: "A later match could be moved here to finish the tournament sooner.",
          });
        }
        cursor = new Date(m.scheduledEnd) > cursor ? new Date(m.scheduledEnd) : cursor;
      }
      const tailGap = minsBetween(cursor, hardEnd);
      if (tailGap >= constraints.durationMins + constraints.bufferMins + 30) {
        conflicts.push({
          id: `IDLE-TAIL-${court.id}-${dateStr}`, type: "COURT_IDLE", severity: "INFO",
          courtId: court.id,
          message: `${court.name} is unused for the last ${Math.round(tailGap)} min of ${dateStr}.`,
          suggestion: "This capacity is available for late-running matches.",
        });
      }
    }
  }

  const severityRank = { HARD: 0, WARNING: 1, INFO: 2 };
  return conflicts.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
}

/* ------------------------------ slot search --------------------------------- */

// Every feasible (court, start) slot for `match`, respecting court
// availability, tournament window, other scheduled matches, and player rest —
// but NOT dependency timing (callers filter that separately, since it needs
// the earliest-eligible-start passed in).
function candidateSlots(match, otherMatches, courts, constraints, earliestStart) {
  const duration = constraints.durationMins;
  const step = SLOT_GRANULARITY_MINS;
  const dates = activeDates(constraints);

  const byCourtOthers = {};
  otherMatches.filter((m) => m.id !== match.id && m.courtId && m.scheduledStart).forEach((m) => {
    (byCourtOthers[m.courtId] = byCourtOthers[m.courtId] || []).push(m);
  });
  const byPlayerOthers = {};
  otherMatches.filter((m) => m.id !== match.id && m.scheduledStart).forEach((m) => {
    (m.participantIds || []).forEach((pid) => (byPlayerOthers[pid] = byPlayerOthers[pid] || []).push(m));
  });

  const results = [];
  for (const dateStr of dates) {
  const tWindowStart = toDate(dateStr, constraints.tournamentStart);
  const tWindowEnd = toDate(dateStr, constraints.tournamentEnd);
  if (tWindowEnd <= earliestStart) continue; // whole day is before the earliest eligible moment
  const dayStart = earliestStart > tWindowStart ? earliestStart : tWindowStart;

  for (const court of courts.filter((c) => c.active)) {
    const win = courtWindowForDate(court, dateStr);
    const availStart = toDate(dateStr, win.start);
    const availEnd = toDate(dateStr, win.end);
    let cursor = dayStart > availStart ? dayStart : availStart;
    const hardEnd = tWindowEnd < availEnd ? tWindowEnd : availEnd;

    while (addMins(cursor, duration) <= hardEnd) {
      const start = new Date(cursor);
      const end = addMins(start, duration);

      const courtBusy = (byCourtOthers[court.id] || []).some((m) =>
        overlaps(start, end, new Date(m.scheduledStart), new Date(m.scheduledEnd)));

      let minRestSeen = Infinity;
      let playerConflict = false;
      for (const pid of match.participantIds || []) {
        for (const m of byPlayerOthers[pid] || []) {
          const mStart = new Date(m.scheduledStart), mEnd = new Date(m.scheduledEnd);
          if (overlaps(start, end, mStart, mEnd)) { playerConflict = true; break; }
          const rest = start >= mEnd ? minsBetween(mEnd, start) : minsBetween(end, mStart);
          if (rest < minRestSeen) minRestSeen = rest;
        }
        if (playerConflict) break;
      }

      if (!courtBusy && !playerConflict) {
        results.push({
          courtId: court.id, courtName: court.name,
          start: start.toISOString(), end: end.toISOString(),
          restMins: minRestSeen === Infinity ? null : minRestSeen,
          meetsRest: minRestSeen === Infinity || minRestSeen >= constraints.minRestMins,
        });
      }
      cursor = addMins(cursor, step);
    }
  }
  }
  return results;
}

function earliestEligibleStart(match, matchesById, constraints) {
  const tWindowStart = toDate(activeDates(constraints)[0], constraints.tournamentStart);
  let earliest = tWindowStart;
  for (const depId of match.dependsOn || []) {
    const dep = matchesById[depId];
    if (!dep) continue;
    const finished = dep.status === "COMPLETED" || dep.status === "WALKOVER";
    if (finished) continue;
    if (dep.scheduledEnd) {
      const readyAt = addMins(new Date(dep.scheduledEnd), constraints.bufferMins);
      if (readyAt > earliest) earliest = readyAt;
    }
  }
  return earliest;
}

// Score a candidate slot: lower is better (used to pick the "best" one).
// Weighs added tournament-completion time heaviest, then poor rest, then
// idle-time cost; CRITICAL matches get a small bonus for later, high-rest slots.
function scoreSlot(slot, match, constraints, tWindowStartMs) {
  const startMs = new Date(slot.start).getTime();
  let score = (startMs - tWindowStartMs) / 60000; // prefer earlier, in minutes
  if (slot.restMins != null) {
    const shortfall = Math.max(0, constraints.minRestMins - slot.restMins);
    score += shortfall * 3; // penalize short rest heavily
  }
  if (match.priority === "CRITICAL" && slot.restMins != null) {
    score -= Math.min(slot.restMins, 60) * 0.2; // critical matches prefer more rest
  }
  return score;
}

/* -------------------------------- generation --------------------------------- */

// Produces a full schedule. Locked matches are never moved. Returns a new
// matches array (same objects for untouched/locked matches) plus the
// conflicts detected in the result.
export function generateSchedule(matches, courts, constraints) {
  const matchesById = Object.fromEntries(matches.map((m) => [m.id, { ...m }]));
  const tWindowStartMs = toDate(activeDates(constraints)[0], constraints.tournamentStart).getTime();

  const locked = Object.values(matchesById).filter((m) => m.locked && m.scheduledStart);
  const eligible = Object.values(matchesById).filter((m) =>
    !m.locked &&
    m.status !== "COMPLETED" && m.status !== "WALKOVER" && m.status !== "CANCELLED" &&
    isKnownParticipants(m)
  );

  // Round order first (dependencies flow with round number), then priority
  // (CRITICAL/HIGH get first pick of good slots), then original match number.
  const priorityRank = { CRITICAL: 0, HIGH: 1, NORMAL: 2 };
  eligible.sort((a, b) =>
    (a.round ?? 0) - (b.round ?? 0) ||
    priorityRank[a.priority] - priorityRank[b.priority] ||
    (a.matchNumber ?? 0) - (b.matchNumber ?? 0)
  );

  const placed = [...locked];
  const unresolved = [];

  for (const match of eligible) {
    const earliest = earliestEligibleStart(match, matchesById, constraints);
    const slots = candidateSlots(match, placed, courts, constraints, earliest);
    if (slots.length === 0) {
      unresolved.push(match.id);
      continue;
    }
    // Prefer slots that satisfy rest; among those, pick lowest score. If none
    // satisfy rest, fall back to the least-bad option so the match is still
    // scheduled (and shows up as a REST_VIOLATION warning rather than vanishing).
    const restOk = slots.filter((s) => s.meetsRest);
    const pool = restOk.length ? restOk : slots;
    pool.sort((a, b) => scoreSlot(a, match, constraints, tWindowStartMs) - scoreSlot(b, match, constraints, tWindowStartMs));
    const best = pool[0];

    match.scheduledStart = best.start;
    match.scheduledEnd = best.end;
    match.courtId = best.courtId;
    matchesById[match.id] = match;
    placed.push(match);
  }

  const result = Object.values(matchesById);
  const conflicts = detectConflicts(result, courts, constraints);
  return { matches: result, conflicts, unresolved };
}

/* ------------------------------- find better slot ----------------------------- */

export function findBetterSlots(matchId, matches, courts, constraints, topN = 3) {
  const matchesById = Object.fromEntries(matches.map((m) => [m.id, m]));
  const match = matchesById[matchId];
  if (!match) return [];
  const others = matches.filter((m) => m.id !== matchId);
  const earliest = earliestEligibleStart(match, matchesById, constraints);
  const dates = activeDates(constraints);
  const tWindowStartMs = toDate(dates[0], constraints.tournamentStart).getTime();
  const tWindowEndMs = toDate(dates[dates.length - 1], constraints.tournamentEnd).getTime();

  const slots = candidateSlots(match, others, courts, constraints, earliest);
  const currentEndMs = match.scheduledEnd ? new Date(match.scheduledEnd).getTime() : tWindowEndMs;

  const annotated = slots.map((s) => {
    const notes = [];
    if (s.meetsRest) notes.push(s.restMins == null ? "No player conflict" : `${Math.round(s.restMins)} min player rest`);
    else notes.push(`⚠ Only ${Math.round(s.restMins)} min rest`);
    notes.push("Court available");
    const addedMins = Math.max(0, (new Date(s.end).getTime() - currentEndMs) / 60000);
    if (addedMins > 0) notes.push(`⚠ Adds ${Math.round(addedMins)} min to tournament duration`);
    return { ...s, notes, score: scoreSlot(s, match, constraints, tWindowStartMs) };
  });

  annotated.sort((a, b) => a.score - b.score);
  return annotated.slice(0, topN);
}

/* --------------------------------- quality score -------------------------------- */

export function scoreScheduleQuality(matches, courts, constraints) {
  const scheduled = matches.filter((m) => m.scheduledStart && m.scheduledEnd);
  const conflicts = detectConflicts(matches, courts, constraints);
  const hard = conflicts.filter((c) => c.severity === "HARD").length;
  const warnings = conflicts.filter((c) => c.severity === "WARNING").length;

  const dates = activeDates(constraints);
  const perDayWindowMins = minsBetween(toDate(dates[0], constraints.tournamentStart), toDate(dates[0], constraints.tournamentEnd));
  const totalWindowMins = perDayWindowMins * dates.length;
  const activeCourts = courts.filter((c) => c.active);
  const busyMinsByCourt = {};
  scheduled.forEach((m) => {
    if (!m.courtId) return;
    const mins = minsBetween(new Date(m.scheduledStart), new Date(m.scheduledEnd));
    busyMinsByCourt[m.courtId] = (busyMinsByCourt[m.courtId] || 0) + mins;
  });
  const utilizationByCourt = Object.fromEntries(
    activeCourts.map((c) => [c.id, totalWindowMins > 0 ? Math.round(((busyMinsByCourt[c.id] || 0) / totalWindowMins) * 100) : 0])
  );
  const avgUtilization = activeCourts.length
    ? Math.round(Object.values(utilizationByCourt).reduce((a, b) => a + b, 0) / activeCourts.length)
    : 0;

  const restViolations = conflicts.filter((c) => c.type === "REST_VIOLATION");
  const restSamples = [];
  const byPlayer = {};
  scheduled.forEach((m) => (m.participantIds || []).forEach((pid) => (byPlayer[pid] = byPlayer[pid] || []).push(m)));
  Object.values(byPlayer).forEach((list) => {
    const sorted = [...list].sort((a, b) => new Date(a.scheduledStart) - new Date(b.scheduledStart));
    for (let i = 1; i < sorted.length; i++) {
      restSamples.push(minsBetween(new Date(sorted[i - 1].scheduledEnd), new Date(sorted[i].scheduledStart)));
    }
  });
  const avgRestMins = restSamples.length ? Math.round(restSamples.reduce((a, b) => a + b, 0) / restSamples.length) : null;

  const completionTime = scheduled.length
    ? new Date(Math.max(...scheduled.map((m) => new Date(m.scheduledEnd).getTime())))
    : null;

  // Heuristic score, explicitly not a scientific optimum (see spec).
  let score = 100;
  score -= hard * 25;
  score -= warnings * 4;
  score -= Math.max(0, 80 - avgUtilization) * 0.15;
  score = Math.max(0, Math.min(100, Math.round(score)));

  const checklist = [];
  checklist.push({ ok: hard === 0, label: hard === 0 ? "No player conflicts" : `${hard} hard conflict(s)` });
  checklist.push({
    ok: !conflicts.some((c) => c.type === "COURT_CONFLICT"),
    label: conflicts.some((c) => c.type === "COURT_CONFLICT") ? "Court double-booking present" : "No court conflicts",
  });
  checklist.push({
    ok: !conflicts.some((c) => c.type === "TOURNAMENT_WINDOW"),
    label: conflicts.some((c) => c.type === "TOURNAMENT_WINDOW") ? "Some matches fall outside tournament hours" : "All matches within tournament hours",
  });
  checklist.push({
    ok: restViolations.length === 0,
    label: restViolations.length === 0 ? "Minimum rest satisfied" : `${restViolations.length} player(s) with short rest`,
  });

  return {
    score, hardConflicts: hard, warnings, avgUtilization, utilizationByCourt,
    avgRestMins, completionTime: completionTime ? completionTime.toISOString() : null,
    scheduledCount: scheduled.length, checklist, conflicts,
  };
}

/* ------------------------------ partial recheck --------------------------------- */

// Recomputes conflicts for the whole set (cheap at tournament scale — a few
// hundred matches at most) but flags which conflicts are "new" relative to
// matches connected to `changedMatchId` (its court, its participants, or its
// dependency chain), so the UI can highlight what actually changed without
// re-running full optimization (section 26).
export function recheckAfterMove(matches, courts, constraints, changedMatchId) {
  const conflicts = detectConflicts(matches, courts, constraints);
  const changed = matches.find((m) => m.id === changedMatchId);
  const affectedIds = new Set([changedMatchId]);
  if (changed) {
    matches.forEach((m) => {
      if (m.id === changedMatchId) return;
      const sharesCourt = m.courtId && m.courtId === changed.courtId;
      const sharesPlayer = (m.participantIds || []).some((p) => (changed.participantIds || []).includes(p));
      const dependency = (m.dependsOn || []).includes(changedMatchId) || (changed.dependsOn || []).includes(m.id);
      if (sharesCourt || sharesPlayer || dependency) affectedIds.add(m.id);
    });
  }
  const relevant = conflicts.filter((c) => affectedIds.has(c.matchId) || affectedIds.has(c.relatedMatchId));
  return { allConflicts: conflicts, affectedConflicts: relevant };
}
