import React, { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  Trophy, Calendar, MapPin, Users, Plus, ChevronRight, ChevronLeft, ChevronDown,
  X, Check, Search, Bell, Settings, LayoutGrid, List, Play, RotateCcw, Minus,
  CheckCircle2, AlertCircle, Clock, Radio, Award, ClipboardList, UserPlus,
  ArrowRight, Home, Building2, CreditCard, Filter, Trash2, Pencil, ShieldCheck,
  Loader2, Swords, Flag, ChevronUp
} from "lucide-react";

/* =========================================================================
   COURTSIDE — Badminton Tournament Operations Platform
   Single-file reference build. Sections below mirror the intended production
   architecture (repositories -> services -> UI) even though everything runs
   in one file here:

     STORAGE      -> stands in for a future Supabase repository
     ENGINES      -> drawService / schedulingService / scoringService
     REDUCER      -> application services (tournamentService, registrationService...)
     COMPONENTS   -> presentational + feature components
     APP          -> composition root
   ========================================================================= */

/* ----------------------------- utils ---------------------------------- */

const cx = (...a) => a.filter(Boolean).join(" ");
const uid = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const nowISO = () => new Date().toISOString();
const nextPow2 = (n) => { let p = 1; while (p < n) p *= 2; return p; };
const inr = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

function fmtDate(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  } catch { return d; }
}
function fmtDateRange(a, b) {
  if (!a) return "—";
  const start = new Date(a), end = b ? new Date(b) : null;
  const sameMonth = end && start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  if (!end || +start === +end) return fmtDate(a);
  if (sameMonth) return `${start.toLocaleDateString("en-IN", { day: "numeric" })}–${end.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`;
  return `${fmtDate(a)} – ${fmtDate(b)}`;
}
function fmtTime(iso) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }); } catch { return "—"; }
}
function fmtDateTime(iso) {
  if (!iso) return "TBD";
  try { return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }); } catch { return "TBD"; }
}
function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/* ------------------------- domain constants ----------------------------- */

const CATEGORY_META = {
  MS: { label: "Men's Singles", kind: "SINGLES" },
  WS: { label: "Women's Singles", kind: "SINGLES" },
  MD: { label: "Men's Doubles", kind: "DOUBLES" },
  WD: { label: "Women's Doubles", kind: "DOUBLES" },
  XD: { label: "Mixed Doubles", kind: "DOUBLES" },
};

const TOURNAMENT_STATUS_META = {
  DRAFT: { label: "Draft", tone: "slate" },
  REGISTRATION_OPEN: { label: "Registration Open", tone: "emerald" },
  REGISTRATION_CLOSED: { label: "Registration Closed", tone: "amber" },
  LIVE: { label: "Live", tone: "red" },
  COMPLETED: { label: "Completed", tone: "indigo" },
  CANCELLED: { label: "Cancelled", tone: "slate" },
};

const EVENT_STATUS_META = {
  DRAFT: { label: "Draft", tone: "slate" },
  REGISTRATION_OPEN: { label: "Registration Open", tone: "emerald" },
  REGISTRATION_CLOSED: { label: "Registration Closed", tone: "amber" },
  DRAW_READY: { label: "Draw Ready", tone: "teal" },
  SCHEDULED: { label: "Scheduled", tone: "teal" },
  LIVE: { label: "Live", tone: "red" },
  COMPLETED: { label: "Completed", tone: "indigo" },
};

const REG_STATUS_META = {
  PENDING: { label: "Pending", tone: "amber" },
  CONFIRMED: { label: "Confirmed", tone: "emerald" },
  REJECTED: { label: "Rejected", tone: "red" },
  CANCELLED: { label: "Cancelled", tone: "slate" },
};

const PAY_STATUS_META = {
  UNPAID: { label: "Unpaid", tone: "slate" },
  PENDING: { label: "Pending", tone: "amber" },
  PAID: { label: "Paid", tone: "emerald" },
  FAILED: { label: "Failed", tone: "red" },
  REFUNDED: { label: "Refunded", tone: "indigo" },
};

const MATCH_STATUS_META = {
  PENDING: { label: "TBD", tone: "slate" },
  SCHEDULED: { label: "Scheduled", tone: "slate" },
  READY: { label: "Ready", tone: "teal" },
  LIVE: { label: "Live", tone: "red" },
  COMPLETED: { label: "Completed", tone: "indigo" },
  WALKOVER: { label: "Walkover", tone: "amber" },
};

const TONE_CLASSES = {
  slate: "bg-slate-100 text-slate-600 border-slate-200",
  emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
  amber: "bg-amber-50 text-amber-700 border-amber-200",
  red: "bg-red-50 text-red-700 border-red-200",
  indigo: "bg-indigo-50 text-indigo-700 border-indigo-200",
  teal: "bg-teal-50 text-teal-700 border-teal-200",
};

/* ============================ ENGINES =================================== */
/* ---- ScoringEngine (badminton rules; modular so other sports can plug in) */

const BadmintonScoringEngine = {
  POINTS_TO_WIN: 21,
  CAP: 30,
  isGameOver(a, b) {
    if (a >= this.CAP || b >= this.CAP) return true;
    if (Math.max(a, b) >= this.POINTS_TO_WIN && Math.abs(a - b) >= 2) return true;
    return false;
  },
  gameWinnerSide(a, b) {
    if (!this.isGameOver(a, b)) return null;
    return a > b ? "A" : "B";
  },
  canScore(a, b, side) {
    if (this.isGameOver(a, b)) return false;
    const v = side === "A" ? a : b;
    return v < this.CAP;
  },
  matchWinnerSide(games) {
    let winsA = 0, winsB = 0;
    for (const g of games) {
      const w = this.gameWinnerSide(g.a, g.b);
      if (w === "A") winsA++; else if (w === "B") winsB++;
    }
    if (winsA === 2) return "A";
    if (winsB === 2) return "B";
    return null;
  },
  gameTally(games) {
    let a = 0, b = 0;
    for (const g of games) { const w = this.gameWinnerSide(g.a, g.b); if (w === "A") a++; else if (w === "B") b++; }
    return { a, b };
  },
};

/* ---- DrawService: single-elimination bracket generator with byes ------- */

function roundLabel(round, totalRounds) {
  const remaining = totalRounds - round;
  if (remaining === 0) return "Final";
  if (remaining === 1) return "Semifinal";
  if (remaining === 2) return "Quarterfinal";
  return `Round of ${Math.pow(2, totalRounds - round + 1)}`;
}

function generateDrawForEvent(event, allEntries) {
  const confirmed = allEntries.filter((e) => e.eventId === event.id && e.regStatus === "CONFIRMED");
  if (confirmed.length < 2) throw new Error("At least 2 confirmed entries are required to generate a draw.");

  const seeded = [...confirmed]
    .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""))
    .map((e, i) => ({ id: e.id, seed: i + 1 }));

  const n = seeded.length;
  const size = nextPow2(n);
  const totalRounds = Math.log2(size);
  const byeCount = size - n;
  const byeSeeds = seeded.slice(0, byeCount);
  const playSeeds = seeded.slice(byeCount);
  const playMatchesCount = playSeeds.length / 2;

  let matchNumber = 1;
  const round1 = [];

  byeSeeds.forEach((s) => {
    round1.push({
      id: uid("match"), eventId: event.id, round: 1, matchNumber: matchNumber++,
      entryA: s.id, entryB: null, isBye: true, status: "WALKOVER",
      court: null, scheduledAt: null, games: [], winnerEntryId: s.id,
      nextMatchId: null, nextSlot: null, completedAt: nowISO(),
    });
  });
  for (let i = 0; i < playMatchesCount; i++) {
    const a = playSeeds[i];
    const b = playSeeds[playSeeds.length - 1 - i];
    round1.push({
      id: uid("match"), eventId: event.id, round: 1, matchNumber: matchNumber++,
      entryA: a.id, entryB: b.id, isBye: false, status: "PENDING",
      court: null, scheduledAt: null, games: [], winnerEntryId: null,
      nextMatchId: null, nextSlot: null,
    });
  }

  let matches = [...round1];
  let prevRound = round1;
  for (let r = 2; r <= totalRounds; r++) {
    const roundMatches = [];
    for (let i = 0; i < prevRound.length / 2; i++) {
      roundMatches.push({
        id: uid("match"), eventId: event.id, round: r, matchNumber: matchNumber++,
        entryA: null, entryB: null, isBye: false, status: "PENDING",
        court: null, scheduledAt: null, games: [], winnerEntryId: null,
        nextMatchId: null, nextSlot: null,
      });
    }
    prevRound.forEach((m, idx) => {
      const target = roundMatches[Math.floor(idx / 2)];
      m.nextMatchId = target.id;
      m.nextSlot = idx % 2 === 0 ? "A" : "B";
    });
    matches = matches.concat(roundMatches);
    prevRound = roundMatches;
  }

  // propagate bye winners into round 2 immediately
  matches.filter((m) => m.isBye).forEach((bm) => {
    if (!bm.nextMatchId) return;
    matches = matches.map((m) => {
      if (m.id !== bm.nextMatchId) return m;
      const upd = { ...m };
      if (bm.nextSlot === "A") upd.entryA = bm.winnerEntryId; else upd.entryB = bm.winnerEntryId;
      return upd;
    });
  });

  const seedMap = {};
  seeded.forEach((s) => (seedMap[s.id] = s.seed));
  return { matches, seedMap, totalRounds };
}

/* ---- SchedulingService: round-by-round, court round-robin ------------- */

function generateScheduleForEvent(event, eventMatches, tournament) {
  const availableCourts = (tournament.courts || []).filter((c) => c.status === "AVAILABLE");
  const numCourts = Math.max(1, availableCourts.length);
  const duration = tournament.settings?.matchDurationMins || 40;
  const startBase = new Date(`${tournament.startDate}T${tournament.settings?.startTime || "09:00"}:00`);

  const byRound = {};
  eventMatches.forEach((m) => { (byRound[m.round] = byRound[m.round] || []).push(m); });
  const rounds = Object.keys(byRound).map(Number).sort((a, b) => a - b);

  let baseMinutes = 0;
  const updates = {};
  rounds.forEach((r) => {
    const roundMatches = byRound[r].sort((a, b) => a.matchNumber - b.matchNumber);
    const playable = roundMatches.filter((m) => !m.isBye);
    playable.forEach((m, idx) => {
      const courtIdx = idx % numCourts;
      const court = availableCourts[courtIdx];
      const slot = Math.floor(idx / numCourts);
      const start = new Date(startBase.getTime() + (baseMinutes + slot * duration) * 60000);
      updates[m.id] = {
        court: court ? court.name : `Court ${courtIdx + 1}`,
        scheduledAt: start.toISOString(),
        status: m.entryA && m.entryB ? "READY" : "SCHEDULED",
      };
    });
    const slotsUsed = numCourts ? Math.ceil(playable.length / numCourts) : 0;
    baseMinutes += slotsUsed * duration + 10;
  });
  return updates;
}

/* ============================ SEED DATA ================================ */

function makeEntry(eventId, players, regStatus, paymentStatus, createdAt) {
  return { id: uid("entry"), eventId, type: players.length > 1 ? "DOUBLES" : "SINGLES", players, regStatus, paymentStatus, createdAt };
}

