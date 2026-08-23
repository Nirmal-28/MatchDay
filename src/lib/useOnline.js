import { useEffect, useState } from "react";

// Connection status for the courtside surfaces.
//
// Scorer Mode and the Venue Display are explicitly designed to run on a phone
// at the net post and a TV in the hall — exactly the places where venue wifi
// drops. Before this there was no indication at all: a scorer would tap Point,
// the write would fail silently in a promise nobody surfaced, and the score on
// the screen would be ahead of the score in the database.
//
// navigator.onLine alone is not trustworthy — it reports whether there is a
// network interface, not whether anything is reachable. So this also listens
// for Supabase write failures reported through markConnectionFailure(), which
// is what actually matters.

let listeners = new Set();
let reachable = true;

function broadcast() {
  for (const fn of listeners) fn();
}

/** Called by the write queue when a request fails in a way that looks offline. */
export function markConnectionFailure() {
  if (reachable) { reachable = false; broadcast(); }
}

/** Called when any request succeeds. */
export function markConnectionOk() {
  if (!reachable) { reachable = true; broadcast(); }
}

export function useOnline() {
  const [online, setOnline] = useState(
    () => (typeof navigator === "undefined" ? true : navigator.onLine) && reachable
  );

  useEffect(() => {
    const update = () => setOnline((navigator.onLine !== false) && reachable);
    const onOnline = () => { reachable = true; update(); };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", update);
    listeners.add(update);
    update();

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", update);
      listeners.delete(update);
    };
  }, []);

  return online;
}
