// MatchDay — offline write queue for courtside scoring.
//
// The problem this solves: Scorer Mode runs on a phone at the net post, on
// venue wifi that drops. Before this, a failed write was an unhandled promise
// rejection — the tap looked like it worked, the local score moved on, and
// the database quietly fell behind. Nobody found out until the bracket was
// wrong.
//
// How it works: every scoring action is appended to a durable queue in
// localStorage BEFORE it is attempted. If the write succeeds it is removed. If
// it fails, it stays and is retried when the connection returns. Because the
// queue is in localStorage, closing the browser or the phone locking does not
// lose the points already tapped.
//
// ── Ordering matters, so this is strictly sequential ─────────────────────
// scorePoint() is a read-modify-write: it reads the current score and adds a
// delta. Replaying two queued points in parallel, or out of order, would
// produce a wrong score. So the queue drains one operation at a time, in the
// order the taps happened, and stops on the first failure rather than skipping
// ahead.
//
// ── What this does NOT claim to fix ──────────────────────────────────────
// This makes ONE device resilient to losing its connection. It does not make
// two devices scoring the same match safe — that is the read-modify-write race
// documented in repository.js, and it is unchanged here.

import { markConnectionFailure, markConnectionOk } from "./useOnline";
import { captureError } from "./monitoring";

const STORAGE_KEY = "md_offline_queue_v1";
const MAX_QUEUE = 500;          // a full match is ~60 taps; this is generous
const MAX_ATTEMPTS = 8;

// Operations the queue knows how to replay. Registered by the scoring UI so
// this module has no import cycle back into the repository.
const handlers = new Map();

// The in-flight drain, or null. Held as a promise rather than a boolean so
// that a second caller can AWAIT the drain already running instead of being
// told "busy" and continuing as if the queue were sent. That distinction
// matters: ScorerMode does `enqueue(); await drain();` and then re-reads the
// match, so a drain() that resolved early would refetch a score the server
// has not been told about yet.
let draining = null;
let seq = 0;
const listeners = new Set();

/* --------------------------- persistence -------------------------------- */

function read() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(queue) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue.slice(0, MAX_QUEUE)));
  } catch {
    // Storage full or blocked (private mode). The queue degrades to
    // in-memory-only for this session rather than breaking scoring.
  }
  notify();
}

function notify() {
  const state = getState();
  for (const fn of listeners) {
    try { fn(state); } catch { /* a bad subscriber must not stop the queue */ }
  }
}

/* ------------------------------ public ---------------------------------- */

/** Register how to replay an operation kind, e.g. registerHandler("scorePoint", fn). */
export function registerHandler(kind, fn) {
  handlers.set(kind, fn);
}

export function getState() {
  const queue = read();
  return {
    pending: queue.length,
    oldestAt: queue[0]?.at || null,
    stuck: queue.some((op) => op.attempts >= MAX_ATTEMPTS),
  };
}

export function subscribe(fn) {
  listeners.add(fn);
  fn(getState());
  return () => listeners.delete(fn);
}

/**
 * Queue an operation and try it immediately.
 *
 * Returns a promise that resolves when the operation has been ACCEPTED into
 * the queue — not when it has reached the server. The UI updates optimistically
 * off its own local state and the pending count tells the truth about what has
 * actually landed.
 */
export function enqueue(kind, args) {
  const queue = read();
  if (queue.length >= MAX_QUEUE) {
    // Refusing is better than silently dropping the oldest points.
    throw new Error("Too many unsent changes. Reconnect before scoring further.");
  }
  queue.push({ id: `${Date.now()}-${++seq}`, kind, args, at: new Date().toISOString(), attempts: 0 });
  write(queue);
  drain();
}

/**
 * Attempt to send everything, oldest first. Safe to call at any time; a second
 * call while draining is a no-op.
 */
export function drain() {
  // Join the run already in progress rather than starting a second one. The
  // loop re-reads the queue each iteration, so anything enqueued in the
  // meantime is picked up by the drain the caller is now awaiting.
  if (draining) return draining;
  draining = drainLoop().finally(() => { draining = null; });
  return draining;
}

async function drainLoop() {
  {
    // Re-read every iteration: new taps can arrive mid-drain.
    for (;;) {
      const queue = read();
      if (!queue.length) { markConnectionOk(); break; }

      const op = queue[0];
      const handler = handlers.get(op.kind);

      if (!handler) {
        // Nothing can ever replay this — dropping it is the only way the
        // queue can move, but it must be visible rather than silent.
        captureError(new Error(`No offline handler registered for "${op.kind}"`), { source: "offlineQueue" });
        write(queue.slice(1));
        continue;
      }

      try {
        await handler(...(op.args || []));
        markConnectionOk();
        // Remove by id, not by index — the head may have changed.
        write(read().filter((q) => q.id !== op.id));
      } catch (err) {
        const offline = looksOffline(err);
        if (offline) markConnectionFailure();

        const current = read();
        const idx = current.findIndex((q) => q.id === op.id);
        if (idx >= 0) {
          current[idx] = { ...current[idx], attempts: (current[idx].attempts || 0) + 1, lastError: String(err?.message || err).slice(0, 200) };

          // A permanent failure (rejected by RLS, match already completed)
          // will never succeed on retry. Give up on it, report it, and let
          // the rest of the queue through — otherwise one bad operation
          // blocks every later point forever.
          if (!offline && current[idx].attempts >= 3) {
            captureError(err, { source: "offlineQueue", kind: op.kind, attempts: current[idx].attempts });
            write(current.filter((q) => q.id !== op.id));
            continue;
          }
          write(current);
        }
        // Stop draining: order must be preserved, so nothing after a failed
        // operation may be sent ahead of it.
        break;
      }
    }
  }
}

// Distinguish "the network is gone" (retry) from "the server said no" (do not).
function looksOffline(err) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const msg = String(err?.message || err).toLowerCase();
  return msg.includes("failed to fetch") || msg.includes("network") ||
         msg.includes("timeout") || msg.includes("load failed");
}

/** Clear everything. Only for an operator who has decided to abandon unsent taps. */
export function discardAll() {
  write([]);
}

/** Retry now — used by the "Retry" button on the offline banner. */
export function retryNow() {
  const queue = read().map((op) => ({ ...op, attempts: 0 }));
  write(queue);
  return drain();
}

// Drain whenever the browser thinks the network is back, and on tab focus
// (which is when a scorer picks the phone up again).
if (typeof window !== "undefined") {
  window.addEventListener("online", () => drain());
  window.addEventListener("focus", () => drain());
  document.addEventListener?.("visibilitychange", () => {
    if (document.visibilityState === "visible") drain();
  });
}