function createSeedState() {
  const orgId = uid("org");
  const tId = uid("tourn");
  const now = Date.now();
  const startDate = new Date(now + 3 * 86400000).toISOString().slice(0, 10);
  const endDate = new Date(now + 4 * 86400000).toISOString().slice(0, 10);

  const msId = uid("evt");
  const wdId = uid("evt");

  const courts = [
    { id: uid("court"), name: "Court 1", status: "AVAILABLE" },
    { id: uid("court"), name: "Court 2", status: "AVAILABLE" },
    { id: uid("court"), name: "Court 3", status: "AVAILABLE" },
  ];

  const tournament = {
    id: tId, organizationId: orgId, name: "Chennai Open 2026",
    description: "The city's marquee amateur badminton championship, returning for its third edition.",
    organizerName: "Chennai Badminton Association",
    venue: "SDAT Indoor Stadium", location: "Chennai, Tamil Nadu",
    startDate, endDate, registrationDeadline: startDate,
    contactEmail: "organizer@chennaiopen.example", contactPhone: "+91 90000 00000",
    slug: "chennai-open-2026", status: "REGISTRATION_CLOSED",
    settings: { matchDurationMins: 40, startTime: "09:00", rules: "BWF rally-point scoring, best of 3 games to 21." },
    courts, createdAt: nowISO(),
  };

  const players8 = [
    "Arjun Mehta", "Karthik Iyer", "Rohan Das", "Vikram Shah",
    "Sanjay Rao", "Aditya Menon", "Nikhil Verma", "Pranav Nair",
  ];
  const msEntries = players8.map((name, i) =>
    makeEntry(msId, [{ name, phone: `98765 4321${i}`, email: `${name.split(" ")[0].toLowerCase()}@example.com` }],
      "CONFIRMED", "PAID", new Date(now - (20 - i) * 3600000).toISOString())
  );

  const wdPairs = [
    ["Priya Krishnan", "Divya Suresh"],
    ["Meera Pillai", "Ananya Raman"],
    ["Kavya Nambiar", "Shreya Kumar"],
  ];
  const wdEntries = wdPairs.map(([a, b], i) =>
    makeEntry(wdId, [{ name: a, phone: "90000 11111", email: "" }, { name: b, phone: "90000 22222", email: "" }],
      i === 2 ? "PENDING" : "CONFIRMED", i === 2 ? "UNPAID" : "PAID", new Date(now - (10 - i) * 3600000).toISOString())
  );

  const events = [
    { id: msId, tournamentId: tId, category: "MS", format: "SINGLE_ELIM", maxEntries: 16, feeINR: 300, status: "REGISTRATION_CLOSED", totalRounds: null },
    { id: wdId, tournamentId: tId, category: "WD", format: "SINGLE_ELIM", maxEntries: 8, feeINR: 500, status: "REGISTRATION_OPEN", totalRounds: null },
  ];

  let entries = [...msEntries, ...wdEntries];

  // generate a draw for Men's Singles so the demo "looks alive"
  const { matches: msMatches, totalRounds } = generateDrawForEvent(events[0], entries);
  events[0].totalRounds = totalRounds;
  events[0].status = "SCHEDULED";

  const schedUpdates = generateScheduleForEvent(events[0], msMatches, tournament);
  let matches = msMatches.map((m) => (schedUpdates[m.id] ? { ...m, ...schedUpdates[m.id] } : m));

  // Simulate that the tournament has started: play out round 1 except one live match
  const findEntryName = (id) => {
    const e = entries.find((x) => x.id === id);
    return e ? e.players.map((p) => p.name).join(" / ") : "TBD";
  };
  const round1 = matches.filter((m) => m.round === 1 && !m.isBye);
  const scoreLines = [[21, 15, 21, 12], [21, 18, 19, 21, 21, 17], [21, 10, 21, 14]];
  round1.slice(0, 3).forEach((m, i) => {
    const line = scoreLines[i];
    const games = [];
    for (let g = 0; g < line.length; g += 2) games.push({ a: line[g], b: line[g + 1] });
    const winSide = BadmintonScoringEngine.matchWinnerSide(games);
    const winnerId = winSide === "A" ? m.entryA : m.entryB;
    matches = matches.map((mm) => (mm.id === m.id ? { ...mm, games, status: "COMPLETED", winnerEntryId: winnerId, completedAt: nowISO() } : mm));
    if (m.nextMatchId) {
      matches = matches.map((mm) => {
        if (mm.id !== m.nextMatchId) return mm;
        const upd = { ...mm };
        if (m.nextSlot === "A") upd.entryA = winnerId; else upd.entryB = winnerId;
        if (upd.entryA && upd.entryB && upd.scheduledAt) upd.status = "READY";
        return upd;
      });
    }
  });
  // make the 4th round-1 match LIVE, mid-game
  if (round1[3]) {
    const m4 = round1[3];
    matches = matches.map((mm) => (mm.id === m4.id ? { ...mm, status: "LIVE", games: [{ a: 21, b: 17 }, { a: 14, b: 11 }] } : mm));
  }

  tournament.status = "LIVE";
  events[0].status = "LIVE";

  const notifications = [
    { id: uid("notif"), type: "info", message: "Chennai Open 2026 is live — Men's Singles Round of 8 underway.", createdAt: nowISO(), read: false },
    { id: uid("notif"), type: "success", message: `${findEntryName(round1[0]?.winnerEntryId)} advances to the quarterfinal.`, createdAt: nowISO(), read: false },
    { id: uid("notif"), type: "info", message: "Women's Doubles registration is open.", createdAt: nowISO(), read: true },
  ];

  return {
    organizations: [{ id: orgId, name: "Chennai Badminton Association" }],
    tournaments: [tournament],
    events,
    entries,
    matches,
    notifications,
  };
}

/* ============================ PERSISTENCE =============================== */
/* LocalRepository backed by window.storage — swap for SupabaseRepository
   later without touching the services below (they only see `data`).       */

const STORAGE_KEY = "courtside-app-state-v1";

/* ============================== REDUCER ================================= */
/* Stands in for tournamentService / registrationService / drawService /
   schedulingService / scoringService / paymentService / notificationService */

function addNotif(state, message, type = "info") {
  const n = { id: uid("notif"), type, message, createdAt: nowISO(), read: false };
  return [n, ...state.notifications].slice(0, 60);
}

