// MatchDay — configurable registration fields.
//
// Pure helpers shared by the organizer's field builder and the registration
// form, so the two can never disagree about what a field means. The field
// definitions themselves live on `tournaments.registration_fields`; the
// answers live in `entry_details` (migration 012 explains why they must not
// live on `entries`).
//
// Two rules run through everything here:
//
//   1. PRIVATE is the default. A field only becomes publicly visible when the
//      organizer deliberately marks it PUBLIC, so a mistake in the builder
//      leaks nothing.
//   2. Organizers get to ask for whatever they need, but the app should not
//      make it easy to hoover up sensitive data — see SENSITIVE_HINTS.

export const FIELD_TYPES = [
  { key: "text", label: "Short text", hasOptions: false },
  { key: "textarea", label: "Long text", hasOptions: false },
  { key: "number", label: "Number", hasOptions: false },
  { key: "select", label: "Choice", hasOptions: true },
  { key: "checkbox", label: "Checkbox / agreement", hasOptions: false },
  { key: "tel", label: "Phone", hasOptions: false },
  { key: "email", label: "Email", hasOptions: false },
  { key: "date", label: "Date", hasOptions: false },
];

export const VISIBILITY = {
  PRIVATE: { key: "PRIVATE", label: "Private", hint: "Only you and your staff can see this answer." },
  PUBLIC: { key: "PUBLIC", label: "Public", hint: "Shown on the public tournament page. Never use for personal contact details." },
};

// Ready-made fields for the things organizers actually ask for, so the common
// case is one click rather than a form-building exercise.
export const FIELD_PRESETS = [
  { key: "club", label: "Club / academy", type: "text", required: false, visibility: "PUBLIC" },
  { key: "skill_level", label: "Skill level", type: "select", required: false, visibility: "PUBLIC",
    options: ["Beginner", "Intermediate", "Advanced", "Professional"] },
  { key: "age", label: "Age", type: "number", required: false, visibility: "PRIVATE" },
  { key: "gender", label: "Gender", type: "select", required: false, visibility: "PRIVATE",
    options: ["Male", "Female", "Other / prefer not to say"] },
  { key: "jersey_size", label: "Jersey size", type: "select", required: false, visibility: "PRIVATE",
    options: ["XS", "S", "M", "L", "XL", "XXL"] },
  { key: "emergency_contact", label: "Emergency contact number", type: "tel", required: true, visibility: "PRIVATE",
    help: "Someone we can call if you're hurt on court." },
  { key: "waiver", label: "I accept the tournament rules and waiver", type: "checkbox", required: true, visibility: "PRIVATE" },
];

// Fields whose answers would be genuinely damaging if published. The builder
// refuses to mark these PUBLIC rather than trusting a tired organizer at
// 1 a.m. to notice the difference.
const SENSITIVE_TYPES = ["tel", "email", "date"];
const SENSITIVE_HINTS = /emergency|phone|mobile|contact|email|birth|dob|address|aadhaar|passport|medical|allerg/i;

export function isSensitive(field) {
  return SENSITIVE_TYPES.includes(field.type) || SENSITIVE_HINTS.test(`${field.key} ${field.label}`);
}

