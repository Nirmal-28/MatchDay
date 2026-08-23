// MatchDay — client error monitoring.
//
// Before this, a crash in someone's browser was invisible: no Sentry, no
// logging, so the only way you learned about a bug was a user telling you.
// This captures uncaught errors, unhandled promise rejections and React
// render failures, and stores them in a `client_errors` table on your own
// Supabase project — no third-party account, no per-seat pricing, and no
// data leaving infrastructure you already control.
//
// It is deliberately fail-quiet: monitoring must never become the thing that
// breaks the app. Every path here swallows its own errors.
//
// ── Privacy ──────────────────────────────────────────────────────────────
// Error messages routinely contain whatever was being processed, which in
// this app can include a player's phone or email. scrub() strips anything
// that looks like an address, a phone number, a JWT or a long token before
// the report is sent. The user id is recorded (it is already yours, and
// without it you cannot tell one user's crash loop from fifty users) but no
// other personal field ever is.

import { supabase } from "./supabaseClient";

const ENABLED = import.meta.env.VITE_ERROR_REPORTING !== "off";
const MAX_PER_SESSION = 25;      // a render loop must not write 10,000 rows
const DEDUPE_WINDOW_MS = 60_000; // the same error twice a minute is one event

let sent = 0;
const recent = new Map(); // fingerprint -> last sent timestamp

// Redact anything that could carry personal data out of a message or stack.
function scrub(text) {
  if (!text) return "";
  return String(text)
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]")
    .replace(/\b(?:\+?91[\s-]?)?[6-9]\d{9}\b/g, "[phone]")
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[token]")
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, "[token]")
    .slice(0, 4000);
}

function fingerprint(message, stack) {
  const firstFrame = (stack || "").split("\n").find((l) => l.includes("http")) || "";
  return `${message}|${firstFrame}`.slice(0, 300);
}

function shouldSend(fp) {
  if (!ENABLED || sent >= MAX_PER_SESSION) return false;
  const last = recent.get(fp);
  const now = Date.now();
  if (last && now - last < DEDUPE_WINDOW_MS) return false;
  recent.set(fp, now);
  return true;
}

/**
 * Record an error. Never throws, never blocks the caller.
 *
 * @param error    an Error, or anything thrown
 * @param context  { source, componentStack, ...anything serialisable }
 */
export async function captureError(error, context = {}) {
  try {
    const message = scrub(error?.message || String(error) || "Unknown error");
    const stack = scrub(error?.stack || "");
    const fp = fingerprint(message, stack);

    // Always visible locally — in development the console is the fast path,
    // and in production it costs nothing.
    if (import.meta.env.DEV) console.error("[monitoring]", error, context);

    if (!shouldSend(fp)) return;
    sent++;

    const { data } = await supabase.auth.getSession();

    await supabase.from("client_errors").insert({
      message,
      stack,
      fingerprint: fp,
      source: context.source || "unknown",
      component_stack: scrub(context.componentStack || ""),
      path: typeof location !== "undefined" ? location.pathname : null,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 300) : null,
      user_id: data?.session?.user?.id || null,
      context: sanitiseContext(context),
      app_version: import.meta.env.VITE_APP_VERSION || "dev",
    });
  } catch {
    // Monitoring failing is not a reason for the app to fail.
  }
}

// Keep context small and scrubbed; drop anything that will not serialise.
function sanitiseContext(context) {
  try {
    // componentStack and source are stored as their own columns; everything
    // else becomes the small scrubbed context blob.
    const { componentStack: _cs, source: _src, ...rest } = context;
    const out = {};
    for (const [k, v] of Object.entries(rest)) {
      if (v == null) continue;
      if (typeof v === "object") continue; // avoid dragging whole rows (and their PII) in
      out[k] = scrub(String(v)).slice(0, 200);
    }
    return Object.keys(out).length ? out : null;
  } catch { return null; }
}

/**
 * Attach window-level handlers. Called once from main.jsx.
 * Returns a cleanup function (used by tests; the app never detaches).
 */
export function installErrorHandlers() {
  if (typeof window === "undefined") return () => {};

  const onError = (event) => {
    captureError(event.error || event.message, { source: "window.onerror" });
  };
  const onRejection = (event) => {
    captureError(event.reason, { source: "unhandledrejection" });
  };

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}

// Exported for tests — asserting on scrubbing is the whole point of having it.
export const __test = { scrub, fingerprint };
