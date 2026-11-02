import { describe, it, expect } from "vitest";
import { buildPlan, draftChanges } from "./assistantPlan";

const details = { name: "Sunday Doubles", venue: "Smash Arena", startDate: "2026-11-08" };
const draft = (category, tournament = details) => ({ tournament, categories: [{ category: "MS", ...category }] });
const names = (n) => Array.from({ length: n }, (_, i) => `Player ${i + 1}`);
const pairs = (plan) => plan.categories[0].drawPlan.matches.map((m) => m.sides.map((s) => (s ? s.players.map((p) => p.name).join(" / ") : "bye")));

describe("buildPlan: names only, MatchDay makes the draw", () => {
  it("runs a small field as everyone plays everyone", () => {
    const plan = buildPlan(draft({ entries: names(4) }));
    const c = plan.categories[0];
    expect(c.format).toBe("ROUND_ROBIN");
    expect(c.drawPlan.matches).toHaveLength(6);
    expect(plan.ready).toBe(true);
  });

  it("puts a larger field into groups of about four, with every player placed", () => {
    const c = buildPlan(draft({ entries: names(12) })).categories[0];
    expect(c.format).toBe("GROUP_KO");
    expect(c.groups.map((g) => g.label)).toEqual(["A", "B", "C"]);
    expect(c.groups.flatMap((g) => g.names).sort()).toEqual(names(12).sort());
  });

  it("spreads the top of the list across the groups", () => {
    const c = buildPlan(draft({ entries: names(8), format: "GROUP_KO", groupCount: 2 })).categories[0];
    expect(c.groups[0].names).toContain("Player 1");
    expect(c.groups[1].names).toContain("Player 2");
  });

  it("gives knockout byes to the top of the list, and keeps a saveable bracket", () => {
    const plan = buildPlan(draft({ entries: names(6), format: "SINGLE_ELIM" }));
    expect(plan.ready).toBe(true);
    expect(plan.categories[0].drawPlan.matches).toHaveLength(4);
    expect(pairs(plan).flat().filter((s) => s === "bye")).toHaveLength(2);
    expect(pairs(plan)).toContainEqual(["Player 1", "bye"]);
  });

  it("refuses more groups than the players can fill", () => {
    const plan = buildPlan(draft({ entries: names(4), format: "GROUP_KO", groupCount: 3 }));
    expect(plan.ready).toBe(false);
    expect(plan.problems[0]).toContain("needs at least 6");
  });

  it("refuses a round robin of two, as the Draw tab does", () => {
    expect(buildPlan(draft({ entries: names(2), format: "ROUND_ROBIN" })).ready).toBe(false);
  });
});

describe("buildPlan: the organizer's own groups and matchups", () => {
  it("keeps their groups exactly and plays everyone inside each", () => {
    const c = buildPlan(draft({ groups: [["Rahul", "Arjun", "Kiran"], ["Sneha", "Divya"]] })).categories[0];
    expect(c.format).toBe("GROUP_KO");
    expect(c.groups).toEqual([
      { label: "A", names: expect.arrayContaining(["Rahul", "Arjun", "Kiran"]) },
      { label: "B", names: expect.arrayContaining(["Sneha", "Divya"]) },
    ]);
    expect(c.drawPlan.matches).toHaveLength(4);
  });

  it("refuses a group of one, which would drop that player from the draw", () => {
    const plan = buildPlan(draft({ groups: [["Rahul", "Arjun"], ["Sneha"]] }));
    expect(plan.ready).toBe(false);
    expect(plan.problems).toContain("Men's Singles: Group B needs at least 2 entries.");
  });

  it("takes pasted matchups exactly as written", () => {
    const plan = buildPlan(draft({ format: "SINGLE_ELIM", matchups: ["Rahul vs Arjun", "Kiran vs bye"] }));
    expect(pairs(plan)).toEqual([["Rahul", "Arjun"], ["Kiran", "bye"]]);
    expect(plan.categories[0].source).toBe("matchups");
    expect(plan.ready).toBe(true);
  });

  it("warns about someone in the list who isn't in any match", () => {
    const plan = buildPlan(draft({ format: "ROUND_ROBIN", entries: ["Rahul", "Arjun", "Kiran"], matchups: ["Rahul vs Arjun"] }));
    expect(plan.warnings).toContain("Men's Singles: Kiran was in your list but isn't in any match.");
  });

  it("explains a matchup list the format can't use, and does not offer to create it", () => {
    const plan = buildPlan(draft({ format: "SINGLE_ELIM", matchups: ["A vs B", "C vs D", "E vs F"] }));
    expect(plan.ready).toBe(false);
    expect(plan.problems[0]).toContain("This list has 3");
  });
});

