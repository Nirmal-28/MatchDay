/* The chat box's draft -> a plan the organizer can see and confirm.

   Claude reads the messy input; it does not decide the draw. Whatever it
   returns ends here as a list of matchups, which go through the same
   parseMatchups/planCustomDraw checks as a hand-pasted draw. The groups and
   matches in the preview ARE the plan createCustomDraw() saves, so what the
   organizer confirms is what gets created.

   Three ways a category can arrive, depending on how far the organizer got:
     - names only     -> MatchDay makes the draw (same engines as the Draw tab)
     - their groups   -> their groups, everyone plays everyone inside each
     - their matchups -> taken exactly as written */

import {
  CATEGORY_META, FORMAT_META, AGE_GROUPS, SKILL_GRADES,
  roundRobinRounds, snakeIntoGroups, groupLetter, bracketSeedOrder, nextPow2,
} from "./engines";
import { parseMatchups, planCustomDraw } from "./matchups";
import { normaliseName } from "./walkIn";
import { estimateTournament } from "./intelligence";

const DEFAULTS = { courts: 2, matchDurationMins: 30, startTime: "09:00", pointsPerGame: 21, gamesPerMatch: 3 };
// The day runs to 9pm, later for the evening sessions clubs often play.
const endTimeFor = (startTime) => (startTime >= "17:00" ? "23:00" : "21:00");

const cleanList = (list) => (Array.isArray(list) ? list.map((s) => String(s ?? "").trim()).filter(Boolean) : []);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "") && !Number.isNaN(new Date(`${s}T00:00:00`).getTime());
const positive = (n) => (Number.isInteger(n) && n > 0 ? n : null);
const sideName = (side) => side.players.map((p) => p.name).join(" / ");

// When the organizer didn't choose: everyone plays everyone in a small field,
// groups of about four in a larger one.
function suggestFormat(n) {
  if (n <= 2) return "SINGLE_ELIM";
  return n <= 6 ? "ROUND_ROBIN" : "GROUP_KO";
}

function roundLines(names) {
  return roundRobinRounds(names).flatMap((pairs, r) => [`Round ${r + 1}`, ...pairs.map(([a, b]) => `${a} vs ${b}`)]);
}

const groupLines = (groups) => groups.flatMap((names, i) => [`Group ${groupLetter(i)}`, ...roundLines(names)]);

// First-round slots in seed order, so byes fall to the top of the list.
function knockoutLines(names) {
  const slots = bracketSeedOrder(nextPow2(names.length)).map((seed) => names[seed - 1] ?? "bye");
  const lines = [];
  for (let i = 0; i < slots.length; i += 2) lines.push(`${slots[i]} vs ${slots[i + 1]}`);
  return lines;
}

function resolveDraw(raw, entries, groups, pasted) {
  const format = FORMAT_META[raw.format] ? raw.format : null;
  const askedGroups = positive(raw.groupCount);

  if (pasted.length) {
    const hasGroups = pasted.some((l) => /^\W*(?:group|pool)\b/i.test(l));
    return { source: "matchups", format: format || (hasGroups ? "GROUP_KO" : "ROUND_ROBIN"), lines: pasted };
  }
  if (groups.length) {
    return { source: "groups", format: "GROUP_KO", groupCount: groups.length, lines: groupLines(groups) };
  }

  const chosen = format || suggestFormat(entries.length);
  if (chosen === "GROUP_KO") {
    const groupCount = Math.max(2, askedGroups || Math.round(entries.length / 4));
    return { source: "names", format: chosen, groupCount, lines: groupLines(snakeIntoGroups(entries, groupCount)) };
  }
  if (chosen === "ROUND_ROBIN") return { source: "names", format: chosen, lines: roundLines(entries) };
  return { source: "names", format: chosen, lines: knockoutLines(entries) };
}

