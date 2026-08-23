import { describe, it, expect } from "vitest";
import {
  validateText, validateEmail, validatePhone, validatePassword,
  validateDateRange, validateEntryFee, normalisePhone, collect, firstError, LIMITS,
} from "./validation";

// These rules are enforced in two places — the form and the database CHECK
// constraints in migration 010. If they drift apart the user gets a Postgres
// error instead of a sentence, so the limits are asserted explicitly here.

describe("validateText", () => {
  it("requires a value when required", () => {
    expect(validateText("", { label: "Name" })).toMatch(/required/i);
    expect(validateText("   ", { label: "Name" })).toMatch(/required/i);
    expect(validateText(null, { label: "Name" })).toMatch(/required/i);
  });

  it("allows blank when not required", () => {
    expect(validateText("", { required: false })).toBeNull();
  });

  it("rejects text longer than the maximum and says how long it is", () => {
    const error = validateText("x".repeat(81), { label: "Name", max: 80 });
    expect(error).toMatch(/80 characters or fewer/);
    expect(error).toMatch(/81/);
  });

  it("accepts text exactly at the maximum", () => {
    expect(validateText("x".repeat(80), { max: 80 })).toBeNull();
  });

  it("trims before measuring, so trailing spaces are not an error", () => {
    expect(validateText(`${"x".repeat(80)}   `, { max: 80 })).toBeNull();
  });
});

describe("validateEmail", () => {
  it("accepts ordinary addresses", () => {
    for (const email of ["a@b.co", "first.last+tag@sub.domain.in", "x_y@z.org"]) {
      expect(validateEmail(email)).toBeNull();
    }
  });

  it("rejects things that cannot be addresses", () => {
    for (const bad of ["notanemail", "no@domain", "@nolocal.com", "two@@at.com", "spaces in@x.com"]) {
      expect(validateEmail(bad)).not.toBeNull();
    }
  });

  it("enforces the stored length limit", () => {
    expect(validateEmail(`${"a".repeat(250)}@b.com`)).toMatch(/too long/i);
  });
});

describe("validatePhone", () => {
  it("accepts Indian mobile numbers in the formats people actually type", () => {
    for (const phone of ["9876543210", "+91 98765 43210", "091-9876543210", "(98765) 43210", "919876543210"]) {
      expect(validatePhone(phone)).toBeNull();
    }
  });

  it("rejects numbers that are the wrong length", () => {
    expect(validatePhone("98765")).toMatch(/10-digit/);
    expect(validatePhone("98765432101234")).toMatch(/10-digit/);
  });

  it("rejects Indian numbers that cannot start a mobile", () => {
    expect(validatePhone("1234567890")).toMatch(/6, 7, 8 or 9/);
    expect(validatePhone("5876543210")).toMatch(/6, 7, 8 or 9/);
  });

  it("is optional by default and required on demand", () => {
    expect(validatePhone("")).toBeNull();
    expect(validatePhone("", { required: true })).toMatch(/required/i);
  });
});

describe("normalisePhone", () => {
  it("reduces every accepted format to the same 10 digits, so lookups match", () => {
    const forms = ["9876543210", "+91 98765 43210", "091-9876543210", "(98765) 43210"];
    const normalised = forms.map(normalisePhone);
    expect(new Set(normalised).size).toBe(1);
    expect(normalised[0]).toBe("9876543210");
  });

  it("returns null for blank input rather than an empty string", () => {
    expect(normalisePhone("")).toBeNull();
    expect(normalisePhone(null)).toBeNull();
  });
});

describe("validatePassword", () => {
  it("requires at least 8 characters — Supabase's own minimum of 6 is too weak", () => {
    expect(validatePassword("short1")).toMatch(/at least 8/);
    expect(validatePassword("longenough1")).toBeNull();
  });

  it("refuses the passwords that get guessed first", () => {
    for (const bad of ["password", "PASSWORD", "12345678", "iloveyou", "matchday"]) {
      expect(validatePassword(bad)).toMatch(/too easy to guess/);
    }
  });

  it("refuses a single repeated character", () => {
    expect(validatePassword("aaaaaaaaa")).toMatch(/too easy to guess/);
  });

  it("refuses passwords past the bcrypt truncation point instead of silently cutting them", () => {
    expect(validatePassword("a1".repeat(40))).toMatch(/72 characters or fewer/);
    expect(LIMITS.password).toBe(72);
  });
});

describe("validateDateRange", () => {
  it("rejects an end before the start", () => {
    expect(validateDateRange("2026-05-10", "2026-05-01")).toMatch(/cannot be before/);
  });

  it("allows a single-day range", () => {
    expect(validateDateRange("2026-05-10", "2026-05-10")).toBeNull();
  });

  it("says nothing when either end is missing", () => {
    expect(validateDateRange("2026-05-10", "")).toBeNull();
    expect(validateDateRange("", "2026-05-10")).toBeNull();
  });
});

describe("validateEntryFee", () => {
  it("accepts zero and blank — a free tournament is normal", () => {
    expect(validateEntryFee(0)).toBeNull();
    expect(validateEntryFee("")).toBeNull();
  });

  it("rejects negatives and non-numbers", () => {
    expect(validateEntryFee(-1)).toMatch(/negative/);
    expect(validateEntryFee("abc")).toMatch(/number/);
  });

  it("flags an implausible amount rather than storing it", () => {
    expect(validateEntryFee(50_000_000)).toMatch(/check the amount/);
  });
});

describe("collect / firstError", () => {
  it("returns null when everything passes, so callers can branch on it", () => {
    expect(collect({ a: null, b: null })).toBeNull();
  });

  it("keeps only the failures", () => {
    const errors = collect({ a: null, b: "bad", c: "worse" });
    expect(errors).toEqual({ b: "bad", c: "worse" });
    expect(firstError(errors)).toBe("bad");
  });

  it("firstError on null is null", () => {
    expect(firstError(null)).toBeNull();
  });
});
