import { describe, it, expect } from "vitest";
import {
  toFieldKey, uniqueFieldKey, validateFieldDefinitions, normaliseFields,
  validateAnswers, cleanAnswers, publicAnswers, isSensitive, blankAnswers,
} from "./registrationFields";

const field = (over = {}) => ({
  key: "club", label: "Club", type: "text", required: false, visibility: "PRIVATE", options: [], help: "", ...over,
});

describe("field keys", () => {
  it("turns a label into a safe JSON key", () => {
    expect(toFieldKey("Jersey Size")).toBe("jersey_size");
    expect(toFieldKey("  T-shirt / size!  ")).toBe("t_shirt_size");
  });

  it("never produces an empty key", () => {
    expect(toFieldKey("!!!")).toBe("field");
    expect(toFieldKey("")).toBe("field");
  });

  it("de-duplicates against keys already in use", () => {
    expect(uniqueFieldKey("Club", ["club"])).toBe("club_2");
    expect(uniqueFieldKey("Club", ["club", "club_2"])).toBe("club_3");
  });
});

describe("validateFieldDefinitions", () => {
  it("accepts a well-formed set", () => {
    expect(validateFieldDefinitions([field(), field({ key: "size", label: "Size", type: "select", options: ["S", "M"] })])).toEqual([]);
  });

  it("rejects a choice field with no options", () => {
    const errs = validateFieldDefinitions([field({ type: "select", options: [] })]);
    expect(errs.some((e) => /no options/i.test(e))).toBe(true);
  });

  it("rejects duplicate keys", () => {
    const errs = validateFieldDefinitions([field(), field()]);
    expect(errs.some((e) => /duplicate/i.test(e))).toBe(true);
  });

  it("refuses to let contact details be made public", () => {
    const errs = validateFieldDefinitions([
      field({ key: "emergency_contact", label: "Emergency contact", type: "tel", visibility: "PUBLIC" }),
    ]);
    expect(errs.some((e) => /cannot be made public/i.test(e))).toBe(true);
  });

  it("catches a sensitive field even when its type looks harmless", () => {
    // Type is plain text, but the label gives away what it collects.
    const errs = validateFieldDefinitions([
      field({ key: "medical_notes", label: "Medical conditions", type: "text", visibility: "PUBLIC" }),
    ]);
    expect(errs.some((e) => /cannot be made public/i.test(e))).toBe(true);
  });

  it("allows genuinely public information to be public", () => {
    expect(validateFieldDefinitions([field({ key: "club", label: "Club", visibility: "PUBLIC" })])).toEqual([]);
  });

  it("caps the number of questions", () => {
    const many = Array.from({ length: 30 }, (_, i) => field({ key: `f${i}`, label: `F${i}` }));
    expect(validateFieldDefinitions(many).some((e) => /at most/i.test(e))).toBe(true);
  });
});

describe("isSensitive", () => {
  it("flags contact and identity data", () => {
    expect(isSensitive(field({ type: "tel" }))).toBe(true);
    expect(isSensitive(field({ type: "email" }))).toBe(true);
    expect(isSensitive(field({ label: "Date of birth" }))).toBe(true);
    expect(isSensitive(field({ label: "Home address" }))).toBe(true);
  });

  it("does not flag ordinary tournament data", () => {
    expect(isSensitive(field({ label: "Club" }))).toBe(false);
    expect(isSensitive(field({ label: "Jersey size" }))).toBe(false);
  });
});

describe("normaliseFields", () => {
  it("defaults unknown visibility to PRIVATE, never PUBLIC", () => {
    expect(normaliseFields([{ key: "a", label: "A", visibility: "SOMETHING" }])[0].visibility).toBe("PRIVATE");
    expect(normaliseFields([{ key: "a", label: "A" }])[0].visibility).toBe("PRIVATE");
  });

  it("drops malformed entries instead of rendering blanks", () => {
    expect(normaliseFields([{ label: "no key" }, { key: "no_label" }, null])).toEqual([]);
  });

  it("falls back to text for an unknown type", () => {
    expect(normaliseFields([{ key: "a", label: "A", type: "nonsense" }])[0].type).toBe("text");
  });

  it("survives a non-array", () => {
    expect(normaliseFields(null)).toEqual([]);
    expect(normaliseFields("nope")).toEqual([]);
  });
});

describe("validateAnswers", () => {
  const fields = [
    field({ key: "club", label: "Club", required: true }),
    field({ key: "age", label: "Age", type: "number" }),
    field({ key: "waiver", label: "Waiver", type: "checkbox", required: true }),
    field({ key: "size", label: "Size", type: "select", options: ["S", "M"] }),
  ];

  it("requires what is marked required", () => {
    const errs = validateAnswers(fields, { club: "", waiver: false });
    expect(errs.club).toMatch(/required/i);
    expect(errs.waiver).toMatch(/accepted/i);
  });

  it("passes a complete set", () => {
    expect(validateAnswers(fields, { club: "Smash", age: "24", waiver: true, size: "M" })).toEqual({});
  });

  it("rejects a non-numeric number", () => {
    expect(validateAnswers(fields, { club: "x", waiver: true, age: "old" }).age).toMatch(/number/i);
  });

  it("rejects an option that is not on the list", () => {
    expect(validateAnswers(fields, { club: "x", waiver: true, size: "XXXL" }).size).toMatch(/listed options/i);
  });

  it("ignores optional fields left blank", () => {
    expect(validateAnswers(fields, { club: "x", waiver: true })).toEqual({});
  });
});

describe("cleanAnswers", () => {
  const fields = [field({ key: "club", label: "Club" }), field({ key: "waiver", label: "W", type: "checkbox" })];

  it("drops keys that are not defined fields", () => {
    const out = cleanAnswers(fields, { club: "Smash", is_admin: true, injected: "x" });
    expect(out).toEqual({ club: "Smash" });
  });

  it("omits blanks rather than storing empty strings", () => {
    expect(cleanAnswers(fields, { club: "   " })).toEqual({});
  });

  it("stores an accepted checkbox as true and omits an unchecked one", () => {
    expect(cleanAnswers(fields, { waiver: true })).toEqual({ waiver: true });
    expect(cleanAnswers(fields, { waiver: false })).toEqual({});
  });

  it("coerces numbers so they store as numbers", () => {
    expect(cleanAnswers([field({ key: "age", label: "Age", type: "number" })], { age: "24" })).toEqual({ age: 24 });
  });

  it("truncates an over-long answer instead of rejecting the registration", () => {
    const out = cleanAnswers(fields, { club: "x".repeat(900) });
    expect(out.club).toHaveLength(500);
  });
});

describe("publicAnswers", () => {
  it("exposes only fields marked public", () => {
    const fields = [
      field({ key: "club", label: "Club", visibility: "PUBLIC" }),
      field({ key: "emergency_contact", label: "Emergency", type: "tel", visibility: "PRIVATE" }),
    ];
    expect(publicAnswers(fields, { club: "Smash", emergency_contact: "9876543210" })).toEqual({ club: "Smash" });
  });

  it("returns nothing when no field is public", () => {
    expect(publicAnswers([field()], { club: "Smash" })).toEqual({});
  });
});

describe("blankAnswers", () => {
  it("starts checkboxes false and everything else empty", () => {
    const out = blankAnswers([field({ key: "club", label: "C" }), field({ key: "w", label: "W", type: "checkbox" })]);
    expect(out).toEqual({ club: "", w: false });
  });
});
