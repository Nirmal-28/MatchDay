import { describe, it, expect } from "vitest";
import { displayTitle, displaySentence } from "./engines";

/* These run on organizer-typed text on the venue display — a broadcast
   surface. The risk being guarded against is not "did it capitalise", it is
   "did it MANGLE something the organizer capitalised on purpose". A blind
   text-transform:capitalize turns CSK into Csk; these tests exist to make
   sure that never regresses back in. */

describe("displayTitle", () => {
  it("title-cases an all-lowercase name", () => {
    expect(displayTitle("chennai premier league")).toBe("Chennai Premier League");
    expect(displayTitle("madras badminton")).toBe("Madras Badminton");
  });

  it("leaves acronyms the organizer capitalised alone", () => {
    expect(displayTitle("CSK")).toBe("CSK");
    expect(displayTitle("chennai CSK open")).toBe("Chennai CSK Open");
    expect(displayTitle("BWF world tour")).toBe("BWF World Tour");
  });

  it("leaves internal capitals alone", () => {
    expect(displayTitle("McMahon cup")).toBe("McMahon Cup");
    expect(displayTitle("MatchDay open")).toBe("MatchDay Open");
  });

  it("does not disturb text that is already correct", () => {
    expect(displayTitle("Chennai Premier League")).toBe("Chennai Premier League");
  });

  it("handles numbers and punctuation without dropping them", () => {
    expect(displayTitle("summer open 2026")).toBe("Summer Open 2026");
    expect(displayTitle("(chennai) open")).toBe("(Chennai) Open");
    expect(displayTitle("u15 singles")).toBe("U15 Singles");
  });

  it("passes empty and nullish values straight through", () => {
    expect(displayTitle("")).toBe("");
    expect(displayTitle(null)).toBe(null);
    expect(displayTitle(undefined)).toBe(undefined);
  });

  it("collapses nothing — spacing is preserved", () => {
    expect(displayTitle("a  b")).toBe("A  B");
  });
});

describe("displaySentence", () => {
  it("capitalises only the first letter, leaving the sentence intact", () => {
    expect(displaySentence("courts 3 and 4 are in 1st floor"))
      .toBe("Courts 3 and 4 are in 1st floor");
  });

  it("does not title-case the rest of the sentence", () => {
    // The whole point of having this separate from displayTitle.
    expect(displaySentence("finals start at 6pm sharp"))
      .toBe("Finals start at 6pm sharp");
  });

  it("leaves an already-capitalised sentence alone", () => {
    expect(displaySentence("Courts are upstairs")).toBe("Courts are upstairs");
  });

  it("preserves a leading acronym", () => {
    expect(displaySentence("CSK members enter via gate 2")).toBe("CSK members enter via gate 2");
  });

  it("skips leading punctuation to find the first letter", () => {
    expect(displaySentence("** note: doors open at 8")).toBe("** Note: doors open at 8");
  });

  it("returns text with no letters unchanged", () => {
    expect(displaySentence("123 456")).toBe("123 456");
  });

  it("passes empty and nullish values straight through", () => {
    expect(displaySentence("")).toBe("");
    expect(displaySentence(null)).toBe(null);
  });
});
