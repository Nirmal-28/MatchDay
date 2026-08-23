import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ErrorBoundary from "./ErrorBoundary";

// The boundary only matters if it actually catches. These assert the two
// things that were broken before it existed: a thrown render does not blank
// the page, and the failure is reported rather than swallowed.

vi.mock("../lib/monitoring", () => ({ captureError: vi.fn() }));
const { captureError } = await import("../lib/monitoring");

function Boom({ fail = true }) {
  if (fail) throw new Error("render exploded");
  return <div>recovered content</div>;
}

beforeEach(() => {
  vi.clearAllMocks();
  // React logs caught errors to console.error by design; silence it so a
  // passing test run is not full of red noise.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("ErrorBoundary", () => {
  it("renders children when nothing throws", () => {
    render(<ErrorBoundary><div>all fine</div></ErrorBoundary>);
    expect(screen.getByText("all fine")).toBeInTheDocument();
  });

  it("shows a recovery screen instead of a blank page when a child throws", () => {
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(screen.getByText(/something went wrong on this screen/i)).toBeInTheDocument();
    // The reassurance matters: the rest of the app still works.
    expect(screen.getByText(/rest of MatchDay is still working/i)).toBeInTheDocument();
  });

  it("reports the error, which is the only reason you hear about crashes nobody files", () => {
    render(<ErrorBoundary name="route" source="route"><Boom /></ErrorBoundary>);
    expect(captureError).toHaveBeenCalledTimes(1);
    const [error, context] = captureError.mock.calls[0];
    expect(error.message).toBe("render exploded");
    expect(context.source).toBe("route");
    expect(context.boundary).toBe("route");
    expect(context.componentStack).toBeTruthy();
  });

  it("offers a way out that does not require a router", () => {
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    // A plain anchor, because the app-level boundary sits outside BrowserRouter
    // where a router Link would itself throw.
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/");
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("retry re-renders the subtree, so a transient failure genuinely recovers", () => {
    let shouldFail = true;
    const Flaky = () => {
      if (shouldFail) throw new Error("transient");
      return <div>recovered content</div>;
    };

    render(<ErrorBoundary><Flaky /></ErrorBoundary>);
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();

    shouldFail = false;
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(screen.getByText("recovered content")).toBeInTheDocument();
  });
});