function tooFew(draw, count) {
  if (draw.source !== "names") return null;
  const needed = draw.format === "GROUP_KO" ? draw.groupCount * 2 : draw.format === "ROUND_ROBIN" ? 3 : 2;
  return count < needed ? `needs at least ${needed} entries for ${FORMAT_META[draw.format].label.toLowerCase()}, and has ${count}` : null;
}

// Who is in each group, read back out of the matches.
function groupsOf(matches) {
  const groups = new Map();
  matches.forEach((m) => {
    if (!m.group) return;
    if (!groups.has(m.group)) groups.set(m.group, new Set());
    m.sides.filter(Boolean).forEach((s) => groups.get(m.group).add(sideName(s)));
  });
  return [...groups].map(([label, names]) => ({ label, names: [...names] }));
}

function planCategory(raw) {
  const meta = CATEGORY_META[raw.category];
  if (!meta) return null;

  const entries = cleanList(raw.entries);
  const groups = (Array.isArray(raw.groups) ? raw.groups : []).map(cleanList).filter((g) => g.length);
  const pasted = cleanList(raw.matchups);
  const isDoubles = meta.kind === "DOUBLES";
  const ageGroup = AGE_GROUPS.includes(raw.ageGroup) ? raw.ageGroup : "OPEN";
  const skillGrade = SKILL_GRADES.includes(raw.skillGrade) ? raw.skillGrade : null;
  const label = [meta.label, ageGroup !== "OPEN" && ageGroup, skillGrade && `Grade ${skillGrade}`].filter(Boolean).join(" · ");

  const problems = [];
  const warnings = [];

  const listed = groups.length ? groups.flat() : entries;
  const seen = new Set();
  listed.forEach((name) => {
    const key = normaliseName(name);
    if (seen.has(key)) problems.push(`${label}: ${name} is listed twice.`);
    seen.add(key);
  });
  groups.forEach((g, i) => {
    if (g.length < 2) problems.push(`${label}: Group ${groupLetter(i)} needs at least 2 entries.`);
  });

  const draw = resolveDraw(raw, entries, groups, pasted);
  const plan = planCustomDraw(parseMatchups(draw.lines.join("\n"), { isDoubles }), { format: draw.format, existing: [] });

  const short = tooFew(draw, entries.length);
  if (short) {
    problems.push(`${label} ${short}.`);
  } else {
    plan.problems.filter((p) => !p.startsWith("Fix the lines")).forEach((p) => problems.push(`${label}: ${p}`));
    plan.matches.forEach((m) => m.errors.forEach((e) => problems.push(`${label}: "${m.line}": ${e}`)));
  }

  const players = plan.newSides.map(sideName);

  if (draw.source === "matchups" && entries.length) {
    const inDraw = new Set(players.map(normaliseName));
    entries.filter((name) => !inDraw.has(normaliseName(name))).forEach((name) => {
      warnings.push(`${label}: ${name} was in your list but isn't in any match.`);
    });
  }

  if (isDoubles) {
    const pairsOf = {};
    plan.newSides.forEach((s) => s.players.forEach((p) => {
      const key = normaliseName(p.name);
      pairsOf[key] = { name: p.name, count: (pairsOf[key]?.count || 0) + 1 };
    }));
    Object.values(pairsOf).filter((p) => p.count > 1).forEach((p) => warnings.push(`${label}: ${p.name} is in ${p.count} pairs.`));
  }

  const groupList = groupsOf(plan.matches);
  return {
    category: raw.category, label, ageGroup, skillGrade, isDoubles,
    format: draw.format, source: draw.source,
    groupCount: draw.format === "GROUP_KO" ? groupList.length || draw.groupCount || 2 : null,
    advancePerGroup: Math.min(positive(raw.advancePerGroup) || 2, 4),
    feeINR: Number(raw.feeINR) > 0 ? Number(raw.feeINR) : 0,
    maxEntries: Math.max(players.length, 2),
    players, groups: groupList, drawPlan: plan, problems, warnings,
  };
}