function reducer(state, action) {
  switch (action.type) {
    case "HYDRATE":
      return action.payload || state;

    case "CREATE_TOURNAMENT": {
      const { basics, categories, settings } = action.payload;
      const tId = uid("tourn");
      const courts = Array.from({ length: settings.courtsCount || 2 }, (_, i) => ({
        id: uid("court"), name: `Court ${i + 1}`, status: "AVAILABLE",
      }));
      const tournament = {
        id: tId, organizationId: state.organizations[0]?.id, ...basics,
        status: "DRAFT", slug: null,
        settings: { matchDurationMins: settings.matchDurationMins, startTime: settings.startTime, rules: settings.rules },
        courts, createdAt: nowISO(),
      };
      const events = categories.map((c) => ({
        id: uid("evt"), tournamentId: tId, category: c.category, format: "SINGLE_ELIM",
        maxEntries: c.maxEntries, feeINR: c.feeINR, status: "DRAFT", totalRounds: null,
      }));
      return {
        ...state,
        tournaments: [...state.tournaments, tournament],
        events: [...state.events, ...events],
        notifications: addNotif(state, `“${tournament.name}” was created as a draft.`),
        _lastCreatedId: tId,
      };
    }

    case "PUBLISH_TOURNAMENT": {
      const { tournamentId } = action.payload;
      const slug = state.tournaments.find((t) => t.id === tournamentId)?.slug ||
        `${action.payload.slugBase}-${Math.random().toString(36).slice(2, 6)}`;
      return {
        ...state,
        tournaments: state.tournaments.map((t) => t.id === tournamentId ? { ...t, status: "REGISTRATION_OPEN", slug } : t),
        events: state.events.map((e) => e.tournamentId === tournamentId ? { ...e, status: "REGISTRATION_OPEN" } : e),
        notifications: addNotif(state, "Tournament published. Registration is now open to players.", "success"),
      };
    }

    case "CLOSE_REGISTRATION": {
      const { tournamentId } = action.payload;
      return {
        ...state,
        tournaments: state.tournaments.map((t) => t.id === tournamentId ? { ...t, status: "REGISTRATION_CLOSED" } : t),
        events: state.events.map((e) => e.tournamentId === tournamentId && e.status === "REGISTRATION_OPEN" ? { ...e, status: "REGISTRATION_CLOSED" } : e),
        notifications: addNotif(state, "Registration closed. Draws can now be generated."),
      };
    }

    case "START_TOURNAMENT": {
      const { tournamentId } = action.payload;
      const eventIds = state.events.filter((e) => e.tournamentId === tournamentId && e.status === "SCHEDULED").map((e) => e.id);
      return {
        ...state,
        tournaments: state.tournaments.map((t) => t.id === tournamentId ? { ...t, status: "LIVE" } : t),
        events: state.events.map((e) => eventIds.includes(e.id) ? { ...e, status: "LIVE" } : e),
        matches: state.matches.map((m) =>
          eventIds.includes(m.eventId) && !m.isBye && m.entryA && m.entryB && (m.status === "SCHEDULED" || m.status === "PENDING")
            ? { ...m, status: "READY" } : m
        ),
        notifications: addNotif(state, "Tournament started. Courts are live.", "success"),
      };
    }

    case "COMPLETE_TOURNAMENT":
      return {
        ...state,
        tournaments: state.tournaments.map((t) => t.id === action.payload.tournamentId ? { ...t, status: "COMPLETED" } : t),
        notifications: addNotif(state, "Tournament marked as completed.", "success"),
      };

    case "CANCEL_TOURNAMENT":
      return {
        ...state,
        tournaments: state.tournaments.map((t) => t.id === action.payload.tournamentId ? { ...t, status: "CANCELLED" } : t),
        notifications: addNotif(state, "Tournament cancelled.", "error"),
      };

    case "UPDATE_TOURNAMENT": {
      const { tournamentId, patch } = action.payload;
      return { ...state, tournaments: state.tournaments.map((t) => t.id === tournamentId ? { ...t, ...patch } : t) };
    }

    case "ADD_COURT": {
      const { tournamentId, name } = action.payload;
      return {
        ...state,
        tournaments: state.tournaments.map((t) => t.id === tournamentId
          ? { ...t, courts: [...t.courts, { id: uid("court"), name, status: "AVAILABLE" }] } : t),
      };
    }
    case "UPDATE_COURT": {
      const { tournamentId, courtId, patch } = action.payload;
      return {
        ...state,
        tournaments: state.tournaments.map((t) => t.id === tournamentId
          ? { ...t, courts: t.courts.map((c) => c.id === courtId ? { ...c, ...patch } : c) } : t),
      };
    }
    case "REMOVE_COURT": {
      const { tournamentId, courtId } = action.payload;
      return {
        ...state,
        tournaments: state.tournaments.map((t) => t.id === tournamentId
          ? { ...t, courts: t.courts.filter((c) => c.id !== courtId) } : t),
      };
    }

    case "REGISTER_ENTRY": {
      const { eventId, players } = action.payload;
      const event = state.events.find((e) => e.id === eventId);
      if (!event) return state;
      const activeCount = state.entries.filter((e) => e.eventId === eventId && e.regStatus !== "REJECTED" && e.regStatus !== "CANCELLED").length;
      if (activeCount >= event.maxEntries) throw new Error("This category is full.");
      const entry = makeEntry(eventId, players, "PENDING", "UNPAID", nowISO());
      return {
        ...state,
        entries: [...state.entries, entry],
        notifications: addNotif(state, `New registration received for ${CATEGORY_META[event.category].label}.`),
        _lastEntryId: entry.id,
      };
    }

    case "SIMULATE_PAYMENT_SUCCESS": {
      const { entryId } = action.payload;
      return {
        ...state,
        entries: state.entries.map((e) => e.id === entryId ? { ...e, paymentStatus: "PAID", regStatus: e.regStatus === "PENDING" ? "CONFIRMED" : e.regStatus } : e),
        notifications: addNotif(state, "Payment received (simulated). Registration confirmed.", "success"),
      };
    }
    case "SIMULATE_PAYMENT_FAILURE": {
      const { entryId } = action.payload;
      return {
        ...state,
        entries: state.entries.map((e) => e.id === entryId ? { ...e, paymentStatus: "FAILED" } : e),
        notifications: addNotif(state, "Payment failed (simulated).", "error"),
      };
    }
    case "MARK_REFUNDED": {
      const { entryId } = action.payload;
      return { ...state, entries: state.entries.map((e) => e.id === entryId ? { ...e, paymentStatus: "REFUNDED" } : e) };
    }

    case "UPDATE_ENTRY_STATUS": {
      const { entryId, regStatus } = action.payload;
      return {
        ...state,
        entries: state.entries.map((e) => e.id === entryId ? { ...e, regStatus } : e),
        notifications: addNotif(state, `Registration ${regStatus.toLowerCase()}.`),
      };
    }

    case "REMOVE_ENTRY": {
      const { entryId } = action.payload;
      const entry = state.entries.find((e) => e.id === entryId);
      const event = entry && state.events.find((e) => e.id === entry.eventId);
      if (event && !["REGISTRATION_OPEN", "REGISTRATION_CLOSED"].includes(event.status)) {
        throw new Error("Can't remove a participant after the draw has been generated.");
      }
      return { ...state, entries: state.entries.filter((e) => e.id !== entryId) };
    }

    case "GENERATE_DRAW": {
      const { eventId } = action.payload;
      const event = state.events.find((e) => e.id === eventId);
      const tournament = state.tournaments.find((t) => t.id === event.tournamentId);
      if (tournament.status !== "REGISTRATION_CLOSED" && tournament.status !== "LIVE") {
        throw new Error("Close registration before generating the draw.");
      }
      const { matches, totalRounds } = generateDrawForEvent(event, state.entries);
      return {
        ...state,
        events: state.events.map((e) => e.id === eventId ? { ...e, status: "DRAW_READY", totalRounds } : e),
        matches: [...state.matches, ...matches],
        notifications: addNotif(state, `Draw generated for ${CATEGORY_META[event.category].label} (${matches.filter(m=>m.round===1).length} first-round matches).`, "success"),
      };
    }

    case "GENERATE_SCHEDULE": {
      const { eventId } = action.payload;
      const event = state.events.find((e) => e.id === eventId);
      const tournament = state.tournaments.find((t) => t.id === event.tournamentId);
      if (event.status !== "DRAW_READY") throw new Error("Generate the draw before scheduling.");
      const eventMatches = state.matches.filter((m) => m.eventId === eventId);
      const updates = generateScheduleForEvent(event, eventMatches, tournament);
      return {
        ...state,
        events: state.events.map((e) => e.id === eventId ? { ...e, status: "SCHEDULED" } : e),
        matches: state.matches.map((m) => updates[m.id] ? { ...m, ...updates[m.id] } : m),
        notifications: addNotif(state, `Schedule generated for ${CATEGORY_META[event.category].label}.`, "success"),
      };
    }

    case "START_MATCH": {
      const { matchId } = action.payload;
      return {
        ...state,
        matches: state.matches.map((m) => m.id === matchId ? { ...m, status: "LIVE", games: [{ a: 0, b: 0 }], startedAt: nowISO() } : m),
        notifications: addNotif(state, "Match is now live.", "info"),
      };
    }

    case "SCORE_POINT": {
      const { matchId, side, delta } = action.payload;
      const match = state.matches.find((m) => m.id === matchId);
      if (!match || match.status !== "LIVE") return state;
      const games = match.games.length ? [...match.games] : [{ a: 0, b: 0 }];
      const last = { ...games[games.length - 1] };
      if (delta > 0) {
        if (!BadmintonScoringEngine.canScore(last.a, last.b, side)) return state;
        last[side.toLowerCase()] = last[side === "A" ? "a" : "b"] + 1;
      } else {
        const key = side === "A" ? "a" : "b";
        last[key] = Math.max(0, last[key] - 1);
      }
      games[games.length - 1] = last;

      const gameOver = BadmintonScoringEngine.isGameOver(last.a, last.b);
      let status = "LIVE", winnerEntryId = null, completedAt = null, matches = state.matches, events = state.events, notifications = state.notifications;

      if (gameOver) {
        const winSide = BadmintonScoringEngine.matchWinnerSide(games);
        if (winSide) {
          status = "COMPLETED";
          winnerEntryId = winSide === "A" ? match.entryA : match.entryB;
          completedAt = nowISO();
        } else {
          games.push({ a: 0, b: 0 }); // next game auto-starts
          notifications = addNotif(state, "Game complete. Next game underway.");
        }
      }

      const updatedMatch = { ...match, games, status, winnerEntryId: winnerEntryId || match.winnerEntryId, completedAt };
      matches = state.matches.map((m) => (m.id === matchId ? updatedMatch : m));

      if (status === "COMPLETED") {
        const winnerEntry = state.entries.find((e) => e.id === winnerEntryId);
        const winnerName = winnerEntry ? winnerEntry.players.map((p) => p.name).join(" / ") : "Winner";
        notifications = addNotif(state, `${winnerName} wins the match.`, "success");
        if (match.nextMatchId) {
          matches = matches.map((m) => {
            if (m.id !== match.nextMatchId) return m;
            const upd = { ...m };
            if (match.nextSlot === "A") upd.entryA = winnerEntryId; else upd.entryB = winnerEntryId;
            if (upd.entryA && upd.entryB && upd.scheduledAt) upd.status = "READY";
            return upd;
          });
        } else {
          // final of the event
          const event = state.events.find((e) => e.id === match.eventId);
          events = state.events.map((e) => e.id === match.eventId ? { ...e, status: "COMPLETED", championEntryId: winnerEntryId } : e);
          notifications = addNotif(state, `🏆 ${winnerName} is the ${CATEGORY_META[event.category].label} champion of the tournament!`, "success");
        }
      }
      return { ...state, matches, events, notifications };
    }

    case "UNDO_LAST_GAME": {
      const { matchId } = action.payload;
      return {
        ...state,
        matches: state.matches.map((m) => {
          if (m.id !== matchId || m.status !== "LIVE" || m.games.length < 2) return m;
          const last = m.games[m.games.length - 1];
          if (last.a !== 0 || last.b !== 0) return m;
          return { ...m, games: m.games.slice(0, -1) };
        }),
      };
    }

    case "RETIRE_MATCH": {
      const { matchId, retiredSide } = action.payload;
      const match = state.matches.find((m) => m.id === matchId);
      if (!match || match.status !== "LIVE") return state;
      const winnerEntryId = retiredSide === "A" ? match.entryB : match.entryA;
      let matches = state.matches.map((m) => m.id === matchId ? { ...m, status: "COMPLETED", winnerEntryId, retired: true, completedAt: nowISO() } : m);
      let events = state.events, notifications = state.notifications;
      const winnerEntry = state.entries.find((e) => e.id === winnerEntryId);
      const winnerName = winnerEntry ? winnerEntry.players.map((p) => p.name).join(" / ") : "Winner";
      notifications = addNotif(state, `${winnerName} advances by retirement/withdrawal.`, "info");
      if (match.nextMatchId) {
        matches = matches.map((m) => {
          if (m.id !== match.nextMatchId) return m;
          const upd = { ...m };
          if (match.nextSlot === "A") upd.entryA = winnerEntryId; else upd.entryB = winnerEntryId;
          if (upd.entryA && upd.entryB && upd.scheduledAt) upd.status = "READY";
          return upd;
        });
      } else {
        const event = state.events.find((e) => e.id === match.eventId);
        events = state.events.map((e) => e.id === match.eventId ? { ...e, status: "COMPLETED", championEntryId: winnerEntryId } : e);
        notifications = addNotif(state, `🏆 ${winnerName} is the ${CATEGORY_META[event.category].label} champion of the tournament!`, "success");
      }
      return { ...state, matches, events, notifications };
    }

    case "MARK_NOTIFS_READ":
      return { ...state, notifications: state.notifications.map((n) => ({ ...n, read: true })) };

    default:
      return state;
  }
}

/* ============================ UI PRIMITIVES ============================= */

function Badge({ tone = "slate", children, className }) {
  return (
    <span className={cx("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide", TONE_CLASSES[tone], className)}>
      {children}
    </span>
  );
}

function Btn({ children, variant = "primary", size = "md", className, icon: Icon, ...props }) {
  const base = "inline-flex items-center justify-center gap-1.5 font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed rounded-md";
  const sizes = { sm: "px-2.5 py-1.5 text-xs", md: "px-3.5 py-2 text-sm", lg: "px-5 py-2.5 text-sm" };
  const variants = {
    primary: "bg-teal-700 text-white hover:bg-teal-800",
    secondary: "bg-white text-stone-800 border border-stone-300 hover:bg-stone-50",
    ghost: "text-stone-600 hover:bg-stone-100",
    danger: "bg-red-600 text-white hover:bg-red-700",
    subtle: "bg-stone-100 text-stone-700 hover:bg-stone-200",
  };
  return (
    <button className={cx(base, sizes[size], variants[variant], className)} {...props}>
      {Icon && <Icon size={size === "sm" ? 14 : 16} />}
      {children}
    </button>
  );
}

function Card({ children, className, ...props }) {
  return <div className={cx("rounded-lg border border-stone-200 bg-white", className)} {...props}>{children}</div>;
}

function Eyebrow({ children }) {
  return <div className="text-[11px] font-semibold uppercase tracking-widest text-teal-700">{children}</div>;
}

function EmptyState({ icon: Icon, title, hint, action }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-stone-300 px-6 py-14 text-center">
      {Icon && <Icon size={28} className="text-stone-300 mb-1" />}
      <div className="text-sm font-semibold text-stone-700">{title}</div>
      {hint && <div className="max-w-sm text-sm text-stone-500">{hint}</div>}
      {action}
    </div>
  );
}

function Modal({ open, onClose, title, children, width = "max-w-lg" }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 p-4" onClick={onClose}>
      <div className={cx("max-h-[90vh] w-full overflow-y-auto rounded-lg bg-white shadow-xl", width)} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-stone-200 px-5 py-4">
          <h3 className="font-semibold text-stone-900">{title}</h3>
          <button onClick={onClose} className="rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700"><X size={18} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children, hint, required }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-stone-600">{label}{required && <span className="text-red-500"> *</span>}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-stone-400">{hint}</span>}
    </label>
  );
}

const inputCls = "w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder-stone-400 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600";

