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

export const TONE_CLASSES = {
  slate: "bg-slate-100 text-slate-600 border-slate-200",
  emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
  amber: "bg-amber-50 text-amber-700 border-amber-200",
  red: "bg-red-50 text-red-700 border-red-200",
  indigo: "bg-indigo-50 text-indigo-700 border-indigo-200",
  teal: "bg-teal-50 text-teal-700 border-teal-200",
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