/* draft (from api/assistant.js) ->
   { tournament, categories, missing, problems, warnings, assumed, estimate, ready }
   `ready` = nothing is stopping "Create tournament". */
export function buildPlan(draft, { today } = {}) {
  const t = draft?.tournament || {};
  const missing = [];
  const assumed = [];
  const warnings = [];
  const problems = [];

  const startDate = isDate(t.startDate) ? t.startDate : null;
  const endDate = isDate(t.endDate) ? t.endDate : startDate;
  if (!t.name?.trim()) missing.push("a tournament name");
  if (!startDate) missing.push("the date");
  if (!t.venue?.trim()) missing.push("the venue");
  if (startDate && endDate < startDate) problems.push("The end date is before the start date.");
  if (startDate && today && startDate < today) warnings.push("The date is in the past. Check it's right.");

  const withDefault = (value, fallback, describe) => {
    if (value != null) return value;
    assumed.push(describe(fallback));
    return fallback;
  };
  const courts = withDefault(positive(t.courts), DEFAULTS.courts, (v) => `${v} courts`);
  const matchDurationMins = withDefault(positive(t.matchDurationMins), DEFAULTS.matchDurationMins, (v) => `${v} minutes a match`);
  const startTime = withDefault(/^\d{2}:\d{2}$/.test(t.startTime || "") ? t.startTime : null, DEFAULTS.startTime, (v) => `a ${v} start`);
  const pointsPerGame = withDefault([15, 21].includes(t.pointsPerGame) ? t.pointsPerGame : null, DEFAULTS.pointsPerGame, (v) => `games to ${v}`);
  const gamesPerMatch = withDefault([1, 3].includes(t.gamesPerMatch) ? t.gamesPerMatch : null, DEFAULTS.gamesPerMatch, (v) => `best of ${v}`);

  const categories = (Array.isArray(draft?.categories) ? draft.categories : []).map(planCategory).filter(Boolean);
  if (categories.length === 0 || categories.every((c) => c.players.length === 0)) missing.push("the players");

  const divisions = new Set();
  categories.forEach((c) => {
    const key = `${c.category}|${c.ageGroup}|${c.skillGrade ?? ""}`;
    if (divisions.has(key)) problems.push(`${c.label} appears twice. Merge them into one list.`);
    divisions.add(key);
    problems.push(...c.problems);
    warnings.push(...c.warnings);
  });

  const days = startDate && endDate >= startDate
    ? Math.round((new Date(`${endDate}T00:00:00`) - new Date(`${startDate}T00:00:00`)) / 86400000) + 1
    : 1;
  const estimate = categories.length
    ? estimateTournament({ categories, courtsCount: courts, matchDurationMins, bufferMins: 10, startTime, endTime: endTimeFor(startTime), days })
    : null;
  if (estimate && categories.every((c) => c.players.length > 0)) warnings.push(...estimate.warnings);

  return {
    tournament: {
      name: t.name?.trim() || "", venue: t.venue?.trim() || "", location: t.location?.trim() || "",
      startDate, endDate, courts, matchDurationMins, startTime, endTime: endTimeFor(startTime), pointsPerGame, gamesPerMatch,
    },
    categories, missing, problems, warnings, assumed, estimate,
    ready: missing.length === 0 && problems.length === 0,
  };
}

/* Who a new draft added or dropped compared with the last one. Claude returns
   the whole draft on every turn, so a correction could quietly lose someone;
   this says so in the chat without having to trust the reply. */
export function draftChanges(before, after) {
  const names = (plan) => new Map(plan.categories.flatMap((c) => c.players).map((n) => [normaliseName(n), n]));
  const was = names(before);
  const now = names(after);
  return {
    added: [...now].filter(([k]) => !was.has(k)).map(([, n]) => n),
    removed: [...was].filter(([k]) => !now.has(k)).map(([, n]) => n),
  };
}
