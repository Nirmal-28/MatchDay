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
