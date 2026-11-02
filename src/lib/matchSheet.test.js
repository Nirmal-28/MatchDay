import { describe, it, expect } from "vitest";
import { buildMatchSheet } from "./matchSheet";

const entry = (id, name) => ({ id, entry_players: [{ name }] });
const match = (over) => ({
  id: over.id, match_number: 1, round: 1, entry_a: null, entry_b: null, is_bye: false,
  status: "PENDING", group_label: null, games: [], ...over,
});
const tournament = { name: "Sunday Open", venue: "Smash Arena", start_date: "2026-11-08", end_date: "2026-11-08", settings: {} };

function sheetFor(event, entries, matches, settings = {}) {
  return buildMatchSheet({
    tournament: { ...tournament, settings },
    events: [{ id: "ev", category: "MS", ...event }],
    entriesByEvent: { ev: entries },
    matchesByEvent: { ev: matches },
  });
}

const groupEntries = [entry("a", "Rahul"), entry("b", "Arjun"), entry("c", "Kiran"), entry("d", "Sneha")];
const groupMatches = [
  match({ id: "m1", match_number: 1, group_label: "A", entry_a: "a", entry_b: "b" }),
  match({ id: "m2", match_number: 2, group_label: "B", entry_a: "c", entry_b: "d" }),
];

describe("buildMatchSheet", () => {
  it("gives each group its players and matches", () => {
    const [category] = sheetFor({ format: "GROUP_KO", group_count: 2, advance_per_group: 2 }, groupEntries, groupMatches).categories;
    expect(category.label).toBe("Men's Singles");
    expect(category.sections.map((s) => s.title)).toEqual(["Group A", "Group B"]);
    expect(category.sections[0].players).toEqual(["Rahul", "Arjun"]);
    expect(category.sections[0].matches[0]).toMatchObject({ a: "Rahul", b: "Arjun" });
  });

  it("leaves lines for the knockout that's drawn after the groups", () => {
    const [category] = sheetFor({ format: "GROUP_KO", group_count: 2, advance_per_group: 2 }, groupEntries, groupMatches).categories;
    expect(category.knockoutToCome).toEqual({ note: "Top 2 from each group go through.", rows: 3 });
  });

  it("drops those lines once the knockout exists", () => {
    const ko = match({ id: "k1", match_number: 3, round: 1, entry_a: "a", entry_b: "c" });
    const [category] = sheetFor({ format: "GROUP_KO", group_count: 2, total_rounds: 1 }, groupEntries, [...groupMatches, ko]).categories;
    expect(category.knockoutToCome).toBeNull();
    expect(category.sections.at(-1).title).toBe("Final");
  });

  it("titles a round robin plainly", () => {
    const rr = match({ id: "m1", group_label: "RR", entry_a: "a", entry_b: "b" });
    const [category] = sheetFor({ format: "ROUND_ROBIN" }, groupEntries, [rr]).categories;
    expect(category.sections[0].title).toBe("Everyone plays everyone");
  });

  it("leaves byes off, and says whose winner fills a later round", () => {
    const final = match({ id: "f", match_number: 4, round: 2, entry_a: "a" });
    const matches = [
      match({ id: "s1", match_number: 1, entry_a: "a", is_bye: true, status: "WALKOVER", next_match_id: "f", next_slot: "A" }),
      match({ id: "s2", match_number: 2, entry_a: "b", entry_b: "c", next_match_id: "f", next_slot: "B" }),
      final,
    ];
    const [category] = sheetFor({ format: "SINGLE_ELIM", total_rounds: 2 }, groupEntries, matches).categories;
    expect(category.sections.flatMap((s) => s.matches)).toHaveLength(2);
    expect(category.sections[1].matches[0]).toMatchObject({ a: "Rahul", b: "Winner of M2" });
  });

  it("fills in results already played, in the right order", () => {
    const played = match({
      id: "m1", group_label: "A", entry_a: "a", entry_b: "b", status: "COMPLETED",
      games: [{ game_number: 2, score_a: 21, score_b: 18 }, { game_number: 1, score_a: 21, score_b: 15 }],
    });
    const [category] = sheetFor({ format: "GROUP_KO" }, groupEntries, [played]).categories;
    expect(category.sections[0].matches[0].games).toEqual(["21-15", "21-18"]);
  });

  it("shows the court and time when the match is scheduled", () => {
    const scheduled = match({ id: "m1", group_label: "A", entry_a: "a", entry_b: "b", court: "Court 2", scheduled_at: "2026-11-08T04:00:00Z" });
    const row = sheetFor({ format: "GROUP_KO" }, groupEntries, [scheduled]).categories[0].sections[0].matches[0];
    expect(row.court).toBe("Court 2");
    expect(row.time).not.toBe("");
  });

  it("gives one box for one-game matches and three for best of 3", () => {
    expect(sheetFor({ format: "GROUP_KO" }, groupEntries, groupMatches, { gamesPerMatch: 1, pointsPerGame: 15 })).toMatchObject({ gameCount: 1, rules: "One game to 15" });
    expect(sheetFor({ format: "GROUP_KO" }, groupEntries, groupMatches)).toMatchObject({ gameCount: 3, rules: "Best of 3 to 21" });
  });

  it("skips a category with no draw yet", () => {
    expect(sheetFor({ format: "GROUP_KO" }, groupEntries, []).categories).toEqual([]);
  });
});
