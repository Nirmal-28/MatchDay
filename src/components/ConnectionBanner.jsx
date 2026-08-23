import { useEffect, useState } from "react";
import { CloudOff, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";
import { subscribe, retryNow, getState } from "../lib/offlineQueue";
import { useOnline } from "../lib/useOnline";

// The courtside truth-teller.
//
// Scorer Mode and the Venue Display run where venue wifi drops. This is the
// one thing on screen that says whether what you are looking at has actually
// reached the database. Silence would be a lie: before this, a scorer tapping
// Point on a dead connection saw the score move and had no idea nothing was
// being saved.
//
// Three states, and only three, because ambiguity here is worse than useless:
//   - offline with nothing queued  → you cannot save right now
//   - offline/failing with a queue → N taps are waiting, they are not lost
//   - a stuck operation            → something is wrong that retrying will not fix
export default function ConnectionBanner({ compact = false }) {
  const online = useOnline();
  const [state, setState] = useState(getState);
  // "Had something queued at some point" — set from the subscription callback
  // (an event), never from an effect reacting to the value it just set.
  const [hadPending, setHadPending] = useState(() => getState().pending > 0);

  useEffect(() => subscribe((next) => {
    setState(next);
    if (next.pending > 0) setHadPending(true);
  }), []);

  // Confirm success briefly — a queue that empties silently leaves the scorer
  // unsure whether it sent or was thrown away.
  useEffect(() => {
    if (state.pending !== 0 || !hadPending) return;
    const t = setTimeout(() => setHadPending(false), 2500);
    return () => clearTimeout(t);
  }, [state.pending, hadPending]);

  const nothingToSay = online && state.pending === 0 && !hadPending;
  if (nothingToSay) return null;

  const saved = online && state.pending === 0 && hadPending;

  const tone = saved
    ? "border-emerald-500/40 bg-emerald-950/90 text-emerald-200"
    : state.stuck
      ? "border-amber-500/40 bg-amber-950/90 text-amber-100"
      : "border-red-500/40 bg-red-950/90 text-red-100";

  const Icon = saved ? CheckCircle2 : state.stuck ? AlertTriangle : CloudOff;

  const message = saved
    ? "All scores saved."
    : state.pending > 0
      ? `${state.pending} ${state.pending === 1 ? "change" : "changes"} not saved yet${online ? " — sending…" : " — they are stored on this device"}`
      : "No connection — scores cannot be saved right now.";

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs ${tone} ${compact ? "" : "mb-3"}`}
    >
      <Icon size={15} className="shrink-0" />
      <span className="flex-1">{message}</span>
      {!saved && state.pending > 0 && (
        <button
          onClick={() => retryNow()}
          className="inline-flex shrink-0 items-center gap-1 rounded border border-current/30 px-2 py-1 font-medium hover:bg-white/10"
        >
          <RefreshCw size={12} /> Retry
        </button>
      )}
    </div>
  );
}
