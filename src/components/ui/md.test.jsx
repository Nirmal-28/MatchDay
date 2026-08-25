import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  MatchCard, TournamentCard, CapacityBar, StatusPill, Tabs, StatTile,
  SectionHeader, AttentionItem, matchStatusMeta, sportAccent,
} from "./md";

/* The design system's two load-bearing components are rendered on every
   surface in the product — player dashboard, public tournament page, match
   center, organizer command center, venue display. A break here is a break
   everywhere, and several of these props (scores of 0, absent opponents,
   missing capacity) are exactly the states that only show up with real
   tournament data.

   These are render-level guards, not snapshots: they assert the things a
   caller actually depends on. */

const wrap = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("matchStatusMeta", () => {
  it("maps every status the app emits to a label and a tone class", () => {
    expect(matchStatusMeta("live").cls).toBe("md-status-live");
    expect(matchStatusMeta("in_progress").cls).toBe("md-status-live");
    expect(matchStatusMeta("completed").label).toBe("Final");
    expect(matchStatusMeta("scheduled").label).toBe("Upcoming");
  });

  it("falls back rather than rendering nothing for an unknown status", () => {
    const meta = matchStatusMeta("SOMETHING_NEW");
    expect(meta.label).toBe("SOMETHING_NEW");
    expect(meta.cls).toBe("md-status-full");
  });
});

describe("sportAccent", () => {
  it("gives every registered sport a colour and falls back for unknown ones", () => {
    expect(sportAccent("badminton")).toContain("teal");
    expect(sportAccent("cricket")).toContain("purple");
    expect(sportAccent("kabaddi")).toContain("teal"); // fallback, not undefined
  });
});

describe("MatchCard", () => {
  const base = {
    id: "m1",
    status: "scheduled",
    sideA: { name: "A Player" },
    sideB: { name: "B Player" },
  };

  it("renders both sides and the status", () => {
    wrap(<MatchCard match={base} />);
    expect(screen.getByText("A Player")).toBeInTheDocument();
    expect(screen.getByText("B Player")).toBeInTheDocument();
    expect(screen.getByText("Upcoming")).toBeInTheDocument();
  });

  it("renders a zero score rather than hiding it", () => {
    // 0 is falsy — the card must test for null, not truthiness, or a match
    // that has just started shows no score at all.
    wrap(<MatchCard match={{ ...base, status: "live", sideA: { name: "A", score: 0 }, sideB: { name: "B", score: 0 } }} />);
    expect(screen.getAllByText("0")).toHaveLength(2);
    expect(screen.getByText("Live")).toBeInTheDocument();
  });

  it("renders the per-game breakdown when games are supplied", () => {
    wrap(<MatchCard match={{ ...base, status: "completed", games: [{ a: 21, b: 18 }, { a: 19, b: 21 }] }} />);
    expect(screen.getByText("21–18")).toBeInTheDocument();
    expect(screen.getByText("19–21")).toBeInTheDocument();
  });

  it("survives a match with no court, time, round or games", () => {
    // The state a draw is in before scheduling runs.
    expect(() => wrap(<MatchCard match={base} />)).not.toThrow();
  });

  it("wraps itself in a link only when given a destination", () => {
    const { container, rerender } = wrap(<MatchCard match={base} />);
    expect(container.querySelector("a")).toBeNull();
    rerender(<MemoryRouter><MatchCard match={base} to="/m/m1" /></MemoryRouter>);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/m/m1");
  });
});

describe("TournamentCard", () => {
  const t = {
    id: "t1", slug: "summer-open", name: "Summer Open",
    sport: "badminton", sportLabel: "Badminton",
    dateLabel: "12–14 Jun", venue: "Sports Arena", location: "Chennai",
  };

  it("links to the public slug", () => {
    wrap(<TournamentCard t={t} />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/t/summer-open");
  });

  it("falls back to the id when there is no slug yet", () => {
    wrap(<TournamentCard t={{ ...t, slug: null }} />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/t/t1");
  });

  it("shows a note only when one is supplied", () => {
    const { rerender } = wrap(<TournamentCard t={t} />);
    expect(screen.queryByText(/Entries close/)).toBeNull();
    rerender(<MemoryRouter><TournamentCard t={{ ...t, note: "Entries close in 2 days" }} /></MemoryRouter>);
    expect(screen.getByText("Entries close in 2 days")).toBeInTheDocument();
  });
});

describe("CapacityBar", () => {
  it("renders nothing without real capacity data", () => {
    // Never invent a capacity bar — a tournament with no cap has no bar.
    const { container } = render(<CapacityBar filled={3} capacity={0} />);
    expect(container).toBeEmptyDOMElement();
    const { container: c2 } = render(<CapacityBar filled={null} capacity={16} />);
    expect(c2).toBeEmptyDOMElement();
  });

  it("reports remaining places and exposes progress to assistive tech", () => {
    render(<CapacityBar filled={14} capacity={16} />);
    expect(screen.getByText("2 spots left")).toBeInTheDocument();
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "14");
    expect(bar).toHaveAttribute("aria-valuemax", "16");
  });

  it("says Full rather than '0 spots left'", () => {
    render(<CapacityBar filled={16} capacity={16} />);
    expect(screen.getByText("Full")).toBeInTheDocument();
  });

  it("singularises a single remaining place", () => {
    render(<CapacityBar filled={15} capacity={16} />);
    expect(screen.getByText("1 spot left")).toBeInTheDocument();
  });
});

describe("Tabs", () => {
  const tabs = [
    { key: "a", label: "Today", count: 2 },
    { key: "b", label: "Results", count: 0 },
  ];

  it("marks the active tab pressed and reports the others unpressed", () => {
    render(<Tabs tabs={tabs} value="a" onChange={() => {}} ariaLabel="Sections" />);
    expect(screen.getByRole("button", { name: /Today/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Results/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("calls back with the tab key", () => {
    const onChange = vi.fn();
    render(<Tabs tabs={tabs} value="a" onChange={onChange} />);
    screen.getByRole("button", { name: /Results/ }).click();
    expect(onChange).toHaveBeenCalledWith("b");
  });
});

describe("misc primitives", () => {
  it("StatTile renders a zero value", () => {
    render(<StatTile label="Live" value={0} />);
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("StatusPill renders custom children over the default label", () => {
    render(<StatusPill status="live">3 on court</StatusPill>);
    expect(screen.getByText("3 on court")).toBeInTheDocument();
  });

  it("SectionHeader renders its title and optional eyebrow", () => {
    render(<SectionHeader eyebrow="Match center" title="Your matches" />);
    expect(screen.getByRole("heading", { name: "Your matches" })).toBeInTheDocument();
    expect(screen.getByText("Match center")).toBeInTheDocument();
  });

  it("AttentionItem renders its title, detail and action", () => {
    render(<AttentionItem title="3 not checked in" detail="Court 2" action={<button>Fix</button>} />);
    expect(screen.getByText("3 not checked in")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fix" })).toBeInTheDocument();
  });
});
