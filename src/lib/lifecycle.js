// Tournament lifecycle — one derivation, used by every surface.
//
// The stage a tournament is "in" is not a single column. DRAW_READY lives on
// tournament_events.status (per category — one category can be drawn while
// another is not), SCHEDULE_PUBLISHED lives on tournaments.schedule_published,
// and the rest live on tournaments.status. Deriving the display stage here
// keeps those facts in one place instead of duplicating state in the database,
// which is how a tournament ends up "LIVE" with an unpublished schedule.
//
// The matching hard guarantees are enforced by database triggers and RLS in
// migration 009 — this module decides what to SHOW and what to OFFER; it is
// not the security boundary.

export const STAGES = {
  DRAFT: { key: "DRAFT", label: "Draft", tone: "slate", order: 0, hint: "Only you can see this tournament." },
  REGISTRATION_OPEN: { key: "REGISTRATION_OPEN", label: "Registration open", tone: "emerald", order: 1 },
  REGISTRATION_CLOSED: { key: "REGISTRATION_CLOSED", label: "Registration closed", tone: "amber", order: 2 },
  DRAW_READY: { key: "DRAW_READY", label: "Draw published", tone: "teal", order: 3 },
  SCHEDULE_PUBLISHED: { key: "SCHEDULE_PUBLISHED", label: "Schedule published", tone: "teal", order: 4 },
  LIVE: { key: "LIVE", label: "Live", tone: "red", order: 5 },
  COMPLETED: { key: "COMPLETED", label: "Completed", tone: "indigo", order: 6 },
  ARCHIVED: { key: "ARCHIVED", label: "Archived", tone: "slate", order: 7 },
  CANCELLED: { key: "CANCELLED", label: "Cancelled", tone: "slate", order: 8 },
};

export function tournamentStage(tournament, events = []) {
  if (!tournament) return STAGES.DRAFT;
  const s = tournament.status;
  if (s === "DRAFT") return STAGES.DRAFT;
  if (s === "CANCELLED") return STAGES.CANCELLED;
  if (s === "ARCHIVED") return STAGES.ARCHIVED;
  if (s === "COMPLETED") return STAGES.COMPLETED;
  if (s === "LIVE") return STAGES.LIVE;
  if (s === "REGISTRATION_OPEN") return STAGES.REGISTRATION_OPEN;

  // REGISTRATION_CLOSED is the window where the draw and schedule appear.
  if (tournament.schedule_published) return STAGES.SCHEDULE_PUBLISHED;
  const anyDrawn = events.some((e) => ["DRAW_READY", "SCHEDULED", "LIVE", "COMPLETED"].includes(e.status));
  if (anyDrawn) return STAGES.DRAW_READY;
  return STAGES.REGISTRATION_CLOSED;
}

/* ------------------------- REGISTRATION AVAILABILITY --------------------- */

// What a public visitor should be told about entering. Reads the same fields
// the RLS insert policy checks, so the button and the database agree.
export const REG_STATE = {
  NOT_OPEN: { key: "NOT_OPEN", label: "Opens soon", tone: "slate", canRegister: false },
  OPEN: { key: "OPEN", label: "Open", tone: "emerald", canRegister: true },
  ALMOST_FULL: { key: "ALMOST_FULL", label: "Almost full", tone: "amber", canRegister: true },
  WAITLIST: { key: "WAITLIST", label: "Waitlist", tone: "amber", canRegister: true },
  CLOSED: { key: "CLOSED", label: "Closed", tone: "slate", canRegister: false },
  COMPLETED: { key: "COMPLETED", label: "Completed", tone: "indigo", canRegister: false },
  CANCELLED: { key: "CANCELLED", label: "Cancelled", tone: "slate", canRegister: false },
};

