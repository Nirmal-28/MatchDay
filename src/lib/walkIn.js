/* Walk-in entry lists.

   Small club tournaments don't run on registration forms — players text the
   organizer on WhatsApp and the organizer keeps a running list. This turns
   that list, pasted as-is, into entries the organizer can add in one go:

     1. Rahul Sharma 98765 43210
     2. Arjun ✅ paid
     [19/10/26, 7:42 PM] Kiran: Sneha / Divya       (doubles)

   Phone numbers are optional. A row with one links the entry to that
   player's profile (same phone key as self-registration); a row without one
   is just a name on the draw. */

const NAME_MAX = 80; // entry_players_text_len_check (migration 010)

// "[19/10/26, 7:42:10 PM] Ravi: " (iOS copy) and "19/10/26, 7:42 pm - Ravi: " (Android export)
const WHATSAPP_PREFIX = /^\[?\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]\.?\s?m\.?)?\]?\s*(?:-\s*)?[^:]{1,40}:\s*/i;
const LIST_MARKER = /^(?:\d{1,3}\s*[.)\]:-]|[-*•·▪►])\s*/u;
const LEADING_EMOJI = /^[\p{Extended_Pictographic}️‍\s]+/u;
const PAID_MARK = /\(?\bpaid\b\)?/i;
// "/" "&" "|" "," " and " " with ", and "+" when it isn't the start of "+91…".
const PAIR_SPLIT = /\s*(?:\/|&|\||,|\band\b|\bwith\b|\+(?!\s*\d))\s*/i;
const PHONE = /\+?\d[\d\s-]{6,}\d/;

export function normaliseName(s) {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

export function cleanLine(raw) {
  let line = raw.replace(WHATSAPP_PREFIX, "").trim();
  line = line.replace(LIST_MARKER, "").replace(LEADING_EMOJI, "").trim();
  return line;
}

// One player's slice of a line -> { name, phone }
function parsePlayer(part) {
  const m = part.match(PHONE);
  const digits = m ? m[0].replace(/[^\d]/g, "") : "";
  const phone = digits.length >= 10 && digits.length <= 13 ? digits : null;
  const name = (phone ? part.replace(m[0], " ") : part)
    .replace(/[\p{Extended_Pictographic}️‍]/gu, " ")
    .replace(/[()[\]:;,–—-]+\s*$/u, "")
    .replace(/^\s*[()[\]:;,–—-]+/u, "")
    .replace(/\s+/g, " ")
    .trim();
  return { name, phone };
}

/* One entry's text (a player, or a doubles pair) -> { players, paid, errors, key }.
   `key` is the normalised entry name, comparable with entryName() of an
   existing entry passed through normaliseName(). */
export function parseEntryText(text, isDoubles) {
  let line = text;
  const paid = PAID_MARK.test(line);
  if (paid) line = line.replace(PAID_MARK, " ").trim();

  let parts = isDoubles ? line.split(PAIR_SPLIT).filter((p) => p.trim()) : [line];
  // "Rahul, 98765 43210 / Arjun" — a bare number belongs to the name before it.
  parts = parts.reduce((acc, p) => {
    if (!/\p{L}/u.test(p) && acc.length) acc[acc.length - 1] += ` ${p}`;
    else acc.push(p);
    return acc;
  }, []);

  const players = parts.map(parsePlayer).filter((p) => p.name || p.phone);
  const errors = [];
  if (players.length === 0 || players.some((p) => !p.name)) errors.push("Missing a name");
  if (players.some((p) => p.name.length > NAME_MAX)) errors.push(`Name longer than ${NAME_MAX} characters`);
  if (isDoubles && players.length !== 2) errors.push("Needs two names, e.g. Rahul / Arjun");

  const key = players.map((p) => normaliseName(p.name)).join(" / ");
  return { players, paid, errors, key };
}

/* Returns one row per non-blank line:
     { line, players: [{ name, phone }], paid, errors: [], duplicate: bool }
   `existingNames` is the set of normalised entry names already in the
   category, so re-pasting an updated WhatsApp list only adds the new people. */
export function parseWalkInList(text, { isDoubles = false, existingNames = [] } = {}) {
  const seen = new Set(existingNames.map(normaliseName));
  const rows = [];

  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = cleanLine(raw);
    if (!line) continue;
    if (/:\s*$/.test(line)) continue; // a heading such as "Men's singles:"

    const { players, paid, errors, key } = parseEntryText(line, isDoubles);
    const duplicate = errors.length === 0 && seen.has(key);
    if (errors.length === 0) seen.add(key);

    rows.push({ line: raw.trim(), players, paid, errors, duplicate });
  }
  return rows;
}
