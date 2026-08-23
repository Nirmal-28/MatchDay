import { describe, it, expect } from "vitest";
import { __test } from "./monitoring";
import { __test as analyticsTest } from "./productAnalytics";

const { scrub, fingerprint } = __test;
const { safeProps } = analyticsTest;

// The whole justification for storing error reports on our own project rather
// than a third party is that we control what leaves the browser. That is only
// true if the scrubbing actually works, so it is tested rather than assumed.

describe("monitoring scrub", () => {
  it("removes email addresses", () => {
    expect(scrub("failed for player@example.com")).toBe("failed for [email]");
    expect(scrub("a.b+tag@sub.domain.co.in bad")).toBe("[email] bad");
  });

  it("removes Indian phone numbers in the formats that appear in our data", () => {
    expect(scrub("phone 9876543210 not found")).toBe("phone [phone] not found");
    expect(scrub("+919876543210")).toContain("[phone]");
    expect(scrub("+91 9876543210")).toContain("[phone]");
  });

  it("removes JWTs, which is what a Supabase error most often carries", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(scrub(`Bearer ${jwt}`)).not.toContain("eyJ");
    expect(scrub(`Bearer ${jwt}`)).toContain("[token]");
  });

  it("removes any long opaque token", () => {
    expect(scrub(`key=${"a1b2c3d4".repeat(6)}`)).toContain("[token]");
  });

  it("caps length so one error cannot write an unbounded row", () => {
    // Realistic long text: a single 10,000-character run of one letter is
    // collapsed to "[token]" by the opaque-token rule long before the length
    // cap is reached, which would make this assertion pass for the wrong
    // reason. Short words survive redaction, so they actually exercise the cap.
    const long = "failed to render match ".repeat(500);
    expect(long.length).toBeGreaterThan(4000);
    expect(scrub(long).length).toBe(4000);
  });

  it("handles null and undefined without throwing", () => {
    expect(scrub(null)).toBe("");
    expect(scrub(undefined)).toBe("");
  });

  it("leaves ordinary messages intact", () => {
    const msg = "Cannot read properties of null (reading 'games')";
    expect(scrub(msg)).toBe(msg);
  });
});

describe("monitoring fingerprint", () => {
  it("groups the same error from the same place", () => {
    const stack = "Error: x\n    at foo (https://app/assets/index.js:1:2)";
    expect(fingerprint("boom", stack)).toBe(fingerprint("boom", stack));
  });

  it("separates different messages", () => {
    const stack = "Error\n    at foo (https://app/assets/index.js:1:2)";
    expect(fingerprint("boom", stack)).not.toBe(fingerprint("bang", stack));
  });

  it("is bounded, so it cannot itself be an unbounded write", () => {
    expect(fingerprint("x".repeat(9999), "y".repeat(9999)).length).toBeLessThanOrEqual(300);
  });
});

describe("analytics safeProps", () => {
  it("keeps short scalars", () => {
    expect(safeProps({ count: 3, ok: true, kind: "knockout" }))
      .toEqual({ count: 3, ok: true, kind: "knockout" });
  });

  it("drops anything that looks like an email or a phone number", () => {
    expect(safeProps({ who: "player@example.com" })).toBeNull();
    expect(safeProps({ who: "9876543210" })).toBeNull();
  });

  it("truncates long strings rather than storing free text", () => {
    expect(safeProps({ note: "x".repeat(500) }).note.length).toBe(60);
  });

  it("drops nulls and returns null when nothing survives", () => {
    expect(safeProps({ a: null, b: undefined })).toBeNull();
    expect(safeProps(null)).toBeNull();
  });
});
