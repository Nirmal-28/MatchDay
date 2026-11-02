import { describe, it, expect } from "vitest";
import { nextStep } from "./lifecycle";

const live = { status: "LIVE" };
const groupEvent = { id: "e1", category: "MD", format: "GROUP_KO", status: "LIVE" };
const match = (status, over = {}) => ({ event_id: "e1", status, group_label: "A", ...over });

describe("nextStep", () => {
  it.each([
    ["DRAFT", "Publish your tournament"],
    ["REGISTRATION_OPEN", "Registration is open"],
    ["COMPLETED", "This tournament is finished"],
    ["CANCELLED", "This tournament was cancelled"],
  ])("%s", (status, title) => {
    expect(nextStep({ tournament: { status } }).title).toBe(title);
  });

  it("asks for a draw once registration closes", () => {
    expect(nextStep({ tournament: { status: "REGISTRATION_CLOSED" } })).toMatchObject({ title: "Make the draw", tab: "draw" });
  });

  it("says ready, with the sheet, once the draw exists", () => {
    const step = nextStep({ tournament: { status: "REGISTRATION_CLOSED" }, matches: [match("READY")] });
    expect(step.title).toBe("Ready to start");
    expect(step.body).toContain("match sheet");
  });

  it("sends a running tournament to enter results", () => {
    const step = nextStep({ tournament: live, events: [groupEvent], matches: [match("COMPLETED"), match("READY")] });
    expect(step).toMatchObject({ title: "Enter results as matches finish", tab: "live" });
  });

  it("points at the knockout when the last group match finishes", () => {
    const step = nextStep({ tournament: live, events: [groupEvent], matches: [match("COMPLETED"), match("WALKOVER")] });
    expect(step).toMatchObject({ title: "The groups are finished", tab: "draw" });
    expect(step.body).toContain("Men's Doubles");
  });

  it("stops asking for the knockout once it exists", () => {
    const step = nextStep({ tournament: live, events: [groupEvent], matches: [match("COMPLETED"), match("READY", { group_label: null })] });
    expect(step.title).toBe("Enter results as matches finish");
  });

  it("points at closing the tournament when everything is played", () => {
    const step = nextStep({ tournament: live, events: [{ ...groupEvent, format: "SINGLE_ELIM", status: "COMPLETED" }], matches: [match("COMPLETED", { group_label: null })] });
    expect(step).toMatchObject({ title: "All matches are played", tab: "settings" });
  });
});