function ScoreDigits({ a, b, winner }) {
  return (
    <div className="flex items-center gap-1 font-mono text-sm tabular-nums">
      <span className={cx("rounded px-1.5 py-0.5", winner === "A" ? "bg-teal-700 text-white font-bold" : "text-stone-700")}>{a}</span>
      <span className="text-stone-300">–</span>
      <span className={cx("rounded px-1.5 py-0.5", winner === "B" ? "bg-teal-700 text-white font-bold" : "text-stone-700")}>{b}</span>
    </div>
  );
}

function Toasts({ toasts }) {
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} className={cx(
          "pointer-events-auto flex items-center gap-2 rounded-md border px-3.5 py-2.5 text-sm shadow-lg animate-[fadein_.15s_ease-out]",
          t.kind === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"
        )}>
          {t.kind === "error" ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
          {t.message}
        </div>
      ))}
    </div>
  );
}

/* ============================ SHARED HELPERS ============================ */

function entryName(entry) {
  if (!entry) return "TBD";
  return entry.players.map((p) => p.name).join(" / ");
}
function entryShort(entry) {
  if (!entry) return "TBD";
  if (entry.players.length === 1) return entry.players[0].name;
  return entry.players.map((p) => p.name.split(" ")[0]).join(" / ");
}

function useEntities(data) {
  return useMemo(() => {
    const entriesById = {}; data.entries.forEach((e) => (entriesById[e.id] = e));
    const eventsById = {}; data.events.forEach((e) => (eventsById[e.id] = e));
    const tournamentsById = {}; data.tournaments.forEach((t) => (tournamentsById[t.id] = t));
    return { entriesById, eventsById, tournamentsById };
  }, [data]);
}

/* ============================ FEATURE: WIZARD =========================== */

