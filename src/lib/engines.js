// Domain constants, formatting helpers, and the badminton scoring engine.
// Pure functions/data only — portable as-is from the reference build.

export const cx = (...a) => a.filter(Boolean).join(" ");
export const inr = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

export function fmtDate(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  } catch { return d; }
}
export function fmtDateRange(a, b) {
  if (!a) return "—";
  const start = new Date(a), end = b ? new Date(b) : null;
  const sameMonth = end && start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  if (!end || +start === +end) return fmtDate(a);
  if (sameMonth) return `${start.toLocaleDateString("en-IN", { day: "numeric" })}–${end.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`;
  return `${fmtDate(a)} – ${fmtDate(b)}`;
}
export function fmtDateTime(iso) {
  if (!iso) return "TBD";
  try { return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }); } catch { return "TBD"; }
}
export function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const CATEGORY_META = {
  MS: { label: "Men's Singles", kind: "SINGLES" },
  WS: { label: "Women's Singles", kind: "SINGLES" },
  MD: { label: "Men's Doubles", kind: "DOUBLES" },
  WD: { label: "Women's Doubles", kind: "DOUBLES" },
  XD: { label: "Mixed Doubles", kind: "DOUBLES" },
};

export const TOURNAMENT_STATUS_META = {
  DRAFT: { label: "Draft", tone: "slate" },
  REGISTRATION_OPEN: { label: "Registration Open", tone: "emerald" },
  REGISTRATION_CLOSED: { label: "Registration Closed", tone: "amber" },
  LIVE: { label: "Live", tone: "red" },
  COMPLETED: { label: "Completed", tone: "indigo" },
  CANCELLED: { label: "Cancelled", tone: "slate" },
  ARCHIVED: { label: "Archived", tone: "slate" },
};

export const EVENT_STATUS_META = {
  DRAFT: { label: "Draft", tone: "slate" },
  REGISTRATION_OPEN: { label: "Registration Open", tone: "emerald" },
  REGISTRATION_CLOSED: { label: "Registration Closed", tone: "amber" },
  DRAW_READY: { label: "Draw Ready", tone: "teal" },
  SCHEDULED: { label: "Scheduled", tone: "teal" },
  LIVE: { label: "Live", tone: "red" },
  COMPLETED: { label: "Completed", tone: "indigo" },
};

export const REG_STATUS_META = {
  PENDING: { label: "Pending", tone: "amber" },
  CONFIRMED: { label: "Confirmed", tone: "emerald" },
  REJECTED: { label: "Rejected", tone: "red" },
  CANCELLED: { label: "Cancelled", tone: "slate" },
};

export const PAY_STATUS_META = {
  UNPAID: { label: "Unpaid", tone: "slate" },
  PENDING: { label: "Pending", tone: "amber" },
  PAID: { label: "Paid", tone: "emerald" },
  FAILED: { label: "Failed", tone: "red" },
  REFUNDED: { label: "Refunded", tone: "indigo" },
};

export const MATCH_STATUS_META = {
  PENDING: { label: "TBD", tone: "slate" },
  SCHEDULED: { label: "Scheduled", tone: "slate" },
  READY: { label: "Ready", tone: "teal" },
  LIVE: { label: "Live", tone: "red" },
  COMPLETED: { label: "Completed", tone: "indigo" },
  WALKOVER: { label: "Walkover", tone: "amber" },
};

// Dark-theme badge tones: translucent fill + matching border so badges read
// as tinted glass over the sports background rather than solid light chips.
export const TONE_CLASSES = {
  slate: "bg-slate-400/10 text-slate-300 border-slate-400/25",
  emerald: "bg-emerald-400/10 text-emerald-300 border-emerald-400/30",
  amber: "bg-amber-400/10 text-amber-300 border-amber-400/30",
  red: "bg-red-400/10 text-red-300 border-red-400/30",
  indigo: "bg-indigo-400/10 text-indigo-300 border-indigo-400/30",
  teal: "bg-teal-400/10 text-teal-300 border-teal-400/30",
};

