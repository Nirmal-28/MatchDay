import { describe, it, expect } from "vitest";
import { computeSeriesStandings } from "./seriesStandings";

// Regression: entry -> player used to be a single id, so a doubles entry
// credited only one of the two partners with the pair's results.
describe("series standings for doubles", () => {
  it("credits both partners of a doubles entry", () => {
    const data = {
      matches: [{ id: "m1", event_id: "ev", status: "COMPLETED", entry_a: "e1", entry_b: "e2", winner_entry_id: "e1", round: 1 }],
      entries: [{ id: "e1", event_id: "ev", reg_status: "CONFIRMED" }, { id: "e2", event_id: "ev", reg_status: "CONFIRMED" }],
      entryToPlayer: { e1: ["p1", "p2"], e2: ["p3", "p4"] },
      players: ["p1", "p2", "p3", "p4"].map((id) => ({ id, name: id })),
      eventById: { ev: { id: "ev" } },
      tournamentByEvent: { ev: "t1" },
    };
    const { table } = computeSeriesStandings(data);
    const byId = Object.fromEntries(table.map((r) => [r.playerId, r]));
    expect(byId.p1.won).toBe(1);
    expect(byId.p2.won).toBe(1);
    expect(byId.p3.lost).toBe(1);
    expect(byId.p4.lost).toBe(1);
  });

  it("still accepts a single player id per entry", () => {
    const data = {
      matches: [{ id: "m1", event_id: "ev", status: "COMPLETED", entry_a: "e1", entry_b: "e2", winner_entry_id: "e2", round: 1 }],
      entries: [{ id: "e1", event_id: "ev", reg_status: "CONFIRMED" }, { id: "e2", event_id: "ev", reg_status: "CONFIRMED" }],
      entryToPlayer: { e1: "p1", e2: "p2" },
      players: [{ id: "p1" }, { id: "p2" }],
      eventById: { ev: { id: "ev" } },
      tournamentByEvent: { ev: "t1" },
    };
    const { table } = computeSeriesStandings(data);
    expect(table.find((r) => r.playerId === "p2").won).toBe(1);
  });
});