describe("buildPlan: what stops Create", () => {
  it("lists what's missing", () => {
    const plan = buildPlan(draft({ entries: names(4) }, { name: "Open" }));
    expect(plan.missing).toEqual(["the date", "the venue"]);
    expect(plan.ready).toBe(false);
  });

  it("does not treat an unreal date as a date", () => {
    expect(buildPlan(draft({ entries: names(4) }, { ...details, startDate: "next Sunday" })).missing).toContain("the date");
  });

  it("asks for players when there are none", () => {
    expect(buildPlan({ tournament: details, categories: [] }).missing).toContain("the players");
  });

  it("catches a player listed twice, ignoring capitals and spaces", () => {
    const plan = buildPlan(draft({ entries: ["Rahul", "Arjun", "rahul ", "Kiran"] }));
    expect(plan.problems).toContain("Men's Singles: rahul is listed twice.");
    expect(plan.ready).toBe(false);
  });

  it("names the line when a doubles entry has one player", () => {
    const plan = buildPlan({ tournament: details, categories: [{ category: "MD", entries: ["Rahul / Arjun", "Kiran", "Sneha / Divya"] }] });
    expect(plan.ready).toBe(false);
    expect(plan.problems.join()).toContain("Needs two names");
    expect(plan.problems.join()).toContain("Kiran");
  });

  it("warns when one player is in two pairs, but lets the organizer decide", () => {
    const plan = buildPlan({ tournament: details, categories: [{ category: "MD", entries: ["Rahul / Arjun", "Rahul / Kiran", "Sneha / Divya"] }] });
    expect(plan.warnings).toContain("Men's Doubles: Rahul is in 2 pairs.");
    expect(plan.ready).toBe(true);
  });

  it("refuses the same division twice, which the database would refuse", () => {
    const plan = buildPlan({ tournament: details, categories: [{ category: "MS", entries: names(3) }, { category: "MS", entries: ["X", "Y", "Z"] }] });
    expect(plan.problems).toContain("Men's Singles appears twice. Merge them into one list.");
  });

  it("allows the same category at two grades", () => {
    const plan = buildPlan({ tournament: details, categories: [{ category: "MS", skillGrade: "A", entries: names(3) }, { category: "MS", skillGrade: "B", entries: ["X", "Y", "Z"] }] });
    expect(plan.ready).toBe(true);
    expect(plan.categories[1].label).toBe("Men's Singles · Grade B");
  });

  it("ignores a category that doesn't exist rather than crashing", () => {
    expect(buildPlan({ tournament: details, categories: [{ category: "TENNIS", entries: names(3) }] }).categories).toEqual([]);
  });

  it("warns when the day can't hold the matches", () => {
    const plan = buildPlan(draft({ entries: names(64), format: "ROUND_ROBIN" }, { ...details, courts: 1 }));
    expect(plan.warnings.join()).toContain("court-hours");
  });
});

describe("buildPlan: defaults", () => {
  it("says what it assumed, and sets capacity from the real list", () => {
    const plan = buildPlan(draft({ entries: names(5) }));
    expect(plan.assumed).toEqual(["2 courts", "30 minutes a match", "a 09:00 start", "games to 21", "best of 3"]);
    expect(plan.categories[0].maxEntries).toBe(5);
    expect(plan.tournament.endDate).toBe("2026-11-08");
  });

  it("doesn't mention what the organizer already said", () => {
    const plan = buildPlan(draft({ entries: names(5) }, { ...details, courts: 4, matchDurationMins: 20, startTime: "18:30", pointsPerGame: 15, gamesPerMatch: 1 }));
    expect(plan.assumed).toEqual([]);
    expect(plan.tournament.courts).toBe(4);
  });
});

describe("draftChanges", () => {
  it("reports who a correction added or dropped", () => {
    const before = buildPlan(draft({ entries: ["Rahul", "Arjun", "Kiran"] }));
    const after = buildPlan(draft({ entries: ["Rahul", "Arjun", "Sneha"] }));
    expect(draftChanges(before, after)).toEqual({ added: ["Sneha"], removed: ["Kiran"] });
  });

  it("stays quiet when only the groups moved", () => {
    const before = buildPlan(draft({ groups: [["Rahul", "Arjun"], ["Kiran", "Sneha"]] }));
    const after = buildPlan(draft({ groups: [["Rahul", "Kiran"], ["Arjun", "Sneha"]] }));
    expect(draftChanges(before, after)).toEqual({ added: [], removed: [] });
  });
});
