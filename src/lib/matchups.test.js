import { describe, it, expect } from "vitest";
import { parseMatchups, planCustomDraw } from "./matchups";

const sideNames = (m) => m.sides.map((s) => (s ? s.players.map((p) => p.name).join(" / ") : "BYE"));

const GPT_KNOCKOUT = `Here is the draw:

**Round 1**
Match 1: Rahul vs Arjun
Match 2: Kiran Kumar vs. Sneha (Court 2, 7:00 PM)
Match 3: Divya v Priya
Match 4: Meera – bye

**Semifinals**
Match 5: Winner of Match 1 vs Winner of Match 2
Match 6: Winner of Match 3 vs Meera`;

describe("parseMatchups", () => {
  it("reads typical ChatGPT knockout output and skips later-round placeholders", () => {
    const m = parseMatchups(GPT_KNOCKOUT);
    expect(m.map(sideNames)).toEqual([
      ["Rahul", "Arjun"], ["Kiran Kumar", "Sneha"], ["Divya", "Priya"], ["Meera", "BYE"],
    ]);
    expect(m.every((x) => x.round === 1 && x.errors.length === 0)).toBe(true);
  });

  it("reads doubles pairs and group headings", () => {
    const m = parseMatchups("Group A\n1. Rahul / Arjun vs Kiran & Ravi\nGroup B:\nSneha and Divya vs Priya / Meera", { isDoubles: true });
    expect(m.map(sideNames)).toEqual([["Rahul / Arjun", "Kiran / Ravi"], ["Sneha / Divya", "Priya / Meera"]]);
    expect(m.map((x) => x.group)).toEqual(["A", "B"]);
  });

  it("tracks round headings", () => {
    const m = parseMatchups("Round 1\nA vs B\nRound 2\nA vs C");
    expect(m.map((x) => x.round)).toEqual([1, 2]);
  });

  it("flags a doubles side with one name", () => {
    const [m] = parseMatchups("Rahul vs Kiran / Ravi", { isDoubles: true });
    expect(m.errors).toContain("Needs two names, e.g. Rahul / Arjun");
  });
});

describe("planCustomDraw", () => {
  const existing = [{ id: "e1", name: "Rahul" }, { id: "e2", name: "Arjun" }, { id: "e9", name: "Vikram" }];

  it("matches existing entries, lists new ones and unused ones", () => {
    const plan = planCustomDraw(parseMatchups(GPT_KNOCKOUT), { format: "SINGLE_ELIM", existing });
    expect(plan.problems).toEqual([]);
    expect(plan.newSides.map((s) => s.key)).toEqual(["kiran kumar", "sneha", "divya", "priya", "meera"]);
    expect(plan.unused).toEqual(["Vikram"]);
    expect(plan.entryIdByKey.rahul).toBe("e1");
  });

  it("needs a power-of-two first round for a knockout", () => {
    const plan = planCustomDraw(parseMatchups("A vs B\nC vs D\nE vs F"), { format: "SINGLE_ELIM" });
    expect(plan.problems[0]).toMatch(/This list has 3/);
  });

  it("rejects a player in two knockout matches", () => {
    const plan = planCustomDraw(parseMatchups("A vs B\nA vs C"), { format: "SINGLE_ELIM" });
    expect(plan.matches[1].errors[0]).toMatch(/more than one match/);
  });

  it("allows repeats in a round robin but not byes", () => {
    const plan = planCustomDraw(parseMatchups("A vs B\nA vs C\nB vs C\nD - bye"), { format: "ROUND_ROBIN" });
    expect(plan.matches.slice(0, 3).every((m) => m.errors.length === 0)).toBe(true);
    expect(plan.matches[3].errors[0]).toMatch(/Byes/);
  });

  it("requires group headings for groups + knockout", () => {
    const plan = planCustomDraw(parseMatchups("A vs B"), { format: "GROUP_KO" });
    expect(plan.problems[0]).toMatch(/Group A/);
  });
});
