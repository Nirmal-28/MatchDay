import { Component } from "react";
import { AlertTriangle, RotateCcw, Home } from "lucide-react";
import { captureError } from "../lib/monitoring";
import { Btn, Card } from "./ui/primitives";

// MatchDay — React error boundary.
//
// Without one of these, a single uncaught render error (a null match, an
// event with no draw, anything) unmounts the entire React tree and leaves a
// blank white page with no way back. That is the worst possible failure on a
// tournament day, because it looks like the whole product is down.
//
// Two levels are used (see App.jsx):
//   - a route-level boundary, so a broken page keeps the header, the nav and
//     every other route usable;
//   - an app-level boundary as the last resort.
//
// Errors are reported through monitoring.js, which is the only reason you
// will ever hear about a crash that a user did not bother to report.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    captureError(error, {
      source: this.props.source || "react",
      componentStack: info?.componentStack,
      boundary: this.props.name || "app",
    });
  }

  // Remount the subtree. For a transient failure (a race, a bad fetch) this
  // genuinely recovers; for a deterministic one the boundary simply catches
  // again, which is honest — it does not pretend to have fixed anything.
  retry = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="mx-auto max-w-md py-12">
        <Card className="p-6 text-center">
          <AlertTriangle className="mx-auto mb-3 text-amber-400" size={30} />
          <h1 className="text-lg font-semibold text-ink">Something went wrong on this screen</h1>
          <p className="mt-1.5 text-sm text-ink-2">
            The rest of MatchDay is still working. This has been reported automatically —
            you do not need to send anything.
          </p>

          {/* The message is shown in development only. In production it can
              contain internals that mean nothing to a user and everything to
              someone probing the app. */}
          {import.meta.env.DEV && (
            <pre className="mt-3 max-h-40 overflow-auto rounded border border-line bg-surface-2 p-2 text-left text-[11px] text-ink-2">
              {this.state.error?.message}
              {"\n"}
              {this.state.error?.stack}
            </pre>
          )}

          {/* A plain anchor, not a router Link: the app-level boundary sits
              outside BrowserRouter, where Link would itself throw. A full
              reload is also the more reliable recovery after a top-level
              crash, because it rebuilds all the state that caused it. */}
          <div className="mt-5 flex justify-center gap-2">
            <Btn variant="secondary" icon={RotateCcw} onClick={this.retry}>Try again</Btn>
            <a href="/"><Btn icon={Home}>Go to Discover</Btn></a>
          </div>
        </Card>
      </div>
    );
  }
}