// `taken` is the count of entries holding a place (PENDING/CONFIRMED), i.e.
// excluding waitlisted, rejected and cancelled.
export function registrationState(tournament, event, taken, now = Date.now()) {
  if (!tournament) return REG_STATE.CLOSED;
  if (tournament.status === "CANCELLED") return REG_STATE.CANCELLED;
  if (["COMPLETED", "ARCHIVED"].includes(tournament.status)) return REG_STATE.COMPLETED;

  const opensAt = tournament.registration_opens_at ? new Date(tournament.registration_opens_at).getTime() : null;
  const closesAt = tournament.registration_closes_at ? new Date(tournament.registration_closes_at).getTime() : null;

  if (opensAt && now < opensAt) return REG_STATE.NOT_OPEN;
  if (closesAt && now > closesAt) return REG_STATE.CLOSED;
  if (tournament.status !== "REGISTRATION_OPEN") return REG_STATE.CLOSED;
  if (event && event.status !== "REGISTRATION_OPEN") return REG_STATE.CLOSED;

  const max = event?.max_entries ?? 0;
  if (max > 0) {
    const left = max - (taken ?? 0);
    if (left <= 0) return REG_STATE.WAITLIST;      // capacity trigger will waitlist them
    if (left <= Math.max(2, Math.ceil(max * 0.15))) return REG_STATE.ALMOST_FULL;
  }
  return REG_STATE.OPEN;
}

// Whole-tournament view for a discovery card: the best state across categories.
export function tournamentRegistrationState(tournament, events = [], now = Date.now()) {
  if (!events.length) return registrationState(tournament, null, 0, now);
  const rank = { OPEN: 0, ALMOST_FULL: 1, WAITLIST: 2, NOT_OPEN: 3, CLOSED: 4, COMPLETED: 5, CANCELLED: 6 };
  return events
    .map((e) => registrationState(tournament, e, e.taken ?? 0, now))
    .sort((a, b) => rank[a.key] - rank[b.key])[0];
}

/* ------------------------------ ACTION GUARDS ---------------------------- */

// Whether an organizer action is legal right now, and why not when it isn't.
// Mirrors the database triggers so the UI can explain instead of failing.
export function canAct(action, { tournament, events = [], matches = [], role } = {}) {
  const deny = (reason) => ({ ok: false, reason });
  const allow = { ok: true, reason: null };
  const s = tournament?.status;
  const isAdmin = ["OWNER", "ORGANIZER", "ADMIN"].includes(role);

  switch (action) {
    case "publish":
      if (s !== "DRAFT") return deny("This tournament is already published.");
      if (!events.length) return deny("Add at least one category first.");
      return allow;

    case "closeRegistration":
      return s === "REGISTRATION_OPEN" ? allow : deny("Registration is not open.");

    case "generateDraw":
      if (s === "DRAFT") return deny("Publish the tournament first.");
      if (s === "REGISTRATION_OPEN") return deny("Close registration before generating a draw.");
      if (["COMPLETED", "CANCELLED", "ARCHIVED"].includes(s)) return deny("This tournament has finished.");
      return allow;

    case "regenerateDraw":
      if (matches.some((m) => ["LIVE", "COMPLETED", "WALKOVER"].includes(m.status))) {
        return deny("Matches have already been played — the draw is locked.");
      }
      return allow;

    case "checkIn":
      if (!["REGISTRATION_CLOSED", "LIVE"].includes(s)) {
        return deny("Check-in opens once registration closes.");
      }
      return allow;

    case "startTournament":
      if (s !== "REGISTRATION_CLOSED") return deny("Close registration first.");
      if (!matches.length) return deny("Generate at least one draw first.");
      return allow;

    case "score":
      if (s !== "LIVE") return deny("Scoring opens when the tournament starts.");
      return allow;

    case "editCompletedScore":
      return isAdmin ? allow : deny("Only an organizer can correct a published result. Raise a dispute instead.");

    case "complete":
      if (s !== "LIVE") return deny("Only a live tournament can be completed.");
      if (!events.every((e) => e.status === "COMPLETED")) return deny("Every category must finish first.");
      return allow;

    case "archive":
      return s === "COMPLETED" || s === "CANCELLED" ? allow : deny("Only a finished tournament can be archived.");

    case "reopen":
      return deny("A finished tournament cannot be reopened.");

    default:
      return allow;
  }
}
