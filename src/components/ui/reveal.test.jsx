import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MaskText, Rise, Tilt, Magnetic, Counter, Stagger, StaggerChild } from "./reveal";

/* The failure mode that matters for a scroll-reveal system is not "the
   animation looks wrong" — it is CONTENT THAT NEVER APPEARS. Every element
   in this module starts at opacity 0 and is brought in by an
   IntersectionObserver callback, so anything that stops that callback firing
   (no IntersectionObserver, a hidden ancestor, reduced motion) must fall back
   to showing the content, never to hiding it.

   These tests pin that contract down, plus the accessibility guarantees:
   a masked headline must still read as one string, and pointer effects must
   not attach on touch devices. */

const setReducedMotion = (reduced) => {
  window.matchMedia = (query) => ({
    matches: query.includes("prefers-reduced-motion") ? reduced : false,
    media: query,
    onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {},
    dispatchEvent: () => false,
  });
};

const setFinePointer = (fine) => {
  window.matchMedia = (query) => ({
    matches: query.includes("hover") ? fine : false,
    media: query,
    onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {},
    dispatchEvent: () => false,
  });
};

const originalMatchMedia = window.matchMedia;
const originalIO = global.IntersectionObserver;

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  global.IntersectionObserver = originalIO;
});

describe("reduced motion", () => {
  beforeEach(() => setReducedMotion(true));

  it("renders Rise content fully visible with no transition", () => {
    render(<Rise><p>Section body</p></Rise>);
    const el = screen.getByText("Section body").parentElement;
    expect(el).toHaveStyle({ opacity: "1" });
    expect(el.style.transition).toBe("none");
  });

  it("renders MaskText lines at rest", () => {
    render(<MaskText lines={["Play.", "Compete."]} />);
    // The visible copies are aria-hidden; assert on the inner line elements.
    const play = screen.getByText("Play.");
    expect(play.style.opacity).toBe("1");
    expect(play.style.transition).toBe("none");
  });

  it("shows a Counter's final value immediately rather than counting", () => {
    render(<Counter value={42} />);
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("Tilt renders without pointer handlers", () => {
    const { container } = render(<Tilt><span>card</span></Tilt>);
    expect(container.querySelector(".md-tilt")).toBeNull();
    expect(screen.getByText("card")).toBeInTheDocument();
  });
});

describe("missing IntersectionObserver", () => {
  beforeEach(() => {
    setReducedMotion(false);
    // Some environments (older browsers, some embedded webviews) genuinely
    // lack it. Content must still render.
    delete global.IntersectionObserver;
  });

  it("falls back to visible instead of leaving content at opacity 0", () => {
    render(<Rise><p>Must be visible</p></Rise>);
    const el = screen.getByText("Must be visible").parentElement;
    expect(el).toHaveStyle({ opacity: "1" });
  });

  it("falls back to visible for masked headings too", () => {
    const { container } = render(<MaskText lines={["Rankings"]} />);
    // Target the animated line specifically — the accessible sr-only copy
    // also contains the text and carries no inline style.
    const line = container.querySelector('[aria-hidden="true"] > span');
    expect(line.style.opacity).toBe("1");
  });
});

describe("MaskText accessibility", () => {
  beforeEach(() => setReducedMotion(false));

  it("exposes the whole headline as one uninterrupted string", () => {
    const { container } = render(
      <MaskText as="h1" lines={["Play.", "Compete.", "Belong."]} />
    );
    // One accessible copy holding the full text...
    const srOnly = container.querySelector(".sr-only");
    expect(srOnly).toHaveTextContent("Play. Compete. Belong.");
    // ...and the split, animated copies hidden from assistive tech, so the
    // headline is not announced three times or one fragment at a time.
    const hidden = container.querySelectorAll('[aria-hidden="true"]');
    expect(hidden.length).toBe(3);
  });

  it("renders through the requested element type", () => {
    const { container } = render(<MaskText as="h1" lines={["Title"]} />);
    expect(container.querySelector("h1")).toBeInTheDocument();
  });

  it("accepts a bare string as well as an array", () => {
    const { container } = render(<MaskText lines="Single line" />);
    expect(container.querySelector(".sr-only")).toHaveTextContent("Single line");
  });
});

describe("pointer-only effects", () => {
  it("Tilt attaches its handlers only on a device with a fine pointer", () => {
    setFinePointer(true);
    const { container, unmount } = render(<Tilt><span>a</span></Tilt>);
    expect(container.querySelector(".md-tilt")).not.toBeNull();
    unmount();

    setFinePointer(false);
    const { container: touch } = render(<Tilt><span>b</span></Tilt>);
    expect(touch.querySelector(".md-tilt")).toBeNull();
  });

  it("Magnetic degrades to a plain wrapper on touch", () => {
    setFinePointer(false);
    const { container } = render(<Magnetic><button>Go</button></Magnetic>);
    expect(container.querySelector(".md-magnetic")).toBeNull();
    expect(screen.getByRole("button", { name: "Go" })).toBeInTheDocument();
  });
});

describe("Stagger", () => {
  beforeEach(() => setReducedMotion(true));

  it("hands each child an incremental delay and caps it", () => {
    const { container } = render(
      <Stagger step={0.05} max={2}>
        {[0, 1, 2, 3].map((i) => (
          <StaggerChild key={i}><span>item {i}</span></StaggerChild>
        ))}
      </Stagger>
    );
    const kids = Array.from(container.firstChild.children);
    expect(kids[0].style.getPropertyValue("--stagger-delay")).toBe("0s");
    expect(kids[1].style.getPropertyValue("--stagger-delay")).toBe("0.05s");
    // Capped at index 2 — a long grid must not take seconds to finish.
    expect(kids[2].style.getPropertyValue("--stagger-delay")).toBe("0.1s");
    expect(kids[3].style.getPropertyValue("--stagger-delay")).toBe("0.1s");
  });

  it("renders every child", () => {
    render(
      <Stagger>
        {[0, 1, 2].map((i) => <StaggerChild key={i}><span>row {i}</span></StaggerChild>)}
      </Stagger>
    );
    expect(screen.getByText("row 0")).toBeInTheDocument();
    expect(screen.getByText("row 2")).toBeInTheDocument();
  });
});

describe("Counter", () => {
  beforeEach(() => setReducedMotion(false));

  it("renders small values directly without animating", () => {
    // A count-up from zero needs somewhere to travel; 2 would just flicker.
    global.IntersectionObserver = class {
      constructor(cb) { cb([{ isIntersecting: true }]); }
      observe() {} unobserve() {} disconnect() {}
    };
    render(<Counter value={2} />);
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("accepts a formatter", () => {
    setReducedMotion(true);
    render(<Counter value={7} format={(n) => `${n} matches`} />);
    expect(screen.getByText("7 matches")).toBeInTheDocument();
  });
});

describe("cleanup", () => {
  it("disconnects its observer on unmount", () => {
    setReducedMotion(false);
    const disconnect = vi.fn();
    global.IntersectionObserver = class {
      observe() {} unobserve() {} disconnect() { disconnect(); }
    };
    const { unmount } = render(<Rise><p>x</p></Rise>);
    unmount();
    expect(disconnect).toHaveBeenCalled();
  });
});