export const BadmintonScoringEngine = {
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

// DB `games` rows use score_a/score_b and are ordered by game_number;
// the scoring engine works on the shorter {a,b} shape.
export function toAB(games) {
  return [...(games || [])].sort((x, y) => x.game_number - y.game_number).map((g) => ({ a: g.score_a, b: g.score_b }));
}

export function roundLabel(round, totalRounds) {
  const remaining = totalRounds - round;
  if (remaining === 0) return "Final";
  if (remaining === 1) return "Semifinal";
  if (remaining === 2) return "Quarterfinal";
  return `Round of ${Math.pow(2, totalRounds - round + 1)}`;
}

// roundLabel() assumes knockout terminology (Semifinal, Quarterfinal...),
// which is wrong for a round-robin or group-stage match — "Round 2 of 5" in
// a round robin has nothing to do with how close it is to a final. Use this
// wherever a match could be from either kind of stage.
export function matchStageLabel(match, event) {
  if (!match.group_label) return roundLabel(match.round, event?.total_rounds);
  if (match.group_label === "RR") return `Round ${match.round}`;
  return `Group ${match.group_label} · Round ${match.round}`;
}

export function entryName(entry) {
  if (!entry) return "TBD";
  return (entry.entry_players || []).map((p) => p.name).join(" / ");
}
export function entryShort(entry) {
  if (!entry) return "TBD";
  const players = entry.entry_players || [];
  if (players.length === 1) return players[0].name;
  return players.map((p) => p.name.split(" ")[0]).join(" / ");
}

/* ====================== DIVISIONS (category × age × grade) ================ */

export const FORMAT_META = {
  SINGLE_ELIM: { label: "Knockout", hint: "Single elimination. Lose once and you're out." },
  ROUND_ROBIN: { label: "Round robin", hint: "Everyone plays everyone. Best for 4–8 entries." },
  GROUP_KO: { label: "Groups → knockout", hint: "Round-robin groups, top finishers advance to a knockout." },
};

export const AGE_GROUPS = ["OPEN", "U11", "U13", "U15", "U17", "U19", "35+", "40+", "45+", "50+", "55+"];
export const SKILL_GRADES = ["A", "B", "C"];

// Human label for one event/division, e.g. "Men's Singles · U15 · Grade B".
export function divisionLabel(event) {
  if (!event) return "";
  const parts = [CATEGORY_META[event.category]?.label ?? event.category];
  if (event.age_group && event.age_group !== "OPEN") parts.push(event.age_group);
  if (event.skill_grade) parts.push(`Grade ${event.skill_grade}`);
  return parts.join(" · ");
}

/* ============================ SEEDING ==================================== */

// Standard bracket seed order: for a 8-slot draw this yields
// [1,8,5,4,3,6,7,2] so that seeds 1 and 2 can only meet in the final.
export function bracketSeedOrder(size) {
  let order = [1, 2];
  while (order.length < size) {
    const sum = order.length * 2 + 1;
    const next = [];
    for (const s of order) { next.push(s); next.push(sum - s); }
    order = next;
  }
  return order;
}

export const nextPow2 = (n) => { let p = 1; while (p < n) p *= 2; return p; };

/* ========================= ROUND ROBIN =================================== */

// Circle method: N entries -> N-1 rounds, each entry plays every other once.
// A null in a pairing means that entry sits out that round (odd N).
export function roundRobinRounds(ids) {
  const list = [...ids];
  if (list.length % 2 === 1) list.push(null); // bye marker
  const n = list.length;
  const rounds = [];
  let arr = [...list];
  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i], b = arr[n - 1 - i];
      if (a && b) pairs.push([a, b]);
    }
    rounds.push(pairs);
    // rotate all but the first element
    arr = [arr[0], arr[n - 1], ...arr.slice(1, n - 1)];
  }
  return rounds;
}

// Split seeded entries into `groupCount` groups, snaking so the strongest
// entries are spread across groups rather than stacked in one.
export function snakeIntoGroups(seededIds, groupCount) {
  const groups = Array.from({ length: groupCount }, () => []);
  seededIds.forEach((id, i) => {
    const row = Math.floor(i / groupCount);
    const col = i % groupCount;
    groups[row % 2 === 0 ? col : groupCount - 1 - col].push(id);
  });
  return groups;
}

export const groupLetter = (i) => String.fromCharCode(65 + i);

/* ========================= STANDINGS ===================================== */

