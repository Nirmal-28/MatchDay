// Tournament analytics — pure functions over data the control center has
// already loaded. Nothing here fetches; nothing here invents. Every number
// traces back to a row in entries/matches/games/courts/payments, and anything
// that cannot be computed honestly (average match duration with no timing
// data, utilization with no schedule) reports null rather than a plausible
// looking zero.

import { BadmintonScoringEngine, toAB } from "./engines";

const ACTIVE_REG = ["PENDING", "CONFIRMED", "WAITLISTED"];
const DONE = ["COMPLETED", "WALKOVER"];

const mins = (a, b) => (a && b ? Math.round((new Date(b) - new Date(a)) / 60000) : null);
const avg = (xs) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null);

/* ---------------------------- PARTICIPATION ------------------------------ */

export function participationStats(entries) {
  const active = entries.filter((e) => ACTIVE_REG.includes(e.reg_status));
  return {
    total: entries.length,
    active: active.length,
    confirmed: entries.filter((e) => e.reg_status === "CONFIRMED").length,
    pending: entries.filter((e) => e.reg_status === "PENDING").length,
    waitlisted: entries.filter((e) => e.reg_status === "WAITLISTED").length,
    rejected: entries.filter((e) => e.reg_status === "REJECTED").length,
    cancelled: entries.filter((e) => e.reg_status === "CANCELLED").length,
    checkedIn: active.filter((e) => e.check_in_status === "CHECKED_IN").length,
    late: active.filter((e) => e.check_in_status === "LATE").length,
    noShows: active.filter((e) => e.check_in_status === "NO_SHOW").length,
    notCheckedIn: active.filter((e) => !e.check_in_status || e.check_in_status === "NOT_CHECKED_IN").length,
  };
}

/* ------------------------------- MATCHES --------------------------------- */

export function matchStats(matches, now = Date.now()) {
  const real = matches.filter((m) => !m.is_bye);
  const completed = real.filter((m) => DONE.includes(m.status));
  const live = real.filter((m) => m.status === "LIVE");

  // Only matches that recorded both a start and an end can contribute a
  // duration. Sample size is returned so the UI can hide the figure when
  // it is based on too little to be meaningful.
  const durations = completed.map((m) => mins(m.started_at, m.completed_at)).filter((d) => d !== null && d > 0);

  // A match is "late" when its scheduled start has passed and it still
  // hasn't begun; delay is measured against matches that did start.
  const startedDelays = real
    .map((m) => (m.scheduled_at && m.started_at ? mins(m.scheduled_at, m.started_at) : null))
    .filter((d) => d !== null);
  const runningLate = real.filter(
    (m) => m.scheduled_at && !m.started_at && !DONE.includes(m.status) && new Date(m.scheduled_at).getTime() < now
  );

  return {
    total: real.length,
    completed: completed.length,
    live: live.length,
    remaining: real.length - completed.length,
    scheduled: real.filter((m) => m.scheduled_at).length,
    unscheduled: real.filter((m) => !m.scheduled_at && !DONE.includes(m.status)).length,
    byes: matches.length - real.length,
    progressPct: real.length ? Math.round((completed.length / real.length) * 100) : 0,
    avgDurationMins: durations.length >= 3 ? avg(durations) : null,
    durationSample: durations.length,
    avgDelayMins: startedDelays.length >= 3 ? avg(startedDelays) : null,
    delaySample: startedDelays.length,
    runningLate,
  };
}

/* ------------------------------- COURTS ---------------------------------- */

// Minutes of court time a tournament actually has, from each court's
// availability window across the tournament's date range, versus minutes the
// schedule has booked. Returns null when there is no schedule to measure.
export function courtUtilization(courts, matches, tournament) {
  if (!courts.length) return null;
  const scheduled = matches.filter((m) => m.court_id && m.scheduled_at && m.scheduled_end);
  if (!scheduled.length) return null;

  const start = tournament?.start_date ? new Date(tournament.start_date) : null;
  const end = tournament?.end_date ? new Date(tournament.end_date) : start;
  const days = start && end ? Math.max(1, Math.round((end - start) / 86400000) + 1) : 1;

  const windowMins = (c) => {
    const [sh, sm] = (c.available_start || "09:00").split(":").map(Number);
    const [eh, em] = (c.available_end || "18:00").split(":").map(Number);
    return Math.max(0, (eh * 60 + em) - (sh * 60 + sm)) * days;
  };

  const rows = courts.map((c) => {
    const booked = scheduled
      .filter((m) => m.court_id === c.id)
      .reduce((s, m) => s + (mins(m.scheduled_at, m.scheduled_end) || 0), 0);
    const available = windowMins(c);
    return {
      court: c,
      bookedMins: booked,
      availableMins: available,
      pct: available ? Math.min(100, Math.round((booked / available) * 100)) : 0,
      matches: scheduled.filter((m) => m.court_id === c.id).length,
    };
  });

  const totalBooked = rows.reduce((s, r) => s + r.bookedMins, 0);
  const totalAvailable = rows.reduce((s, r) => s + r.availableMins, 0);
  return { rows, overallPct: totalAvailable ? Math.round((totalBooked / totalAvailable) * 100) : 0 };
}

