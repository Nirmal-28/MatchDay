import { describe, it, expect } from "vitest";
import {
  reshuffleGroups, latestGroupStage, stageFinishingOrder, parseGroupLabel, stageGroupLabel,
  groupDisplayName, matchStageLabel, roundRobinRounds, computeStandings,
} from "./engines";

// The organizer's sheet: four groups of five, each listed in Round 1
// finishing order. "2D" = player D of Group B (group 2).
const ROUND_1 = [
  ["1C", "1E", "1A", "1D", "1B"],
  ["2A", "2D", "2E", "2C", "2B"],
  ["3E", "3A", "3B", "3D", "3C"],
  ["4B", "4C", "4A", "4D", "4E"],
];

describe("reshuffleGroups", () => {
  it("reproduces the organizer's Round 2 groups exactly", () => {
    const ids = reshuffleGroups(ROUND_1).map((g) => g.map((x) => x.entryId));
    expect(ids).toEqual([
      ["1C", "2D", "3B", "4D", "1B"],
      ["2A", "3A", "4A", "1D", "2B"],
      ["3E", "4C", "1A", "2C", "3C"],
      ["4B", "1E", "2E", "3D", "4E"],
    ]);
  });

  it("gives every new group one player from each finishing position", () => {
    for (const group of reshuffleGroups(ROUND_1)) {
      expect(group.map((x) => x.position)).toEqual([1, 2, 3, 4, 5]);
    }
  });

  it("handles uneven groups without dropping anyone", () => {
    const uneven = [["a1", "a2", "a3", "a4", "a5", "a6"], ["b1", "b2", "b3", "b4", "b5"], ["c1", "c2", "c3", "c4", "c5"]];
    const out = reshuffleGroups(uneven).flat().map((x) => x.entryId).sort();
    expect(out).toEqual(uneven.flat().sort());
  });
});

describe("group stage labels", () => {
  it("keeps stage 1 as plain letters and marks later stages", () => {
    expect(stageGroupLabel(1, "A")).toBe("A");
    expect(stageGroupLabel(2, "C")).toBe("S2-C");
    expect(parseGroupLabel("S2-C")).toEqual({ stage: 2, group: "C" });
    expect(parseGroupLabel("B")).toEqual({ stage: 1, group: "B" });
    expect(groupDisplayName("S2-C")).toBe("Stage 2 · Group C");
    expect(matchStageLabel({ group_label: "S2-C", round: 3 }, {})).toBe("Stage 2 · Group C · Round 3");
    expect(matchStageLabel({ group_label: "A", round: 1 }, {})).toBe("Group A · Round 1");
  });
});

describe("latestGroupStage + stageFinishingOrder", () => {
  // Build a finished stage where the lower-listed player always wins less:
  // entry i beats entry j whenever i comes first in its group's list.
  const finishedStage = (groups, stage) => groups.flatMap((ids, gi) =>
    roundRobinRounds(ids).flat().map(([a, b], i) => {
      const winner = ids.indexOf(a) < ids.indexOf(b) ? a : b;
      const aWon = winner === a;
      return {
        id: `${stage}-${gi}-${i}`, entry_a: a, entry_b: b, status: "COMPLETED", winner_entry_id: winner,
        group_label: stageGroupLabel(stage, String.fromCharCode(65 + gi)), round: 1,
        games: [{ game_number: 1, score_a: aWon ? 21 : 10, score_b: aWon ? 10 : 21 }, { game_number: 2, score_a: aWon ? 21 : 10, score_b: aWon ? 10 : 21 }],
      };
    })
  );

  it("ranks stage 1 and picks only the newest stage", () => {
    const s1 = finishedStage(ROUND_1, 1);
    const { stage, matches, labels } = latestGroupStage(s1);
    expect(stage).toBe(1);
    expect(labels).toEqual(["A", "B", "C", "D"]);
    expect(stageFinishingOrder(matches, labels)).toEqual(ROUND_1);

    const s2Groups = reshuffleGroups(ROUND_1).map((g) => g.map((x) => x.entryId));
    const both = [...s1, ...finishedStage(s2Groups, 2), { id: "rr", group_label: "RR" }];
    const latest = latestGroupStage(both);
    expect(latest.stage).toBe(2);
    expect(latest.labels).toEqual(["S2-A", "S2-B", "S2-C", "S2-D"]);
    expect(latest.matches.every((m) => m.group_label.startsWith("S2-"))).toBe(true);
  });
});

describe("computeStandings tie-break", () => {
  it("ranks level-on-wins players by point difference before game difference", () => {
    // Everyone wins once. Point difference: X +20, Y -2, Z -18.
    // Game difference: X +1, Z 0, Y -1. So the old order (games first) was
    // X, Z, Y; points first gives X, Y, Z.
    const g = (a, b) => ({ game_number: 0, score_a: a, score_b: b });
    const games = (...gs) => gs.map((x, i) => ({ ...x, game_number: i + 1 }));
    const matches = [
      { entry_a: "X", entry_b: "Z", status: "COMPLETED", winner_entry_id: "X", games: games(g(21, 10), g(21, 10)) },
      { entry_a: "X", entry_b: "Y", status: "COMPLETED", winner_entry_id: "Y", games: games(g(21, 19), g(19, 21), g(20, 22)) },
      { entry_a: "Y", entry_b: "Z", status: "COMPLETED", winner_entry_id: "Z", games: games(g(19, 21), g(19, 21)) },
    ];
    const order = computeStandings(["X", "Y", "Z"], matches).map((r) => r.entryId);
    expect(order).toEqual(["X", "Y", "Z"]);
  });
});

describe("matches marked not played", () => {
  const won = (a, b, sa, sb) => ({ entry_a: a, entry_b: b, status: "COMPLETED", winner_entry_id: sa > sb ? a : b, group_label: "A", games: [{ game_number: 1, score_a: sa, score_b: sb }] });
  const notPlayed = (a, b) => ({ entry_a: a, entry_b: b, status: "WALKOVER", winner_entry_id: null, is_bye: false, group_label: "A", games: [] });

  it("count for nobody, and a pair that played nothing drops to the foot and out of the next stage", () => {
    const ms = [won("P", "Q", 15, 10), won("Q", "R", 15, 3), notPlayed("P", "X"), notPlayed("Q", "X"), notPlayed("R", "X"), won("P", "R", 15, 12)];
    const st = computeStandings(["P", "Q", "R", "X"], ms);
    expect(st.map((r) => r.entryId)).toEqual(["P", "Q", "R", "X"]);
    expect(st.find((r) => r.entryId === "P")).toMatchObject({ played: 2, won: 2 });
    expect(st.find((r) => r.entryId === "X")).toMatchObject({ played: 0, won: 0 });
    expect(stageFinishingOrder(ms, ["A"])).toEqual([["P", "Q", "R"]]);
  });
});