// Round-robin / group standings computed from completed matches.
// Ranking: wins -> game difference -> point difference -> head-to-head.
export function computeStandings(entryIds, matches) {
  const rows = {};
  entryIds.forEach((id) => {
    rows[id] = { entryId: id, played: 0, won: 0, lost: 0, gamesFor: 0, gamesAgainst: 0, pointsFor: 0, pointsAgainst: 0 };
  });

  const done = matches.filter((m) => m.status === "COMPLETED" || m.status === "WALKOVER");
  for (const m of done) {
    const a = rows[m.entry_a], b = rows[m.entry_b];
    if (!a || !b) continue;
    a.played++; b.played++;
    if (m.winner_entry_id === m.entry_a) { a.won++; b.lost++; }
    else if (m.winner_entry_id === m.entry_b) { b.won++; a.lost++; }

    const tally = BadmintonScoringEngine.gameTally(toAB(m.games));
    a.gamesFor += tally.a; a.gamesAgainst += tally.b;
    b.gamesFor += tally.b; b.gamesAgainst += tally.a;
    for (const g of (m.games || [])) {
      a.pointsFor += g.score_a; a.pointsAgainst += g.score_b;
      b.pointsFor += g.score_b; b.pointsAgainst += g.score_a;
    }
  }

  const headToHead = (x, y) => {
    const m = done.find(
      (mm) => (mm.entry_a === x.entryId && mm.entry_b === y.entryId) ||
              (mm.entry_a === y.entryId && mm.entry_b === x.entryId)
    );
    if (!m || !m.winner_entry_id) return 0;
    return m.winner_entry_id === x.entryId ? -1 : 1;
  };

  return Object.values(rows).sort((x, y) =>
    y.won - x.won ||
    (y.gamesFor - y.gamesAgainst) - (x.gamesFor - x.gamesAgainst) ||
    (y.pointsFor - y.pointsAgainst) - (x.pointsFor - x.pointsAgainst) ||
    headToHead(x, y)
  );
}

/* ======================= CAREER STATS (player profile) =================== */

// Aggregates a player's whole match history into the numbers a profile shows.
// `entryIds` are all the entries this player has ever competed under.
export function computeCareerStats(matches, entryIds) {
  const mine = new Set(entryIds);
  const played = matches.filter(
    (m) => (m.status === "COMPLETED" || m.status === "WALKOVER") &&
           (mine.has(m.entry_a) || mine.has(m.entry_b))
  );

  let won = 0, lost = 0, gamesFor = 0, gamesAgainst = 0, pointsFor = 0, pointsAgainst = 0;
  const opponents = {};

  for (const m of played) {
    const iAmA = mine.has(m.entry_a);
    const oppId = iAmA ? m.entry_b : m.entry_a;
    const iWon = m.winner_entry_id && mine.has(m.winner_entry_id);
    if (iWon) won++; else lost++;

    const tally = BadmintonScoringEngine.gameTally(toAB(m.games));
    gamesFor += iAmA ? tally.a : tally.b;
    gamesAgainst += iAmA ? tally.b : tally.a;
    for (const g of (m.games || [])) {
      pointsFor += iAmA ? g.score_a : g.score_b;
      pointsAgainst += iAmA ? g.score_b : g.score_a;
    }

    if (oppId) {
      opponents[oppId] = opponents[oppId] || { entryId: oppId, won: 0, lost: 0 };
      if (iWon) opponents[oppId].won++; else opponents[oppId].lost++;
    }
  }

  const total = won + lost;
  return {
    played: total,
    won, lost,
    winPct: total ? Math.round((won / total) * 100) : 0,
    gamesFor, gamesAgainst, pointsFor, pointsAgainst,
    headToHead: Object.values(opponents).sort((a, b) => (b.won + b.lost) - (a.won + a.lost)),
  };
}

// Longest run of consecutive wins, most recent match first.
export function currentStreak(matches, entryIds) {
  const mine = new Set(entryIds);
  const done = matches
    .filter((m) => (m.status === "COMPLETED" || m.status === "WALKOVER") && (mine.has(m.entry_a) || mine.has(m.entry_b)))
    .sort((a, b) => (b.completed_at || "").localeCompare(a.completed_at || ""));
  let n = 0;
  let kind = null;
  for (const m of done) {
    const iWon = m.winner_entry_id && mine.has(m.winner_entry_id);
    const k = iWon ? "W" : "L";
    if (kind === null) kind = k;
    if (k !== kind) break;
    n++;
  }
  return kind ? { kind, count: n } : null;
}

