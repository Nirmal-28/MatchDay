/* Matchups the organizer already made elsewhere — typically by pasting the
   WhatsApp list into ChatGPT — entered as the draw instead of letting
   MatchDay generate one. Accepts what that output usually looks like:

     **Round 1**
     Match 1: Rahul vs Arjun
     Match 2: Kiran vs bye
     Semifinal: Winner of Match 1 vs Winner of Match 2     <- skipped

     Group A
     Sneha / Divya vs Priya / Meera                          (doubles)

   Names are matched to entries already in the category; anything else is
   added as a new walk-in entry when the draw is created. */

import { cleanLine, parseEntryText, normaliseName } from "./walkIn";

const VS = /\s+(?:vs\.?|v\/s|v\.?|versus)\s+/i;
const MATCH_PREFIX = /^(?:match|game|m)\s*#?\s*\d+\s*[:.)-]?\s*/i;
const BYE = /^(?:a\s+)?bye\.?$/i;
const TRAILING_BYE = /^(.+?)\s*(?:[-–—:(]\s*|\s+(?:gets\s+a\s+|has\s+a\s+)?)bye\)?\.?$/i;
// Later-round slots ("Winner of Match 1", "W1", "TBD") fill in from results.
const PLACEHOLDER = /\b(?:winner|loser|tbd|tba)\b|^w\d+$/i;
// "Rahul (Court 2, 7:00 PM)" / "Rahul - Court 2" — scheduling notes, not names.
const SIDE_NOTE = /\s*(?:\([^)]*\)|[-–—|@]\s*(?:court|time|\d{1,2}[:.]\d{2}).*)\s*$/i;

const isPow2 = (n) => n > 0 && (n & (n - 1)) === 0;

function parseSide(text, isDoubles) {
  const t = text.replace(SIDE_NOTE, "").trim();
  if (BYE.test(t)) return null;
  return parseEntryText(t, isDoubles);
}

/* -> [{ line, round, group, sides: [side|null, side|null], errors: [] }]
   side = { players, key } ; null = a bye. Headings set round/group for the
   lines below them; lines that are neither a match nor a heading are ignored. */
export function parseMatchups(text, { isDoubles = false } = {}) {
  let round = 1, group = null;
  const matches = [];

  for (const raw of String(text || "").split(/\r?\n/)) {
    let line = cleanLine(raw.replace(/\*\*|__|`|#+/g, "")).replace(MATCH_PREFIX, "").trim();
    if (!line) continue;

    let parts = line.split(VS);
    if (parts.length !== 2) {
      const bye = line.match(TRAILING_BYE);
      if (bye && !/^(?:round|group)\b/i.test(line)) parts = [bye[1], "bye"];
      else {
        const g = line.match(/\b(?:group|pool)\s+([a-z0-9]{1,3})\b/i);
        const r = line.match(/\bround\s+(\d{1,2})\b/i);
        if (g) group = g[1].toUpperCase();
        if (r) round = Number(r[1]);
        continue;
      }
    }
    if (parts.some((p) => PLACEHOLDER.test(p.trim()))) continue;

    const sides = parts.map((p) => parseSide(p, isDoubles));
    const errors = [...new Set(sides.flatMap((s) => s?.errors ?? []))];
    if (!sides[0] && !sides[1]) errors.push("Both sides are byes");
    if (sides[0] && sides[1] && sides[0].key === sides[1].key) errors.push("Same name on both sides");

    matches.push({ line: raw.trim(), round, group, sides, errors });
  }
  return matches;
}

/* Checks the parsed matches against the chosen format and the category.
   existing: [{ id, name }] of entries holding a place (pending or confirmed).
   -> { matches (with per-row errors added), problems: [string],
        newSides: [side], unused: [name], entryIdByKey } */
export function planCustomDraw(parsed, { format, existing = [] }) {
  const problems = [];
  const entryIdByKey = {};
  existing.forEach((e) => { entryIdByKey[normaliseName(e.name)] = e.id; });

  let matches = parsed.map((m) => ({ ...m, errors: [...m.errors] }));

  if (format === "SINGLE_ELIM") {
    // Only the first round is entered; later rounds are built from it.
    const first = Math.min(...matches.map((m) => m.round));
    matches.filter((m) => m.round !== first).forEach((m) => m.errors.push("Only first-round matches can be entered"));
    const n = matches.filter((m) => m.round === first).length;
    if (n > 0 && !isPow2(n)) {
      problems.push(`A knockout needs 1, 2, 4, 8, 16 or 32 first-round matches (a bye counts as a match). This list has ${n}.`);
    }
    const seen = new Set();
    matches.forEach((m) => m.sides.forEach((s) => {
      if (!s || s.errors.length) return;
      if (seen.has(s.key)) m.errors.push(`${s.players.map((p) => p.name).join(" / ")} is in more than one match`);
      seen.add(s.key);
    }));
  } else {
    matches.filter((m) => m.sides.includes(null)).forEach((m) => m.errors.push("Byes aren't used here, just leave the match out"));
  }

  if (format === "GROUP_KO") {
    if (matches.some((m) => !m.group)) problems.push("Put the matches under headings like \"Group A\" and \"Group B\".");
    const groupOf = {};
    matches.forEach((m) => m.sides.forEach((s) => {
      if (!s || s.errors.length || !m.group) return;
      if (groupOf[s.key] && groupOf[s.key] !== m.group) m.errors.push(`${s.players.map((p) => p.name).join(" / ")} is in two groups`);
      groupOf[s.key] = m.group;
    }));
  }

  if (matches.length === 0) problems.push("No matches found. Write each one as \"Name vs Name\".");
  if (matches.some((m) => m.errors.length)) problems.push("Fix the lines marked in red.");

  const used = new Set();
  const newSides = [];
  matches.forEach((m) => m.sides.forEach((s) => {
    if (!s || s.errors.length || used.has(s.key)) return;
    used.add(s.key);
    if (!(s.key in entryIdByKey)) newSides.push(s);
  }));
  const unused = existing.filter((e) => !used.has(normaliseName(e.name))).map((e) => e.name);

  return { matches, problems, newSides, unused, entryIdByKey };
}
