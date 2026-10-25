import { describe, it, expect } from "vitest";
import { parseResult, validateResult } from "./engines";

describe("parseResult", () => {
  it("reads the ways people write a score", () => {
    expect(parseResult("21-15 21-18").games).toEqual([{ a: 21, b: 15 }, { a: 21, b: 18 }]);
    expect(parseResult("21-15, 18-21, 21-19").games).toHaveLength(3);
    expect(parseResult("21 15 21 18").games).toEqual([{ a: 21, b: 15 }, { a: 21, b: 18 }]);
    expect(parseResult("21–17").games).toEqual([{ a: 21, b: 17 }]);
  });

  it("accepts any club format", () => {
    expect(parseResult("15-11").error).toBe("");        // one game to 15
    expect(parseResult("21-19").error).toBe("");        // one game to 21
    expect(parseResult("15-10 12-15 15-13").error).toBe("");
    expect(parseResult("30-29 21-10").error).toBe("");
  });

  it("is empty, not an error, before anything is typed", () => {
    expect(parseResult("")).toEqual({ games: [], error: "" });
  });

  it("rejects impossible results", () => {
    expect(parseResult("21").error).toMatch(/two scores/);
    expect(parseResult("21-21").error).toMatch(/level/);
    expect(parseResult("31-29").error).toMatch(/30/);
    expect(parseResult("21-15 15-21").error).toMatch(/level/);
    expect(parseResult("21-10 21-10 10-21").error).toBeTruthy();
    expect(validateResult([])).toBeTruthy();
  });
});