// Achievement badges, computed purely from stats already on hand — no schema
// or extra queries needed. Cheap gamification layer (Cricheroes' badges are
// the closest analogue): a reason for a player to come back and share.
export function computeBadges(stats, streak, titleCount) {
  const badges = [];
  if (titleCount > 0) badges.push({ key: "champion", label: titleCount > 1 ? `${titleCount}x Champion` : "Champion", tone: "yellow" });
  if (streak && streak.kind === "W" && streak.count >= 3) badges.push({ key: "streak", label: `${streak.count}-match win streak`, tone: "teal" });
  if (stats.played >= 3 && stats.lost === 0) badges.push({ key: "undefeated", label: "Undefeated", tone: "purple" });
  if (stats.played >= 10) badges.push({ key: "veteran", label: "10+ matches played", tone: "blue" });
  if (stats.played >= 5 && stats.winPct >= 70) badges.push({ key: "sharp", label: `${stats.winPct}% win rate`, tone: "pink" });
  return badges;
}

// Opponents played most often, for a "rivals" section on a player profile.
export function topRivals(matches, entryIds, entryToPlayer, limit = 3) {
  const mine = new Set(entryIds);
  const rivals = {};
  for (const m of matches) {
    if (m.status !== "COMPLETED" && m.status !== "WALKOVER") continue;
    const iAmA = mine.has(m.entry_a), iAmB = mine.has(m.entry_b);
    if (!iAmA && !iAmB) continue;
    const oppEntry = iAmA ? m.entry_b : m.entry_a;
    const oppPlayer = entryToPlayer[oppEntry];
    if (!oppPlayer) continue;
    const iWon = m.winner_entry_id && mine.has(m.winner_entry_id);
    rivals[oppPlayer] = rivals[oppPlayer] || { playerId: oppPlayer, played: 0, won: 0, lost: 0 };
    rivals[oppPlayer].played++;
    if (iWon) rivals[oppPlayer].won++; else rivals[oppPlayer].lost++;
  }
  return Object.values(rivals).sort((a, b) => b.played - a.played).slice(0, limit);
}

/* ======================== PLAYER PROFILE VOCABULARY ====================== */

export const SKILL_LEVELS = [
  { key: "BEGINNER", label: "Beginner" },
  { key: "INTERMEDIATE", label: "Intermediate" },
  { key: "ADVANCED", label: "Advanced" },
  { key: "PRO", label: "Professional" },
];

export const GENDERS = [
  { key: "M", label: "Male" },
  { key: "F", label: "Female" },
  { key: "O", label: "Other / prefer not to say" },
];

export const CHECK_IN_META = {
  NOT_CHECKED_IN: { label: "Not checked in", tone: "slate" },
  CHECKED_IN: { label: "Checked in", tone: "emerald" },
  LATE: { label: "Late", tone: "amber" },
  NO_SHOW: { label: "No show", tone: "red" },
};

/* ========================== NOTIFICATIONS ================================ */

// Presentation only — the notification types themselves are produced by
// Postgres triggers (migration 008). An unknown type still renders, with a
// neutral tone, rather than blowing up the list.
// `group` is what the player filters by; `urgent` marks the ones that need
// them to move — those are pulled to the top of the inbox and marked, because
// "your court changed" and "your entry fee is recorded" must not read alike.
export const NOTIFICATION_META = {
  REGISTRATION_CONFIRMED: { tone: "emerald", label: "Registration", group: "REGISTRATION" },
  REGISTRATION_REJECTED: { tone: "red", label: "Registration", group: "REGISTRATION" },
  WAITLISTED: { tone: "amber", label: "Waitlist", group: "REGISTRATION" },
  WAITLIST_PROMOTED: { tone: "emerald", label: "Waitlist", group: "REGISTRATION", urgent: true },
  PAYMENT_PAID: { tone: "emerald", label: "Payment", group: "PAYMENT" },
  PAYMENT_UNPAID: { tone: "slate", label: "Payment", group: "PAYMENT" },
  PAYMENT_PENDING: { tone: "amber", label: "Payment", group: "PAYMENT" },
  PAYMENT_FAILED: { tone: "red", label: "Payment", group: "PAYMENT", urgent: true },
  PAYMENT_REFUNDED: { tone: "indigo", label: "Payment", group: "PAYMENT" },
  CHECKED_IN: { tone: "emerald", label: "Check-in", group: "REGISTRATION" },
  MATCH_SCHEDULED: { tone: "teal", label: "Schedule", group: "SCHEDULE" },
  MATCH_TIME_CHANGED: { tone: "amber", label: "Schedule change", group: "SCHEDULE", urgent: true },
  COURT_CHANGED: { tone: "amber", label: "Court change", group: "SCHEDULE", urgent: true },
  OPPONENT_CHANGED: { tone: "amber", label: "Opponent change", group: "SCHEDULE", urgent: true },
  MATCH_APPROACHING: { tone: "teal", label: "Report to court", group: "MATCH", urgent: true },
  MATCH_STARTED: { tone: "red", label: "Match starting", group: "MATCH", urgent: true },
  MATCH_COMPLETED: { tone: "indigo", label: "Result", group: "RESULT" },
  TOURNAMENT_COMPLETED: { tone: "indigo", label: "Tournament", group: "TOURNAMENT" },
  DISPUTE_RESOLVED: { tone: "emerald", label: "Dispute", group: "RESULT" },
  DISPUTE_REJECTED: { tone: "slate", label: "Dispute", group: "RESULT" },
};
export const notificationMeta = (type) =>
  NOTIFICATION_META[type] || { tone: "slate", label: "Update", group: "TOURNAMENT" };

