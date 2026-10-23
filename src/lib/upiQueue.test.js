import { describe, it, expect } from "vitest";
import { isValidUpiId, isValidUtr, normaliseUtr, upiReference, upiPayUrl, duplicateUtrs } from "./upi";
import { matchEta, etaSentence } from "./courtQueue";

describe("UPI helpers", () => {
  it("validates UPI IDs", () => {
    expect(isValidUpiId("club.name@okhdfcbank")).toBe(true);
    expect(isValidUpiId("9876543210@ybl")).toBe(true);
    expect(isValidUpiId(" club@paytm ")).toBe(true);
    expect(isValidUpiId("no-at-sign")).toBe(false);
    expect(isValidUpiId("a@1bank")).toBe(false);
    expect(isValidUpiId("")).toBe(false);
  });

  it("accepts a 12-digit UTR with spaces, rejects anything else", () => {
    expect(isValidUtr("4123 4567 8901")).toBe(true);
    expect(normaliseUtr("4123 4567 8901")).toBe("412345678901");
    expect(isValidUtr("12345")).toBe(false);
    expect(isValidUtr("1234567890123")).toBe(false);
  });

  it("derives a stable short reference from the entry id", () => {
    expect(upiReference("7f3k2a9b-0000-0000-0000-000000000000")).toBe("MD7F3K2A");
  });

  it("builds an NPCI deep link with a fixed amount", () => {
    const url = upiPayUrl({ upiId: "club@okhdfcbank", payeeName: "Smash Club", amount: 500, note: "MD7F3K2A Open" });
    expect(url.startsWith("upi://pay?")).toBe(true);
    const q = new URLSearchParams(url.slice("upi://pay?".length));
    expect(q.get("pa")).toBe("club@okhdfcbank");
    expect(q.get("am")).toBe("500.00");
    expect(q.get("cu")).toBe("INR");
    expect(q.get("tn")).toBe("MD7F3K2A Open");
  });

  it("flags a UTR submitted for two different entries", () => {
    const claims = [
      { id: "c1", entry_id: "e1", utr: "111111111111" },
      { id: "c2", entry_id: "e2", utr: "111111111111" },
      { id: "c3", entry_id: "e3", utr: "222222222222" },
    ];
    expect(duplicateUtrs(claims)).toEqual({ c1: ["e2"], c2: ["e1"] });
  });
});

/* ───────────────────────────── court queue ───────────────────────────── */

const NOW = Date.parse("2026-11-14T14:00:00Z");
const at = (min) => new Date(NOW + min * 60000).toISOString();
const m = (id, patch) => ({ id, court_id: "c1", court: "Court 1", status: "SCHEDULED", entry_a: "a", entry_b: "b", match_number: 1, ...patch });
const settings = { matchDurationMins: 30, bufferMins: 5 };

describe("matchEta", () => {
  it("counts the live match and the queue ahead on the same court", () => {
    const matches = [
      m("live", { status: "LIVE", scheduled_at: at(-60), started_at: at(-10) }),
      m("q1", { scheduled_at: at(-30) }),
      m("mine", { scheduled_at: at(-20), match_number: 9 }),
      m("other-court", { court_id: "c2", court: "Court 2", scheduled_at: at(-50) }),
    ];
    const eta = matchEta({ match: matches[2], matches, settings, now: NOW });
    expect(eta.available).toBe(true);
    expect(eta.aheadCount).toBe(1);
    expect(eta.liveOnCourt).toBe(true);
    // live: 30 - 10 elapsed = 20 + 5 changeover; queued: 35 -> 60 minutes
    expect(eta.etaIso).toBe(at(60));
    expect(eta.minsLate).toBe(80);
    expect(eta.basis).toBe("CONFIGURED");
  });

  it("never estimates earlier than the scheduled time", () => {
    const matches = [m("mine", { scheduled_at: at(90) })];
    const eta = matchEta({ match: matches[0], matches, settings, now: NOW });
    expect(eta.etaIso).toBe(at(90));
    expect(eta.minsLate).toBe(0);
  });

  it("uses observed pace once enough matches have finished", () => {
    const done = Array.from({ length: 5 }, (_, i) => m(`d${i}`, {
      status: "COMPLETED", scheduled_at: at(-300 + i), started_at: at(-300), completed_at: at(-250),
    }));
    const mine = m("mine", { scheduled_at: at(-5) });
    const q = m("q", { scheduled_at: at(-10) });
    const eta = matchEta({ match: mine, matches: [...done, q, mine], settings, now: NOW });
    expect(eta.basis).toBe("OBSERVED");
    expect(eta.durationMins).toBe(50);
    expect(eta.etaIso).toBe(at(55));
  });

  it("refuses to estimate without a court, far in the future, or once live", () => {
    expect(matchEta({ match: m("x", { court_id: null, court: null, scheduled_at: at(10) }), matches: [], now: NOW }).available).toBe(false);
    expect(matchEta({ match: m("x", { scheduled_at: at(60 * 48) }), matches: [], now: NOW }).available).toBe(false);
    expect(matchEta({ match: m("x", { status: "LIVE", scheduled_at: at(0) }), matches: [], now: NOW }).onCourtNow).toBe(true);
  });

  it("notes when the line-up still depends on a result", () => {
    const mine = m("mine", { scheduled_at: at(30), entry_b: null });
    expect(matchEta({ match: mine, matches: [mine], settings, now: NOW }).waitingOnResult).toBe(true);
  });

  it("reads as one sentence", () => {
    const s = etaSentence({ available: true, aheadCount: 2, liveOnCourt: true, etaIso: at(60) }, () => "4:40 PM");
    expect(s).toBe("2 matches ahead of you, plus the one on court · around 4:40 PM");
  });
});