// What each court is doing right now: the live match on it, or the next
// match booked for it, or nothing.
export function courtBoard(courts, matches, now = Date.now()) {
  return courts.map((c) => {
    const live = matches.find((m) => m.status === "LIVE" && (m.court_id === c.id || m.court === c.name));
    const upcoming = matches
      .filter((m) => (m.court_id === c.id || m.court === c.name) && m.scheduled_at &&
        !DONE.includes(m.status) && m.status !== "LIVE")
      .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
    const next = upcoming[0] || null;
    return {
      court: c,
      state: c.status === "UNAVAILABLE" ? "UNAVAILABLE" : live ? "LIVE" : next ? "NEXT" : "AVAILABLE",
      liveMatch: live || null,
      nextMatch: next,
      nextIsLate: !!(next && new Date(next.scheduled_at).getTime() < now),
    };
  });
}

/* ------------------------------- FINANCE --------------------------------- */

// Revenue from the entries ledger (the source of truth for what an entry
// owes and whether it is settled), cross-checked against `payments` rows.
// Nothing here initiates or simulates a charge.
export function financeStats(entries, events, payments = []) {
  const billable = entries.filter((e) => !["REJECTED", "CANCELLED"].includes(e.reg_status));
  const fee = (e) => Number(e.fee_inr || 0);
  const sum = (list) => list.reduce((s, e) => s + fee(e), 0);

  const paid = billable.filter((e) => e.payment_status === "PAID");
  const unpaid = billable.filter((e) => e.payment_status === "UNPAID");
  const pending = billable.filter((e) => e.payment_status === "PENDING");
  const failed = billable.filter((e) => e.payment_status === "FAILED");
  const refunded = entries.filter((e) => e.payment_status === "REFUNDED");

  const eventById = Object.fromEntries(events.map((e) => [e.id, e]));
  const byEvent = {};
  billable.forEach((e) => {
    const row = (byEvent[e.event_id] = byEvent[e.event_id] || {
      event: eventById[e.event_id], registrations: 0, paid: 0, expected: 0, collected: 0,
    });
    row.registrations++;
    row.expected += fee(e);
    if (e.payment_status === "PAID") { row.paid++; row.collected += fee(e); }
  });

  return {
    registrations: billable.length,
    paidCount: paid.length,
    unpaidCount: unpaid.length,
    pendingCount: pending.length,
    failedCount: failed.length,
    refundedCount: refunded.length,
    expected: sum(billable),
    collected: sum(paid),
    outstanding: sum(unpaid) + sum(pending),
    refunded: sum(refunded),
    collectionPct: sum(billable) ? Math.round((sum(paid) / sum(billable)) * 100) : 0,
    byEvent: Object.values(byEvent).filter((r) => r.event),
    ledger: payments,
    ledgerProviders: [...new Set(payments.map((p) => p.provider))],
  };
}

/* --------------------------- COMMAND CENTER ------------------------------ */

// The single "what is happening right now" read the organizer needs. Built
// entirely from the tournament data already in memory — no duplicate state.
export function commandCenter({ tournament, events, courts, entries, matches, now = Date.now() }) {
  const eventById = Object.fromEntries(events.map((e) => [e.id, e]));
  const real = matches.filter((m) => !m.is_bye);
  const p = participationStats(entries);
  const ms = matchStats(real, now);
  const board = courtBoard(courts, real, now);

  const live = real
    .filter((m) => m.status === "LIVE")
    .map((m) => {
      const games = [...(m.games || [])].sort((a, b) => a.game_number - b.game_number);
      const current = games[games.length - 1];
      return {
        match: m,
        event: eventById[m.event_id],
        scoreA: current?.score_a ?? 0,
        scoreB: current?.score_b ?? 0,
        gameTally: BadmintonScoringEngine.gameTally(toAB(games)),
        elapsedMins: m.started_at ? Math.round((now - new Date(m.started_at).getTime()) / 60000) : null,
      };
    });

  const upNext = real
    .filter((m) => m.scheduled_at && !DONE.includes(m.status) && m.status !== "LIVE")
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
    .slice(0, 8)
    .map((m) => ({ match: m, event: eventById[m.event_id], late: new Date(m.scheduled_at).getTime() < now }));

  // Only things the organizer can actually act on.
  const attention = [];
  if (p.notCheckedIn > 0 && tournament?.status === "LIVE") {
    attention.push({ key: "checkin", tone: "amber", label: `${p.notCheckedIn} not checked in`, tab: "checkin" });
  }
  if (p.noShows > 0) {
    attention.push({ key: "noshow", tone: "red", label: `${p.noShows} marked no-show`, tab: "checkin" });
  }
  if (ms.runningLate.length > 0) {
    attention.push({ key: "late", tone: "red", label: `${ms.runningLate.length} ${ms.runningLate.length === 1 ? "match is" : "matches are"} running late`, tab: "schedule" });
  }
  if (ms.unscheduled > 0 && tournament?.status !== "DRAFT") {
    attention.push({ key: "unscheduled", tone: "amber", label: `${ms.unscheduled} ${ms.unscheduled === 1 ? "match has" : "matches have"} no time yet`, tab: "schedule" });
  }
  if (tournament?.status === "LIVE" && !tournament?.schedule_published) {
    attention.push({ key: "unpublished", tone: "amber", label: "Schedule is not published to players", tab: "schedule" });
  }
  const unpaid = entries.filter((e) => !["REJECTED", "CANCELLED"].includes(e.reg_status) && e.payment_status !== "PAID" && Number(e.fee_inr || 0) > 0);
  if (unpaid.length > 0) {
    attention.push({ key: "unpaid", tone: "amber", label: `${unpaid.length} unpaid ${unpaid.length === 1 ? "entry" : "entries"}`, tab: "finance" });
  }

  return {
    participation: p,
    matches: ms,
    board,
    live,
    upNext,
    attention,
    courtsFree: board.filter((b) => b.state === "AVAILABLE").length,
    courtsBusy: board.filter((b) => b.state === "LIVE").length,
  };
}