export const NOTIFICATION_GROUPS = [
  { key: "ALL", label: "All" },
  { key: "URGENT", label: "Urgent" },
  { key: "MATCH", label: "Matches" },
  { key: "SCHEDULE", label: "Schedule" },
  { key: "REGISTRATION", label: "Registration" },
  { key: "PAYMENT", label: "Payment" },
  { key: "RESULT", label: "Results" },
];

export const isUrgentNotification = (n) => !!notificationMeta(n.type).urgent && !n.read;

/* ============================ BRANDING =================================== */

// Organizer branding must never make the public page unreadable, so an accent
// colour is only ever used for accents (borders, chips, small text) on top of
// the app's own surfaces — and text drawn ON the accent picks black or white
// by relative luminance, so contrast holds whatever colour is chosen.
export function accentTheme(hex) {
  const fallback = { accent: "var(--color-accent-teal)", onAccent: "#04121a", isCustom: false };
  if (!/^#[0-9a-fA-F]{6}$/.test(hex || "")) return fallback;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return { accent: hex, onAccent: L > 0.45 ? "#0b1220" : "#ffffff", luminance: L, isCustom: true };
}

/* ============================ TIME HELPERS =============================== */

export function fmtTime(iso) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }); } catch { return "—"; }
}

export function fmtDuration(minutes) {
  if (minutes === null || minutes === undefined) return "—";
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/* ────────────────────── DISPLAY CASING (presentation only) ────────────────
   Organizers type names in whatever case they like — "chennai premier league",
   "CSK", "madras badminton". On most screens that is fine, but the venue
   display is a broadcast surface read from across a hall, where inconsistent
   casing is the fastest tell that separates a club spreadsheet from a
   scoreboard (audit finding F6).

   These are display transforms ONLY. They never touch stored data, so the
   organizer's own text is preserved everywhere it is edited — this just
   renders it consistently on the one screen where it matters.

   Both deliberately leave any word that already carries a capital alone. A
   blind `text-transform: capitalize` would turn "CSK" into "Csk", which is
   worse than the problem being fixed. */

const capitaliseFirstLetter = (word) => word.replace(/\p{Ll}/u, (c) => c.toUpperCase());
// A word the author already capitalised is deliberate — an acronym (CSK), a
// brand (McMahon), a model number. Leave it exactly as typed.
const authorCapitalised = (word) => /\p{Lu}/u.test(word);

// Title case, for names: "chennai premier league" -> "Chennai Premier League".
export function displayTitle(text) {
  if (!text) return text;
  return String(text).replace(/\S+/gu, (w) => (authorCapitalised(w) ? w : capitaliseFirstLetter(w)));
}

// Sentence case, for prose: "courts 3 and 4 are in 1st floor" ->
// "Courts 3 and 4 are in 1st floor". Title-casing a sentence would read as
// a headline, which an announcement is not.
export function displaySentence(text) {
  if (!text) return text;
  const s = String(text);
  const i = s.search(/\p{L}/u);
  if (i === -1) return s;
  // Only touch the first letter, and only if the author left it lowercase.
  return authorCapitalised(s.slice(i, i + 1)) ? s : s.slice(0, i) + s[i].toUpperCase() + s.slice(i + 1);
}

// "in 25 min" / "12 min ago" — the phrasing a player needs on a dashboard.
export function relativeTime(iso, now = Date.now()) {
  if (!iso) return "";
  const diff = Math.round((new Date(iso).getTime() - now) / 60000);
  const abs = Math.abs(diff);
  const unit = abs < 60 ? `${abs} min` : abs < 1440 ? `${Math.round(abs / 60)}h` : `${Math.round(abs / 1440)}d`;
  return diff >= 0 ? `in ${unit}` : `${unit} ago`;
}