// A key is what the answer is stored under, so it has to be stable, unique
// and safe to use as a JSON key.
export function toFieldKey(label) {
  return String(label || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "field";
}

export function uniqueFieldKey(label, existingKeys) {
  const base = toFieldKey(label);
  if (!existingKeys.includes(base)) return base;
  let i = 2;
  while (existingKeys.includes(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}

/* ------------------------------ definitions ------------------------------ */

export const MAX_FIELDS = 25;

// Validates the whole set the organizer is about to save. Returns a list of
// human-readable problems — empty means it's safe to write.
export function validateFieldDefinitions(fields) {
  const errors = [];
  if (!Array.isArray(fields)) return ["Registration fields must be a list."];
  if (fields.length > MAX_FIELDS) errors.push(`A tournament can have at most ${MAX_FIELDS} extra questions.`);

  const seen = new Set();
  fields.forEach((f, i) => {
    const where = f.label ? `"${f.label}"` : `Question ${i + 1}`;
    if (!f.key) errors.push(`${where} has no key.`);
    if (!String(f.label || "").trim()) errors.push(`Question ${i + 1} needs a label.`);
    if (String(f.label || "").length > 80) errors.push(`${where} label is too long (80 characters max).`);
    if (!FIELD_TYPES.some((t) => t.key === f.type)) errors.push(`${where} has an unknown type.`);
    if (f.key && seen.has(f.key)) errors.push(`${where} duplicates another question's key.`);
    if (f.key) seen.add(f.key);
    if (f.type === "select" && !(f.options || []).filter((o) => String(o).trim()).length) {
      errors.push(`${where} is a choice field but has no options.`);
    }
    if (f.visibility === "PUBLIC" && isSensitive(f)) {
      errors.push(`${where} looks like personal contact or identity data and cannot be made public.`);
    }
    if (!["PUBLIC", "PRIVATE"].includes(f.visibility)) {
      errors.push(`${where} has an invalid visibility.`);
    }
  });
  return errors;
}

// Normalizes anything read back from the database so the UI can rely on the
// shape even if an older row predates a property.
export function normaliseFields(fields) {
  if (!Array.isArray(fields)) return [];
  return fields
    .filter((f) => f && f.key && f.label)
    .map((f) => ({
      key: String(f.key),
      label: String(f.label),
      type: FIELD_TYPES.some((t) => t.key === f.type) ? f.type : "text",
      required: !!f.required,
      // Anything unrecognised falls back to PRIVATE — never to PUBLIC.
      visibility: f.visibility === "PUBLIC" ? "PUBLIC" : "PRIVATE",
      options: Array.isArray(f.options) ? f.options.filter((o) => String(o).trim()) : [],
      help: f.help ? String(f.help) : "",
    }))
    .slice(0, MAX_FIELDS);
}

/* -------------------------------- answers -------------------------------- */

export const blankAnswers = (fields) =>
  Object.fromEntries(normaliseFields(fields).map((f) => [f.key, f.type === "checkbox" ? false : ""]));

// Validates one registrant's answers against the definitions. Returns
// { [fieldKey]: message } so the form can mark the specific input.
export function validateAnswers(fields, answers) {
  const errors = {};
  for (const f of normaliseFields(fields)) {
    const v = answers?.[f.key];
    const empty = f.type === "checkbox" ? v !== true : !String(v ?? "").trim();

    if (f.required && empty) {
      errors[f.key] = f.type === "checkbox" ? "This must be accepted." : `${f.label} is required.`;
      continue;
    }
    if (empty) continue;

    if (f.type === "number" && !Number.isFinite(Number(v))) {
      errors[f.key] = "Enter a number.";
    }
    if (f.type === "email" && !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(String(v))) {
      errors[f.key] = "Enter a valid email address.";
    }
    if (f.type === "tel" && String(v).replace(/\D/g, "").length < 10) {
      errors[f.key] = "Enter a valid phone number.";
    }
    if (f.type === "select" && f.options.length && !f.options.includes(String(v))) {
      errors[f.key] = "Choose one of the listed options.";
    }
    if (String(v).length > 500) {
      errors[f.key] = "That answer is too long (500 characters max).";
    }
  }
  return errors;
}

// Strips anything not defined as a field before it is written, so a tampered
// form cannot smuggle extra keys into the stored JSON.
export function cleanAnswers(fields, answers) {
  const out = {};
  for (const f of normaliseFields(fields)) {
    const v = answers?.[f.key];
    if (f.type === "checkbox") {
      if (v === true) out[f.key] = true;
      continue;
    }
    const s = String(v ?? "").trim();
    if (s) out[f.key] = f.type === "number" ? Number(s) : s.slice(0, 500);
  }
  return out;
}

// The subset safe to render on a public page. Mirrors the SQL view in
// migration 012 — if these ever disagree, the SQL wins, because that is the
// one enforced against an untrusted client.
export function publicAnswers(fields, answers) {
  const publicKeys = normaliseFields(fields).filter((f) => f.visibility === "PUBLIC").map((f) => f.key);
  return Object.fromEntries(
    Object.entries(answers || {}).filter(([k]) => publicKeys.includes(k))
  );
}
