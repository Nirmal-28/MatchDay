// MatchDay — shared input validation.
//
// One place for every rule, used by BOTH the form that collects a value and
// (where it matters) the database constraint that stores it. Previously
// validation was whatever HTML5 attribute happened to be on the input, which
// meant a tournament name could be 10,000 characters, a dispute could be
// empty, and a phone number could be anything at all.
//
// These are pure functions with no React or Supabase dependency so they can
// be unit tested directly — see scripts/../src/lib/validation.test.js.
//
// A validator returns null when the value is acceptable, or a human sentence
// explaining what is wrong. It never throws.

export const LIMITS = {
  name: 80,
  tournamentName: 120,
  venue: 160,
  bio: 500,
  announcement: 1000,
  disputeReason: 1000,
  email: 254,
  password: 72,      // bcrypt truncates beyond this; refuse rather than silently cut
};

const isBlank = (v) => v == null || String(v).trim() === "";

/** Required free text with a maximum length. */
export function validateText(value, { label = "This field", max = LIMITS.name, min = 1, required = true } = {}) {
  if (isBlank(value)) return required ? `${label} is required.` : null;
  const v = String(value).trim();
  if (v.length < min) return `${label} must be at least ${min} characters.`;
  if (v.length > max) return `${label} must be ${max} characters or fewer (currently ${v.length}).`;
  return null;
}

// Deliberately permissive: the only thing worth rejecting here is a value
// that cannot possibly be an address. Real verification is the confirmation
// email, not a regex — over-strict email regexes reject valid addresses.
export function validateEmail(value, { required = true } = {}) {
  if (isBlank(value)) return required ? "Email is required." : null;
  const v = String(value).trim();
  if (v.length > LIMITS.email) return "That email address is too long.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return "Enter a valid email address, like you@example.com.";
  return null;
}

// Strip an Indian number down to its 10 significant digits.
//
// The prefixes stack in whatever order the person typed them — "091...",
// "+91 ...", "0091..." are all real things people write on a registration
// form — so this peels them off in a loop rather than assuming one fixed
// order. (A single ordered pass got "091-9876543210" wrong: removing "+91"
// first does not match, and removing the leading 0 then leaves "91…" behind.)
function digitsOf(value) {
  let digits = String(value).replace(/\D/g, "");
  let previous;
  do {
    previous = digits;
    if (digits.length > 10 && digits.startsWith("0")) digits = digits.slice(1);
    if (digits.length > 10 && digits.startsWith("91")) digits = digits.slice(2);
  } while (digits !== previous);
  return digits;
}

// Indian mobile numbers, with or without +91 / 0 prefixes and any spacing.
// Optional by default because an organizer can enter a player without one.
export function validatePhone(value, { required = false } = {}) {
  if (isBlank(value)) return required ? "Phone number is required." : null;
  const digits = digitsOf(value);
  if (!/^\d{10}$/.test(digits)) return "Enter a 10-digit mobile number.";
  if (!/^[6-9]/.test(digits)) return "Indian mobile numbers start with 6, 7, 8 or 9.";
  return null;
}

/** Normalised to exactly what should be stored, so lookups match reliably. */
export function normalisePhone(value) {
  if (isBlank(value)) return null;
  const digits = digitsOf(value);
  return /^\d{10}$/.test(digits) ? digits : String(value).trim();
}

// Supabase's own minimum is 6, which is too weak to be worth enforcing as the
// product rule. This asks for 8 and refuses the handful of passwords that are
// guessed first. Real breach checking is Supabase's HaveIBeenPwned option —
// see supabase-integration/README.md; this is the client-side floor beneath it.
const COMMON_PASSWORDS = new Set([
  "password", "password1", "password123", "12345678", "123456789", "1234567890",
  "qwerty123", "abc12345", "iloveyou", "admin123", "welcome1", "letmein1",
  "matchday", "badminton",
]);

export function validatePassword(value) {
  if (isBlank(value)) return "Password is required.";
  const v = String(value);
  if (v.length < 8) return "Password must be at least 8 characters.";
  if (v.length > LIMITS.password) return "Password must be 72 characters or fewer.";
  if (COMMON_PASSWORDS.has(v.toLowerCase())) return "That password is too easy to guess. Choose something else.";
  if (/^(.)\1+$/.test(v)) return "That password is too easy to guess. Choose something else.";
  return null;
}

/** A tournament's registration window must be coherent before it is saved. */
export function validateDateRange(startISO, endISO, { label = "End date" } = {}) {
  if (isBlank(startISO) || isBlank(endISO)) return null;
  if (new Date(endISO) < new Date(startISO)) return `${label} cannot be before the start date.`;
  return null;
}

export function validateEntryFee(value) {
  if (isBlank(value)) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return "Entry fee must be a number.";
  if (n < 0) return "Entry fee cannot be negative.";
  if (n > 1000000) return "Entry fee looks wrong — check the amount.";
  return null;
}

/**
 * Run a map of { field: errorOrNull } and return only the failures.
 * Returns null when everything passed, so callers can write:
 *   const errors = collect({...}); if (errors) { setErrors(errors); return; }
 */
export function collect(checks) {
  const errors = {};
  for (const [field, error] of Object.entries(checks)) if (error) errors[field] = error;
  return Object.keys(errors).length ? errors : null;
}

/** First error in a collected map, for forms that show a single message. */
export function firstError(errors) {
  return errors ? Object.values(errors)[0] : null;
}