function CreateTournamentWizard({ open, onClose, onSubmit }) {
  const [step, setStep] = useState(1);
  const [basics, setBasics] = useState({
    name: "", description: "", organizerName: "", venue: "", location: "",
    startDate: "", endDate: "", registrationDeadline: "", contactEmail: "", contactPhone: "",
  });
  const [selectedCats, setSelectedCats] = useState({ MS: true });
  const [catConfig, setCatConfig] = useState({ MS: { maxEntries: 16, feeINR: 300 } });
  const [settings, setSettings] = useState({ courtsCount: 2, matchDurationMins: 40, startTime: "09:00", rules: "BWF rally-point scoring, best of 3 games to 21." });
  const [error, setError] = useState("");

  if (!open) return null;

  const toggleCat = (c) => {
    setSelectedCats((s) => ({ ...s, [c]: !s[c] }));
    setCatConfig((s) => ({ ...s, [c]: s[c] || { maxEntries: CATEGORY_META[c].kind === "SINGLES" ? 16 : 8, feeINR: CATEGORY_META[c].kind === "SINGLES" ? 300 : 500 } }));
  };

  const categories = Object.keys(selectedCats).filter((c) => selectedCats[c]).map((c) => ({ category: c, ...catConfig[c] }));

  const canNext = () => {
    if (step === 1) return basics.name && basics.venue && basics.startDate && basics.endDate;
    if (step === 2) return categories.length > 0;
    return true;
  };

  const handlePublishNow = (publish) => {
    setError("");
    try {
      onSubmit({ basics, categories, settings, publish });
      setStep(1);
      setBasics({ name: "", description: "", organizerName: "", venue: "", location: "", startDate: "", endDate: "", registrationDeadline: "", contactEmail: "", contactPhone: "" });
      setSelectedCats({ MS: true });
      setCatConfig({ MS: { maxEntries: 16, feeINR: 300 } });
      onClose();
    } catch (e) { setError(e.message); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Create tournament" width="max-w-2xl">
      <div className="mb-5 flex items-center gap-1.5">
        {["Basics", "Categories", "Settings", "Review"].map((label, i) => (
          <React.Fragment key={label}>
            <div className={cx("flex items-center gap-1.5 text-xs font-medium", step === i + 1 ? "text-teal-700" : step > i + 1 ? "text-stone-500" : "text-stone-300")}>
              <span className={cx("flex h-5 w-5 items-center justify-center rounded-full border text-[10px]", step === i + 1 ? "border-teal-700 bg-teal-700 text-white" : step > i + 1 ? "border-stone-300 bg-stone-100" : "border-stone-200")}>
                {step > i + 1 ? <Check size={11} /> : i + 1}
              </span>
              {label}
            </div>
            {i < 3 && <div className="h-px flex-1 bg-stone-200" />}
          </React.Fragment>
        ))}
      </div>

      {step === 1 && (
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><Field label="Tournament name" required><input className={inputCls} value={basics.name} onChange={(e) => setBasics({ ...basics, name: e.target.value })} placeholder="e.g. Coimbatore Winter Open 2026" /></Field></div>
          <div className="col-span-2"><Field label="Description"><textarea className={cx(inputCls, "resize-none")} rows={2} value={basics.description} onChange={(e) => setBasics({ ...basics, description: e.target.value })} /></Field></div>
          <Field label="Organizer"><input className={inputCls} value={basics.organizerName} onChange={(e) => setBasics({ ...basics, organizerName: e.target.value })} /></Field>
          <Field label="Venue" required><input className={inputCls} value={basics.venue} onChange={(e) => setBasics({ ...basics, venue: e.target.value })} /></Field>
          <Field label="Location"><input className={inputCls} value={basics.location} onChange={(e) => setBasics({ ...basics, location: e.target.value })} placeholder="City, State" /></Field>
          <Field label="Registration deadline"><input type="date" className={inputCls} value={basics.registrationDeadline} onChange={(e) => setBasics({ ...basics, registrationDeadline: e.target.value })} /></Field>
          <Field label="Start date" required><input type="date" className={inputCls} value={basics.startDate} onChange={(e) => setBasics({ ...basics, startDate: e.target.value })} /></Field>
          <Field label="End date" required><input type="date" className={inputCls} value={basics.endDate} onChange={(e) => setBasics({ ...basics, endDate: e.target.value })} /></Field>
          <Field label="Contact email"><input className={inputCls} value={basics.contactEmail} onChange={(e) => setBasics({ ...basics, contactEmail: e.target.value })} /></Field>
          <Field label="Contact phone"><input className={inputCls} value={basics.contactPhone} onChange={(e) => setBasics({ ...basics, contactPhone: e.target.value })} /></Field>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-2">
          <p className="mb-3 text-xs text-stone-500">Choose the categories this tournament will run. Each gets its own draw, schedule and results.</p>
          {Object.entries(CATEGORY_META).map(([code, meta]) => (
            <div key={code} className={cx("rounded-md border px-3 py-2.5", selectedCats[code] ? "border-teal-300 bg-teal-50/50" : "border-stone-200")}>
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-sm font-medium text-stone-800">
                  <input type="checkbox" checked={!!selectedCats[code]} onChange={() => toggleCat(code)} className="h-4 w-4 accent-teal-700" />
                  {meta.label} <span className="text-[11px] font-normal text-stone-400">({meta.kind === "SINGLES" ? "1 vs 1" : "2 vs 2"})</span>
                </label>
              </div>
              {selectedCats[code] && (
                <div className="mt-2 grid grid-cols-2 gap-2 pl-6">
                  <Field label={meta.kind === "SINGLES" ? "Max players" : "Max teams"}>
                    <input type="number" min={2} className={inputCls} value={catConfig[code]?.maxEntries ?? ""} onChange={(e) => setCatConfig((s) => ({ ...s, [code]: { ...s[code], maxEntries: Number(e.target.value) } }))} />
                  </Field>
                  <Field label="Entry fee (₹)">
                    <input type="number" min={0} className={inputCls} value={catConfig[code]?.feeINR ?? ""} onChange={(e) => setCatConfig((s) => ({ ...s, [code]: { ...s[code], feeINR: Number(e.target.value) } }))} />
                  </Field>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {step === 3 && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Number of courts" hint="Used by the scheduling engine to spread matches across courts.">
            <input type="number" min={1} className={inputCls} value={settings.courtsCount} onChange={(e) => setSettings({ ...settings, courtsCount: Number(e.target.value) })} />
          </Field>
          <Field label="Match duration (minutes)"><input type="number" min={15} className={inputCls} value={settings.matchDurationMins} onChange={(e) => setSettings({ ...settings, matchDurationMins: Number(e.target.value) })} /></Field>
          <Field label="Daily start time"><input type="time" className={inputCls} value={settings.startTime} onChange={(e) => setSettings({ ...settings, startTime: e.target.value })} /></Field>
          <div className="col-span-2"><Field label="Rules / notes"><textarea className={cx(inputCls, "resize-none")} rows={2} value={settings.rules} onChange={(e) => setSettings({ ...settings, rules: e.target.value })} /></Field></div>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-4">
          <Card className="p-4">
            <div className="text-base font-semibold text-stone-900">{basics.name || "Untitled tournament"}</div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-500">
              <span className="flex items-center gap-1"><MapPin size={12} />{basics.venue}{basics.location ? `, ${basics.location}` : ""}</span>
              <span className="flex items-center gap-1"><Calendar size={12} />{fmtDateRange(basics.startDate, basics.endDate)}</span>
            </div>
          </Card>
          <div>
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500">Categories</div>
            <div className="flex flex-wrap gap-1.5">
              {categories.map((c) => (
                <Badge key={c.category} tone="teal">{CATEGORY_META[c.category].label} · {inr(c.feeINR)} · max {c.maxEntries}</Badge>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 text-xs text-stone-500">
            <div><div className="font-semibold text-stone-700">{settings.courtsCount}</div>Courts</div>
            <div><div className="font-semibold text-stone-700">{settings.matchDurationMins}m</div>Per match</div>
            <div><div className="font-semibold text-stone-700">{settings.startTime}</div>Daily start</div>
          </div>
          {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
        </div>
      )}

      <div className="mt-6 flex items-center justify-between border-t border-stone-100 pt-4">
        <Btn variant="ghost" size="sm" icon={ChevronLeft} onClick={() => (step === 1 ? onClose() : setStep(step - 1))}>{step === 1 ? "Cancel" : "Back"}</Btn>
        {step < 4 ? (
          <Btn size="sm" icon={ChevronRight} disabled={!canNext()} onClick={() => setStep(step + 1)}>Continue</Btn>
        ) : (
          <div className="flex gap-2">
            <Btn variant="secondary" size="sm" onClick={() => handlePublishNow(false)}>Save as draft</Btn>
            <Btn size="sm" icon={ArrowRight} onClick={() => handlePublishNow(true)}>Publish now</Btn>
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ============================ FEATURE: REGISTRATION ====================== */

function RegistrationModal({ open, onClose, event, onSubmit }) {
  const kind = event ? CATEGORY_META[event.category].kind : "SINGLES";
  const [p1, setP1] = useState({ name: "", phone: "", email: "" });
  const [p2, setP2] = useState({ name: "", phone: "", email: "" });
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => { if (open) { setP1({ name: "", phone: "", email: "" }); setP2({ name: "", phone: "", email: "" }); setError(""); setDone(false); } }, [open, event]);

  if (!open || !event) return null;

  const submit = () => {
    setError("");
    if (!p1.name || !p1.phone) { setError("Enter the player's name and phone number."); return; }
    if (kind === "DOUBLES" && (!p2.name || !p2.phone)) { setError("Enter your partner's name and phone number."); return; }
    try {
      const players = kind === "DOUBLES" ? [p1, p2] : [p1];
      onSubmit(event.id, players);
      setDone(true);
    } catch (e) { setError(e.message); }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Register — ${CATEGORY_META[event.category].label}`}>
      {done ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <CheckCircle2 className="text-emerald-600" size={32} />
          <div className="font-semibold text-stone-900">Registration received</div>
          <p className="max-w-sm text-sm text-stone-500">You're on the list as <span className="font-medium text-stone-700">Pending</span> until payment is completed. This tournament uses a simulated payment flow — no real charge will be made.</p>
          <Btn size="sm" variant="secondary" className="mt-2" onClick={onClose}>Close</Btn>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-500">Entry fee <span className="font-semibold text-stone-700">{inr(event.feeINR)}</span> · {kind === "DOUBLES" ? "Team of 2" : "Individual"}</div>
          <Field label={kind === "DOUBLES" ? "Player 1 name" : "Full name"} required><input className={inputCls} value={p1.name} onChange={(e) => setP1({ ...p1, name: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Phone" required><input className={inputCls} value={p1.phone} onChange={(e) => setP1({ ...p1, phone: e.target.value })} /></Field>
            <Field label="Email"><input className={inputCls} value={p1.email} onChange={(e) => setP1({ ...p1, email: e.target.value })} /></Field>
          </div>
          {kind === "DOUBLES" && (
            <>
              <div className="pt-1 text-xs font-semibold uppercase tracking-wide text-stone-500">Partner</div>
              <Field label="Player 2 name" required><input className={inputCls} value={p2.name} onChange={(e) => setP2({ ...p2, name: e.target.value })} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Phone" required><input className={inputCls} value={p2.phone} onChange={(e) => setP2({ ...p2, phone: e.target.value })} /></Field>
                <Field label="Email"><input className={inputCls} value={p2.email} onChange={(e) => setP2({ ...p2, email: e.target.value })} /></Field>
              </div>
            </>
          )}
          {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
          <Btn className="w-full" onClick={submit}>Submit registration</Btn>
        </div>
      )}
    </Modal>
  );
}

/* ============================ FEATURE: BRACKET =========================== */

function BracketView({ event, matches, entriesById }) {
  const rounds = event.totalRounds;
  if (!rounds) return <EmptyState icon={Swords} title="No draw yet" hint="Generate the draw to see the bracket here." />;
  const byRound = Array.from({ length: rounds }, (_, i) => matches.filter((m) => m.round === i + 1).sort((a, b) => a.matchNumber - b.matchNumber));

  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex min-w-max gap-8 px-1 py-2">
        {byRound.map((roundMatches, ri) => (
          <div key={ri} className="flex flex-col justify-around gap-6" style={{ minWidth: 210 }}>
            <div className="mb-1 text-center text-[11px] font-semibold uppercase tracking-widest text-stone-400">{roundLabel(ri + 1, rounds)}</div>
            <div className="flex flex-1 flex-col justify-around gap-6">
              {roundMatches.map((m) => <BracketMatch key={m.id} match={m} entriesById={entriesById} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BracketMatch({ match, entriesById }) {
  const a = entriesById[match.entryA], b = entriesById[match.entryB];
  const tally = BadmintonScoringEngine.gameTally(match.games || []);
  const meta = MATCH_STATUS_META[match.status];
  return (
    <div className="rounded-md border border-stone-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-stone-100 px-2 py-1">
        <span className="font-mono text-[10px] text-stone-400">#{match.matchNumber}</span>
        <Badge tone={meta.tone}>{match.status === "LIVE" ? <><Radio size={10} className="animate-pulse" /> Live</> : meta.label}</Badge>
      </div>
      {[["A", a], ["B", b]].map(([side, e]) => (
        <div key={side} className={cx("flex items-center justify-between gap-2 px-2.5 py-1.5 text-sm", match.winnerEntryId && match.winnerEntryId === e?.id ? "bg-teal-50/60 font-semibold text-teal-800" : "text-stone-700")}>
          <span className="truncate">{e ? entryShort(e) : match.isBye ? "—" : "TBD"}</span>
          {match.games?.length > 0 && <span className="font-mono text-xs text-stone-400">{side === "A" ? tally.a : tally.b}</span>}
        </div>
      ))}
    </div>
  );
}

/* ============================ FEATURE: PARTICIPANTS ====================== */

function ParticipantsPanel({ event, entries, onApprove, onReject, onRemove, onSimPay, onSimFail, onRefund, onAddManual }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [addOpen, setAddOpen] = useState(false);

  const filtered = entries.filter((e) => {
    if (filter !== "ALL" && e.regStatus !== filter) return false;
    if (q && !entryName(e).toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  const canEdit = event.status === "REGISTRATION_OPEN" || event.status === "REGISTRATION_CLOSED";

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400" />
          <input className={cx(inputCls, "pl-8")} placeholder="Search participants" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className={cx(inputCls, "w-auto")} value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="ALL">All statuses</option>
          {Object.keys(REG_STATUS_META).map((s) => <option key={s} value={s}>{REG_STATUS_META[s].label}</option>)}
        </select>
        <Btn size="sm" variant="secondary" icon={UserPlus} onClick={() => setAddOpen(true)}>Add participant</Btn>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Users} title="No participants yet" hint="Registrations for this category will appear here." />
      ) : (
        <div className="overflow-x-auto rounded-md border border-stone-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-stone-50 text-[11px] uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Registered</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Payment</th>
                <th className="px-3 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {filtered.map((e) => (
                <tr key={e.id}>
                  <td className="px-3 py-2 font-medium text-stone-800">{entryName(e)}</td>
                  <td className="px-3 py-2 text-stone-500">{fmtDate(e.createdAt)}</td>
                  <td className="px-3 py-2"><Badge tone={REG_STATUS_META[e.regStatus].tone}>{REG_STATUS_META[e.regStatus].label}</Badge></td>
                  <td className="px-3 py-2"><Badge tone={PAY_STATUS_META[e.paymentStatus].tone}>{PAY_STATUS_META[e.paymentStatus].label}</Badge></td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      {e.regStatus === "PENDING" && canEdit && <>
                        <Btn size="sm" variant="ghost" onClick={() => onApprove(e.id)} title="Approve"><Check size={14} /></Btn>
                        <Btn size="sm" variant="ghost" onClick={() => onReject(e.id)} title="Reject"><X size={14} /></Btn>
                      </>}
                      {e.paymentStatus !== "PAID" && e.paymentStatus !== "REFUNDED" && (
                        <Btn size="sm" variant="ghost" icon={CreditCard} onClick={() => onSimPay(e.id)} title="Simulate payment success">Pay</Btn>
                      )}
                      {e.paymentStatus === "PAID" && (
                        <Btn size="sm" variant="ghost" onClick={() => onRefund(e.id)} title="Mark refunded">Refund</Btn>
                      )}
                      {canEdit && <Btn size="sm" variant="ghost" onClick={() => onRemove(e.id)} title="Remove"><Trash2 size={14} className="text-red-500" /></Btn>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <RegistrationModal open={addOpen} onClose={() => setAddOpen(false)} event={event} onSubmit={(eid, players) => { onAddManual(eid, players); setAddOpen(false); }} />
    </div>
  );
}

/* ============================ FEATURE: SCHEDULE =========================== */

function ScheduleTable({ matches, entriesById, event }) {
  const sorted = [...matches].filter((m) => !m.isBye).sort((a, b) => (a.scheduledAt || "").localeCompare(b.scheduledAt || "") || a.round - b.round);
  if (sorted.length === 0 || !sorted[0].scheduledAt) return <EmptyState icon={Clock} title="No schedule yet" hint="Generate the schedule to assign courts and times." />;
  return (
    <div className="overflow-x-auto rounded-md border border-stone-200">
      <table className="w-full text-left text-sm">
        <thead className="bg-stone-50 text-[11px] uppercase tracking-wide text-stone-500">
          <tr>
            <th className="px-3 py-2 font-medium">Time</th>
            <th className="px-3 py-2 font-medium">Court</th>
            <th className="px-3 py-2 font-medium">Round</th>
            <th className="px-3 py-2 font-medium">Match</th>
            <th className="px-3 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {sorted.map((m) => (
            <tr key={m.id}>
              <td className="px-3 py-2 font-mono text-xs text-stone-600">{fmtDateTime(m.scheduledAt)}</td>
              <td className="px-3 py-2"><Badge tone="slate">{m.court || "—"}</Badge></td>
              <td className="px-3 py-2 text-stone-500">{roundLabel(m.round, event.totalRounds)}</td>
              <td className="px-3 py-2 text-stone-800">{entryShort(entriesById[m.entryA])} <span className="text-stone-300">vs</span> {entryShort(entriesById[m.entryB])}</td>
              <td className="px-3 py-2"><Badge tone={MATCH_STATUS_META[m.status].tone}>{MATCH_STATUS_META[m.status].label}</Badge></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ============================ FEATURE: COURTS ============================ */

function CourtsPanel({ tournament, onAdd, onUpdate, onRemove }) {
  const [name, setName] = useState("");
  return (
    <div>
      <div className="mb-3 flex gap-2">
        <input className={inputCls} placeholder="New court name (e.g. Court 4)" value={name} onChange={(e) => setName(e.target.value)} />
        <Btn size="sm" icon={Plus} onClick={() => { if (name.trim()) { onAdd(name.trim()); setName(""); } }}>Add court</Btn>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {tournament.courts.map((c) => (
          <Card key={c.id} className="flex items-center justify-between px-3 py-2.5">
            <div>
              <div className="text-sm font-medium text-stone-800">{c.name}</div>
              <Badge tone={c.status === "AVAILABLE" ? "emerald" : "slate"}>{c.status === "AVAILABLE" ? "Available" : "Unavailable"}</Badge>
            </div>
            <div className="flex gap-1">
              <button className="rounded p-1 text-stone-400 hover:bg-stone-100" onClick={() => onUpdate(c.id, { status: c.status === "AVAILABLE" ? "UNAVAILABLE" : "AVAILABLE" })} title="Toggle availability"><RotateCcw size={14} /></button>
              <button className="rounded p-1 text-stone-400 hover:bg-red-50 hover:text-red-500" onClick={() => onRemove(c.id)} title="Remove court"><Trash2 size={14} /></button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ============================ FEATURE: SCORER ============================ */

function ScorerPanel({ match, event, entriesById, onScore, onUndo, onRetire, onStart }) {
  const a = entriesById[match.entryA], b = entriesById[match.entryB];
  const tally = BadmintonScoringEngine.gameTally(match.games || []);
  const current = match.games?.[match.games.length - 1];
  const [confirmRetire, setConfirmRetire] = useState(null);

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-stone-200 bg-stone-50 px-4 py-2.5">
        <div className="flex items-center gap-2 text-xs text-stone-500">
          <Badge tone="slate">{match.court || "Court —"}</Badge>
          <span>{CATEGORY_META[event.category].label} · {roundLabel(match.round, event.totalRounds)}</span>
        </div>
        {match.status === "LIVE" && <span className="flex items-center gap-1 text-xs font-semibold text-red-600"><Radio size={12} className="animate-pulse" /> LIVE</span>}
      </div>

      {match.status !== "LIVE" ? (
        <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
          <div className="text-sm text-stone-600">{entryShort(a)} <span className="text-stone-300">vs</span> {entryShort(b)}</div>
          <Btn icon={Play} onClick={() => onStart(match.id)}>Start match</Btn>
        </div>
      ) : (
        <div className="p-4">
          <div className="grid grid-cols-2 gap-3">
            {[["A", a], ["B", b]].map(([side, e]) => (
              <div key={side} className="flex flex-col items-center gap-2 rounded-md border border-stone-200 py-4">
                <div className="px-2 text-center text-sm font-medium text-stone-800">{entryName(e)}</div>
                <div className="font-mono text-5xl font-bold tabular-nums text-stone-900">{current ? (side === "A" ? current.a : current.b) : 0}</div>
                <div className="flex gap-2">
                  <button className="flex h-9 w-9 items-center justify-center rounded-md border border-stone-300 text-stone-500 hover:bg-stone-50 disabled:opacity-30" onClick={() => onScore(match.id, side, -1)}><Minus size={16} /></button>
                  <button className="flex h-9 w-9 items-center justify-center rounded-md bg-teal-700 text-white hover:bg-teal-800 disabled:opacity-30"
                    disabled={!current || !BadmintonScoringEngine.canScore(current.a, current.b, side)}
                    onClick={() => onScore(match.id, side, 1)}><Plus size={16} /></button>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs text-stone-500">
              Games: <span className="font-mono font-semibold text-stone-700">{tally.a}–{tally.b}</span>
              {match.games.map((g, i) => i < match.games.length - 1 || BadmintonScoringEngine.isGameOver(g.a, g.b) ? (
                <span key={i} className="ml-1 rounded bg-stone-100 px-1.5 py-0.5 font-mono">{g.a}-{g.b}</span>
              ) : null)}
            </div>
            <div className="flex gap-2">
              <Btn size="sm" variant="ghost" icon={RotateCcw} onClick={() => onUndo(match.id)}>Undo game</Btn>
              {confirmRetire ? (
                <div className="flex items-center gap-1 text-xs">
                  <span className="text-stone-500">{entryShort(confirmRetire === "A" ? a : b)} retires?</span>
                  <Btn size="sm" variant="danger" onClick={() => { onRetire(match.id, confirmRetire); setConfirmRetire(null); }}>Confirm</Btn>
                  <Btn size="sm" variant="ghost" onClick={() => setConfirmRetire(null)}>Cancel</Btn>
                </div>
              ) : (
                <div className="flex gap-1">
                  <Btn size="sm" variant="ghost" onClick={() => setConfirmRetire("A")}>A retires</Btn>
                  <Btn size="sm" variant="ghost" onClick={() => setConfirmRetire("B")}>B retires</Btn>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function LiveScoringBoard({ tournament, matches, events, entriesById, dispatch, notify }) {
  const [openMatchId, setOpenMatchId] = useState(null);
  const live = matches.filter((m) => m.status === "LIVE");
  const ready = matches.filter((m) => m.status === "READY");
  const active = [...live, ...ready];
  const openMatch = matches.find((m) => m.id === openMatchId);
  const openEvent = openMatch && events.find((e) => e.id === openMatch.eventId);

  if (active.length === 0) return <EmptyState icon={Radio} title="No matches ready to score" hint="Once a schedule is generated and the tournament is started, matches ready to play will appear here." />;

  if (openMatch) {
    return (
      <div>
        <button className="mb-3 flex items-center gap-1 text-xs font-medium text-stone-500 hover:text-stone-800" onClick={() => setOpenMatchId(null)}><ChevronLeft size={14} /> All courts</button>
        <ScorerPanel
          match={openMatch} event={openEvent} entriesById={entriesById}
          onStart={(id) => { dispatch({ type: "START_MATCH", payload: { matchId: id } }); }}
          onScore={(id, side, delta) => dispatch({ type: "SCORE_POINT", payload: { matchId: id, side, delta } })}
          onUndo={(id) => dispatch({ type: "UNDO_LAST_GAME", payload: { matchId: id } })}
          onRetire={(id, side) => { dispatch({ type: "RETIRE_MATCH", payload: { matchId: id, retiredSide: side } }); setOpenMatchId(null); }}
        />
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {active.map((m) => {
        const ev = events.find((e) => e.id === m.eventId);
        const a = entriesById[m.entryA], b = entriesById[m.entryB];
        const tally = BadmintonScoringEngine.gameTally(m.games || []);
        return (
          <button key={m.id} onClick={() => setOpenMatchId(m.id)} className="rounded-lg border border-stone-200 bg-white p-3.5 text-left shadow-sm hover:border-teal-300 hover:shadow-md transition-all">
            <div className="mb-2 flex items-center justify-between">
              <Badge tone="slate">{m.court || "Court —"}</Badge>
              {m.status === "LIVE" ? <span className="flex items-center gap-1 text-[11px] font-semibold text-red-600"><Radio size={10} className="animate-pulse" />LIVE</span> : <Badge tone="teal">Ready</Badge>}
            </div>
            <div className="text-[11px] uppercase tracking-wide text-stone-400">{CATEGORY_META[ev.category].label} · {roundLabel(m.round, ev.totalRounds)}</div>
            <div className="mt-1.5 space-y-1 text-sm">
              <div className="flex items-center justify-between"><span className="truncate font-medium text-stone-800">{entryShort(a)}</span><span className="font-mono text-stone-500">{tally.a}</span></div>
              <div className="flex items-center justify-between"><span className="truncate font-medium text-stone-800">{entryShort(b)}</span><span className="font-mono text-stone-500">{tally.b}</span></div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* ============================ FEATURE: RESULTS ============================ */

function ResultsPanel({ event, matches, entriesById }) {
  const completed = matches.filter((m) => m.status === "COMPLETED" || m.status === "WALKOVER").sort((a, b) => a.round - b.round || a.matchNumber - b.matchNumber);
  const champion = event.championEntryId ? entriesById[event.championEntryId] : null;
  return (
    <div className="space-y-4">
      {champion && (
        <Card className="flex items-center gap-3 border-amber-200 bg-amber-50 p-4">
          <Trophy className="text-amber-600" size={28} />
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">{CATEGORY_META[event.category].label} Champion</div>
            <div className="text-lg font-bold text-stone-900">{entryName(champion)}</div>
          </div>
        </Card>
      )}
      {completed.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No results yet" hint="Completed matches will be listed here as the tournament progresses." />
      ) : (
        <div className="overflow-x-auto rounded-md border border-stone-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-stone-50 text-[11px] uppercase tracking-wide text-stone-500">
              <tr><th className="px-3 py-2 font-medium">Round</th><th className="px-3 py-2 font-medium">Result</th><th className="px-3 py-2 font-medium">Score</th></tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {completed.map((m) => {
                const a = entriesById[m.entryA], b = entriesById[m.entryB];
                const winner = m.winnerEntryId === m.entryA ? "A" : "B";
                return (
                  <tr key={m.id}>
                    <td className="px-3 py-2 text-stone-500">{roundLabel(m.round, event.totalRounds)}</td>
                    <td className="px-3 py-2">
                      {m.isBye ? <span className="text-stone-500">{entryShort(a)} advances (bye)</span> : (
                        <span>
                          <span className={cx(winner === "A" && "font-semibold text-teal-800")}>{entryShort(a)}</span>
                          <span className="text-stone-300"> def. </span>
                          <span className={cx(winner === "B" && "font-semibold text-teal-800")}>{entryShort(b)}</span>
                          {m.retired && <span className="ml-1 text-[11px] text-stone-400">(retired)</span>}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-stone-500">{m.games?.map((g, i) => <span key={i} className="mr-1.5">{g.a}-{g.b}</span>)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ============================ ORGANIZER AREA ============================= */

function TournamentStatCard({ label, value }) {
  return <div><div className="font-mono text-xl font-bold text-stone-900">{value}</div><div className="text-[11px] uppercase tracking-wide text-stone-400">{label}</div></div>;
}

function OrganizerDashboard({ tournaments, events, matches, entries, onOpen, onCreate }) {
  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <Eyebrow>Organizer</Eyebrow>
          <h1 className="text-2xl font-bold text-stone-900">Command center</h1>
        </div>
        <Btn icon={Plus} onClick={onCreate}>Create tournament</Btn>
      </div>
      {tournaments.length === 0 ? (
        <EmptyState icon={Trophy} title="No tournaments yet" hint="Create your first tournament to start registration, draws and live scoring." action={<Btn size="sm" icon={Plus} className="mt-2" onClick={onCreate}>Create tournament</Btn>} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tournaments.map((t) => {
            const tEvents = events.filter((e) => e.tournamentId === t.id);
            const tMatches = matches.filter((m) => tEvents.some((e) => e.id === m.eventId));
            const tEntries = entries.filter((e) => tEvents.some((ev) => ev.id === e.eventId));
            const live = tMatches.filter((m) => m.status === "LIVE").length;
            const completedM = tMatches.filter((m) => m.status === "COMPLETED" || m.status === "WALKOVER").length;
            return (
              <button key={t.id} onClick={() => onOpen(t.id)} className="rounded-lg border border-stone-200 bg-white p-4 text-left shadow-sm transition-all hover:border-teal-300 hover:shadow-md">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="font-semibold text-stone-900">{t.name}</div>
                  <Badge tone={TOURNAMENT_STATUS_META[t.status].tone}>{TOURNAMENT_STATUS_META[t.status].label}</Badge>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-stone-500">
                  <span className="flex items-center gap-1"><MapPin size={11} />{t.venue}</span>
                  <span className="flex items-center gap-1"><Calendar size={11} />{fmtDateRange(t.startDate, t.endDate)}</span>
                </div>
                <div className="mt-3 grid grid-cols-4 gap-2 border-t border-stone-100 pt-3">
                  <TournamentStatCard label="Entries" value={tEntries.length} />
                  <TournamentStatCard label="Matches" value={tMatches.length} />
                  <TournamentStatCard label="Live" value={live} />
                  <TournamentStatCard label="Done" value={completedM} />
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const ORG_TABS = [
  { key: "overview", label: "Overview", icon: Home },
  { key: "participants", label: "Participants", icon: Users },
  { key: "draw", label: "Draw", icon: Swords },
  { key: "schedule", label: "Schedule", icon: Calendar },
  { key: "courts", label: "Courts", icon: LayoutGrid },
  { key: "live", label: "Live scoring", icon: Radio },
  { key: "results", label: "Results", icon: Trophy },
  { key: "settings", label: "Settings", icon: Settings },
];

function TournamentControlCenter({ tournament, events, matches, entries, dispatch, onBack, notify }) {
  const [tab, setTab] = useState("overview");
  const [eventId, setEventId] = useState(events[0]?.id);
  useEffect(() => { if (!events.find((e) => e.id === eventId)) setEventId(events[0]?.id); }, [events]);
  const event = events.find((e) => e.id === eventId);
  const { entriesById } = useEntities({ entries, events: [], tournaments: [] });

  const eventEntries = entries.filter((e) => e.eventId === eventId);
  const eventMatches = matches.filter((m) => m.eventId === eventId);
  const tMatches = matches.filter((m) => events.some((e) => e.id === m.eventId));

  const guarded = (fn, okMsg) => {
    try { fn(); if (okMsg) notify(okMsg); } catch (e) { notify(e.message, "error"); }
  };

  const confirmedCount = eventEntries.filter((e) => e.regStatus === "CONFIRMED").length;

  return (
    <div>
      <button className="mb-3 flex items-center gap-1 text-xs font-medium text-stone-500 hover:text-stone-800" onClick={onBack}><ChevronLeft size={14} /> All tournaments</button>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-stone-900">{tournament.name}</h1>
            <Badge tone={TOURNAMENT_STATUS_META[tournament.status].tone}>{TOURNAMENT_STATUS_META[tournament.status].label}</Badge>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-stone-500">
            <span className="flex items-center gap-1"><MapPin size={11} />{tournament.venue}</span>
            <span className="flex items-center gap-1"><Calendar size={11} />{fmtDateRange(tournament.startDate, tournament.endDate)}</span>
            {tournament.slug && <span className="flex items-center gap-1 text-teal-700">/t/{tournament.slug}</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {tournament.status === "DRAFT" && <Btn size="sm" icon={ArrowRight} onClick={() => guarded(() => dispatch({ type: "PUBLISH_TOURNAMENT", payload: { tournamentId: tournament.id, slugBase: tournament.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") } }), "Published.")}>Publish</Btn>}
          {tournament.status === "REGISTRATION_OPEN" && <Btn size="sm" variant="secondary" onClick={() => guarded(() => dispatch({ type: "CLOSE_REGISTRATION", payload: { tournamentId: tournament.id } }))}>Close registration</Btn>}
          {tournament.status === "REGISTRATION_CLOSED" && <Btn size="sm" icon={Play} onClick={() => guarded(() => dispatch({ type: "START_TOURNAMENT", payload: { tournamentId: tournament.id } }))}>Start tournament</Btn>}
        </div>
      </div>

      <div className="flex flex-col gap-5 lg:flex-row">
        <div className="flex gap-1 overflow-x-auto lg:w-48 lg:flex-none lg:flex-col lg:overflow-visible">
          {ORG_TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} className={cx(
              "flex flex-shrink-0 items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors",
              tab === t.key ? "bg-teal-50 text-teal-800" : "text-stone-600 hover:bg-stone-100"
            )}>
              <t.icon size={15} />{t.label}
            </button>
          ))}
        </div>

        <div className="min-w-0 flex-1">
          {["participants", "draw", "schedule", "results"].includes(tab) && events.length > 1 && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {events.map((e) => (
                <button key={e.id} onClick={() => setEventId(e.id)} className={cx("rounded-full border px-3 py-1 text-xs font-medium", eventId === e.id ? "border-teal-600 bg-teal-600 text-white" : "border-stone-200 text-stone-600 hover:bg-stone-50")}>
                  {CATEGORY_META[e.category].label}
                </button>
              ))}
            </div>
          )}

          {tab === "overview" && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Card className="p-3"><TournamentStatCard label="Entries" value={entries.length} /></Card>
                <Card className="p-3"><TournamentStatCard label="Matches" value={tMatches.length} /></Card>
                <Card className="p-3"><TournamentStatCard label="Courts" value={tournament.courts.length} /></Card>
                <Card className="p-3"><TournamentStatCard label="Live now" value={tMatches.filter((m) => m.status === "LIVE").length} /></Card>
              </div>
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">Categories</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {events.map((e) => {
                    const c = entries.filter((en) => en.eventId === e.id).length;
                    return (
                      <Card key={e.id} className="flex items-center justify-between p-3">
                        <div>
                          <div className="text-sm font-medium text-stone-800">{CATEGORY_META[e.category].label}</div>
                          <div className="text-xs text-stone-500">{c} / {e.maxEntries} registered · {inr(e.feeINR)}</div>
                        </div>
                        <Badge tone={EVENT_STATUS_META[e.status].tone}>{EVENT_STATUS_META[e.status].label}</Badge>
                      </Card>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {tab === "participants" && event && (
            <ParticipantsPanel
              event={event} entries={eventEntries}
              onApprove={(id) => dispatch({ type: "UPDATE_ENTRY_STATUS", payload: { entryId: id, regStatus: "CONFIRMED" } })}
              onReject={(id) => dispatch({ type: "UPDATE_ENTRY_STATUS", payload: { entryId: id, regStatus: "REJECTED" } })}
              onRemove={(id) => guarded(() => dispatch({ type: "REMOVE_ENTRY", payload: { entryId: id } }))}
              onSimPay={(id) => dispatch({ type: "SIMULATE_PAYMENT_SUCCESS", payload: { entryId: id } })}
              onSimFail={(id) => dispatch({ type: "SIMULATE_PAYMENT_FAILURE", payload: { entryId: id } })}
              onRefund={(id) => dispatch({ type: "MARK_REFUNDED", payload: { entryId: id } })}
              onAddManual={(eid, players) => guarded(() => dispatch({ type: "REGISTER_ENTRY", payload: { eventId: eid, players } }))}
            />
          )}

          {tab === "draw" && event && (
            <div>
              {!event.totalRounds ? (
                <EmptyState icon={Swords} title="Generate the draw" hint={`${confirmedCount} confirmed ${confirmedCount === 1 ? "entry" : "entries"}. Registration must be closed first.`}
                  action={<Btn size="sm" className="mt-2" disabled={tournament.status === "REGISTRATION_OPEN" || tournament.status === "DRAFT" || confirmedCount < 2} onClick={() => guarded(() => dispatch({ type: "GENERATE_DRAW", payload: { eventId } }))}>Generate draw</Btn>} />
              ) : (
                <BracketView event={event} matches={eventMatches} entriesById={entriesById} />
              )}
            </div>
          )}

          {tab === "schedule" && event && (
            <div>
              {event.status === "DRAW_READY" && (
                <div className="mb-3"><Btn size="sm" icon={Calendar} onClick={() => guarded(() => dispatch({ type: "GENERATE_SCHEDULE", payload: { eventId } }))}>Generate schedule</Btn></div>
              )}
              <ScheduleTable matches={eventMatches} entriesById={entriesById} event={event} />
            </div>
          )}

          {tab === "courts" && (
            <CourtsPanel tournament={tournament}
              onAdd={(name) => dispatch({ type: "ADD_COURT", payload: { tournamentId: tournament.id, name } })}
              onUpdate={(id, patch) => dispatch({ type: "UPDATE_COURT", payload: { tournamentId: tournament.id, courtId: id, patch } })}
              onRemove={(id) => dispatch({ type: "REMOVE_COURT", payload: { tournamentId: tournament.id, courtId: id } })} />
          )}

          {tab === "live" && (
            <LiveScoringBoard tournament={tournament} matches={tMatches} events={events} entriesById={entriesById} dispatch={dispatch} notify={notify} />
          )}

          {tab === "results" && event && <ResultsPanel event={event} matches={eventMatches} entriesById={entriesById} />}

          {tab === "settings" && (
            <div className="max-w-lg space-y-4">
              <Card className="p-4 space-y-3">
                <Field label="Tournament name"><input className={inputCls} value={tournament.name} onChange={(e) => dispatch({ type: "UPDATE_TOURNAMENT", payload: { tournamentId: tournament.id, patch: { name: e.target.value } } })} /></Field>
                <Field label="Venue"><input className={inputCls} value={tournament.venue} onChange={(e) => dispatch({ type: "UPDATE_TOURNAMENT", payload: { tournamentId: tournament.id, patch: { venue: e.target.value } } })} /></Field>
                <Field label="Contact email"><input className={inputCls} value={tournament.contactEmail || ""} onChange={(e) => dispatch({ type: "UPDATE_TOURNAMENT", payload: { tournamentId: tournament.id, patch: { contactEmail: e.target.value } } })} /></Field>
              </Card>
              <Card className="space-y-2 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">Lifecycle</div>
                <div className="flex flex-wrap gap-2">
                  {tournament.status !== "COMPLETED" && tournament.status !== "CANCELLED" && events.length > 0 && events.every((e) => e.status === "COMPLETED") && (
                    <Btn size="sm" icon={Trophy} onClick={() => dispatch({ type: "COMPLETE_TOURNAMENT", payload: { tournamentId: tournament.id } })}>Mark tournament completed</Btn>
                  )}
                  {tournament.status !== "COMPLETED" && tournament.status !== "CANCELLED" && (
                    <Btn size="sm" variant="danger" onClick={() => { if (confirm("Cancel this tournament? This cannot be undone.")) dispatch({ type: "CANCEL_TOURNAMENT", payload: { tournamentId: tournament.id } }); }}>Cancel tournament</Btn>
                  )}
                </div>
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================ PUBLIC AREA ================================ */

function PublicDiscovery({ tournaments, onOpen }) {
  const published = tournaments.filter((t) => t.status !== "DRAFT");
  return (
    <div>
      <div className="mb-6">
        <Eyebrow>Courtside</Eyebrow>
        <h1 className="text-2xl font-bold text-stone-900">Find a tournament</h1>
        <p className="mt-1 text-sm text-stone-500">Browse live and upcoming badminton tournaments — no account needed to follow along.</p>
      </div>
      {published.length === 0 ? (
        <EmptyState icon={Trophy} title="No tournaments published yet" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {published.map((t) => (
            <button key={t.id} onClick={() => onOpen(t.id)} className="rounded-lg border border-stone-200 bg-white p-4 text-left shadow-sm transition-all hover:border-teal-300 hover:shadow-md">
              <div className="mb-2 flex items-start justify-between gap-2">
                <div className="font-semibold text-stone-900">{t.name}</div>
                <Badge tone={TOURNAMENT_STATUS_META[t.status].tone}>{t.status === "LIVE" ? <><Radio size={10} className="animate-pulse" /> Live</> : TOURNAMENT_STATUS_META[t.status].label}</Badge>
              </div>
              <p className="mb-2 truncate text-xs text-stone-500">{t.description}</p>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-stone-500">
                <span className="flex items-center gap-1"><MapPin size={11} />{t.location || t.venue}</span>
                <span className="flex items-center gap-1"><Calendar size={11} />{fmtDateRange(t.startDate, t.endDate)}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const PUB_TABS = [
  { key: "overview", label: "Overview" },
  { key: "categories", label: "Categories" },
  { key: "schedule", label: "Schedule" },
  { key: "live", label: "Live" },
  { key: "bracket", label: "Bracket" },
  { key: "results", label: "Results" },
];

function PublicTournamentPage({ tournament, events, matches, entries, onBack, onRegister }) {
  const [tab, setTab] = useState("overview");
  const [eventId, setEventId] = useState(events[0]?.id);
  useEffect(() => { if (!events.find((e) => e.id === eventId)) setEventId(events[0]?.id); }, [events]);
  const event = events.find((e) => e.id === eventId);
  const { entriesById } = useEntities({ entries, events: [], tournaments: [] });
  const eventMatches = matches.filter((m) => m.eventId === eventId);
  const tMatches = matches.filter((m) => events.some((e) => e.id === m.eventId));
  const liveMatches = tMatches.filter((m) => m.status === "LIVE");

  return (
    <div>
      <button className="mb-3 flex items-center gap-1 text-xs font-medium text-stone-500 hover:text-stone-800" onClick={onBack}><ChevronLeft size={14} /> All tournaments</button>

      <div className="mb-5 rounded-lg border border-stone-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-stone-900">{tournament.name}</h1>
              <Badge tone={TOURNAMENT_STATUS_META[tournament.status].tone}>{tournament.status === "LIVE" ? <><Radio size={10} className="animate-pulse" /> Live</> : TOURNAMENT_STATUS_META[tournament.status].label}</Badge>
            </div>
            <p className="mt-1 max-w-xl text-sm text-stone-500">{tournament.description}</p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-500">
              <span className="flex items-center gap-1"><MapPin size={12} />{tournament.venue}{tournament.location ? `, ${tournament.location}` : ""}</span>
              <span className="flex items-center gap-1"><Calendar size={12} />{fmtDateRange(tournament.startDate, tournament.endDate)}</span>
              <span className="flex items-center gap-1"><Building2 size={12} />{tournament.organizerName}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-stone-200">
        {PUB_TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={cx("flex-shrink-0 border-b-2 px-3 py-2 text-sm font-medium", tab === t.key ? "border-teal-700 text-teal-800" : "border-transparent text-stone-500 hover:text-stone-800")}>{t.label}</button>
        ))}
      </div>

      {["categories", "schedule", "live", "bracket", "results"].includes(tab) && tab !== "live" && events.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {events.map((e) => (
            <button key={e.id} onClick={() => setEventId(e.id)} className={cx("rounded-full border px-3 py-1 text-xs font-medium", eventId === e.id ? "border-teal-600 bg-teal-600 text-white" : "border-stone-200 text-stone-600 hover:bg-stone-50")}>{CATEGORY_META[e.category].label}</button>
          ))}
        </div>
      )}

      {tab === "overview" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card className="p-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">Format</div>
            <p className="text-sm text-stone-600">{tournament.settings?.rules}</p>
          </Card>
          <Card className="p-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">Contact</div>
            <p className="text-sm text-stone-600">{tournament.contactEmail}<br />{tournament.contactPhone}</p>
          </Card>
        </div>
      )}

      {tab === "categories" && (
        <div className="grid gap-3 sm:grid-cols-2">
          {events.map((e) => {
            const count = entries.filter((en) => en.eventId === e.id && en.regStatus !== "REJECTED" && en.regStatus !== "CANCELLED").length;
            const open = e.status === "REGISTRATION_OPEN";
            return (
              <Card key={e.id} className="p-4">
                <div className="mb-1 flex items-center justify-between">
                  <div className="font-medium text-stone-900">{CATEGORY_META[e.category].label}</div>
                  <Badge tone={EVENT_STATUS_META[e.status].tone}>{EVENT_STATUS_META[e.status].label}</Badge>
                </div>
                <div className="mb-3 text-xs text-stone-500">{count} / {e.maxEntries} registered · {inr(e.feeINR)} entry fee</div>
                <Btn size="sm" disabled={!open || count >= e.maxEntries} onClick={() => onRegister(e)}>{count >= e.maxEntries ? "Category full" : "Register"}</Btn>
              </Card>
            );
          })}
        </div>
      )}

      {tab === "schedule" && event && <ScheduleTable matches={eventMatches} entriesById={entriesById} event={event} />}

      {tab === "live" && (
        liveMatches.length === 0 ? <EmptyState icon={Radio} title="No live matches right now" /> : (
          <div className="grid gap-3 sm:grid-cols-2">
            {liveMatches.map((m) => {
              const ev = events.find((e) => e.id === m.eventId);
              const a = entriesById[m.entryA], b = entriesById[m.entryB];
              const tally = BadmintonScoringEngine.gameTally(m.games || []);
              const current = m.games[m.games.length - 1];
              return (
                <Card key={m.id} className="p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <Badge tone="slate">{m.court}</Badge>
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-red-600"><Radio size={10} className="animate-pulse" />LIVE</span>
                  </div>
                  <div className="mb-2 text-[11px] uppercase tracking-wide text-stone-400">{CATEGORY_META[ev.category].label} · {roundLabel(m.round, ev.totalRounds)}</div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm"><span className="font-medium text-stone-800">{entryShort(a)}</span><span className="font-mono text-lg font-bold">{current?.a ?? 0}</span></div>
                    <div className="flex items-center justify-between text-sm"><span className="font-medium text-stone-800">{entryShort(b)}</span><span className="font-mono text-lg font-bold">{current?.b ?? 0}</span></div>
                  </div>
                  <div className="mt-2 text-[11px] text-stone-400">Games {tally.a}–{tally.b}</div>
                </Card>
              );
            })}
          </div>
        )
      )}

      {tab === "bracket" && event && <BracketView event={event} matches={eventMatches} entriesById={entriesById} />}
      {tab === "results" && event && <ResultsPanel event={event} matches={eventMatches} entriesById={entriesById} />}
    </div>
  );
}

/* ============================== APP SHELL ================================ */

function NotificationBell({ notifications, onOpenChange, onMarkRead }) {
  const [open, setOpen] = useState(false);
  const unread = notifications.filter((n) => !n.read).length;
  return (
    <div className="relative">
      <button className="relative rounded-md p-2 text-stone-500 hover:bg-stone-100" onClick={() => { setOpen(!open); if (!open) onMarkRead(); }}>
        <Bell size={17} />
        {unread > 0 && <span className="absolute right-1 top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-600 text-[9px] font-bold text-white">{unread}</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-80 rounded-lg border border-stone-200 bg-white shadow-lg">
            <div className="border-b border-stone-100 px-3.5 py-2.5 text-xs font-semibold uppercase tracking-wide text-stone-500">Notifications</div>
            <div className="max-h-80 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="px-3.5 py-6 text-center text-xs text-stone-400">Nothing yet</div>
              ) : notifications.slice(0, 20).map((n) => (
                <div key={n.id} className="border-b border-stone-50 px-3.5 py-2.5 text-sm text-stone-700 last:border-0">
                  {n.message}
                  <div className="mt-0.5 text-[11px] text-stone-400">{timeAgo(n.createdAt)}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function App() {
  const [data, dispatch0] = useReducer(reducer, undefined, createSeedState);
  const [hydrated, setHydrated] = useState(false);
  const [mode, setMode] = useState("organizer"); // 'organizer' | 'public'
  const [orgTournamentId, setOrgTournamentId] = useState(null);
  const [pubTournamentId, setPubTournamentId] = useState(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [regModal, setRegModal] = useState(null); // event object
  const [toasts, setToasts] = useState([]);
  const saveTimer = useRef(null);

  const notify = (message, kind = "success") => {
    const id = uid("toast");
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  };

  // load persisted state once
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await window.storage.get("app-state", false);
        if (!cancelled && res && res.value) {
          const parsed = JSON.parse(res.value);
          dispatch0({ type: "HYDRATE", payload: parsed });
        }
      } catch (e) {
        // nothing saved yet — keep demo seed
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // persist on change (debounced)
  useEffect(() => {
    if (!hydrated) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try { await window.storage.set("app-state", JSON.stringify(data), false); }
      catch (e) { console.error("Save failed", e); }
    }, 400);
    return () => clearTimeout(saveTimer.current);
  }, [data, hydrated]);

  const orgTournament = data.tournaments.find((t) => t.id === orgTournamentId);
  const pubTournament = data.tournaments.find((t) => t.id === pubTournamentId);

  // once a new tournament is created, jump straight into its control center
  useEffect(() => {
    if (data._lastCreatedId) {
      setMode("organizer");
      setOrgTournamentId(data._lastCreatedId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data._lastCreatedId]);

  const handleCreateTournament = ({ basics, categories, settings }) => {
    dispatch0({ type: "CREATE_TOURNAMENT", payload: { basics, categories, settings } });
    notify("Tournament created as a draft.");
  };

  const handleRegisterSubmit = (eventId, players) => {
    try {
      dispatch0({ type: "REGISTER_ENTRY", payload: { eventId, players } });
    } catch (e) { throw e; }
  };

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900" style={{ fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif" }}>
      <style>{`
        @keyframes fadein { from { opacity:0; transform: translateY(4px);} to { opacity:1; transform:none; } }
      `}</style>

      <header className="sticky top-0 z-30 border-b border-stone-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-teal-700 text-white"><Trophy size={15} /></div>
            <span className="text-[15px] font-bold uppercase tracking-tight text-stone-900">Courtside</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-0.5 rounded-md border border-stone-200 bg-stone-100 p-0.5 sm:flex">
              <button onClick={() => setMode("public")} className={cx("rounded px-3 py-1.5 text-xs font-medium", mode === "public" ? "bg-white shadow-sm text-stone-900" : "text-stone-500")}>Public site</button>
              <button onClick={() => setMode("organizer")} className={cx("rounded px-3 py-1.5 text-xs font-medium", mode === "organizer" ? "bg-white shadow-sm text-stone-900" : "text-stone-500")}>Organizer</button>
            </div>
            <NotificationBell notifications={data.notifications} onMarkRead={() => dispatch0({ type: "MARK_NOTIFS_READ" })} />
          </div>
        </div>
        <div className="flex border-t border-stone-100 sm:hidden">
          <button onClick={() => setMode("public")} className={cx("flex-1 py-2 text-xs font-medium", mode === "public" ? "text-teal-700 border-b-2 border-teal-700" : "text-stone-500")}>Public site</button>
          <button onClick={() => setMode("organizer")} className={cx("flex-1 py-2 text-xs font-medium", mode === "organizer" ? "text-teal-700 border-b-2 border-teal-700" : "text-stone-500")}>Organizer</button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {mode === "organizer" ? (
          orgTournament ? (
            <TournamentControlCenter
              tournament={orgTournament}
              events={data.events.filter((e) => e.tournamentId === orgTournament.id)}
              matches={data.matches}
              entries={data.entries}
              dispatch={dispatch0}
              onBack={() => setOrgTournamentId(null)}
              notify={notify}
            />
          ) : (
            <OrganizerDashboard
              tournaments={data.tournaments}
              events={data.events}
              matches={data.matches}
              entries={data.entries}
              onOpen={setOrgTournamentId}
              onCreate={() => setWizardOpen(true)}
            />
          )
        ) : pubTournament ? (
          <PublicTournamentPage
            tournament={pubTournament}
            events={data.events.filter((e) => e.tournamentId === pubTournament.id)}
            matches={data.matches}
            entries={data.entries}
            onBack={() => setPubTournamentId(null)}
            onRegister={(event) => setRegModal(event)}
          />
        ) : (
          <PublicDiscovery tournaments={data.tournaments} onOpen={setPubTournamentId} />
        )}
      </main>

      <footer className="mx-auto max-w-6xl px-4 pb-8 pt-4 text-center text-[11px] text-stone-400">
        Payments shown in this build are simulated — no real charge is made. Data is saved for this app only.
        <button className="ml-2 underline hover:text-stone-600" onClick={async () => {
          if (confirm("Reset all data back to the demo tournament? This can't be undone.")) {
            const seed = createSeedState();
            dispatch0({ type: "HYDRATE", payload: seed });
            setOrgTournamentId(null); setPubTournamentId(null);
            try { await window.storage.set("app-state", JSON.stringify(seed), false); } catch (e) {}
            notify("Demo data reset.");
          }
        }}>Reset demo data</button>
      </footer>

      <CreateTournamentWizard open={wizardOpen} onClose={() => setWizardOpen(false)} onSubmit={handleCreateTournament} />
      <RegistrationModal open={!!regModal} onClose={() => setRegModal(null)} event={regModal} onSubmit={handleRegisterSubmit} />
      <Toasts toasts={toasts} />
    </div>
  );
}
