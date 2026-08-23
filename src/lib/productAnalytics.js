// MatchDay — product analytics (how the app is used).
//
// Not to be confused with src/lib/analytics.js, which computes TOURNAMENT
// statistics (participation, match durations) for organizers to look at.
// This file is about the product itself: which screens people reach, where
// they drop out of registration, whether anyone uses Scorer Mode.
//
// Same reasoning as monitoring.js — events go to an `analytics_events` table
// on your own Supabase project rather than to Google Analytics or PostHog.
// No third-party script is loaded, so there is no cookie banner to add, no
// ad-tech in the bundle, and nothing to disclose to players beyond your own
// privacy policy.
//
// ── What is deliberately NOT recorded ────────────────────────────────────
// No names, phones, emails, or free text of any kind. Properties are limited
// to short scalars, and any value that looks like an identifier of a person
// is dropped rather than stored. Anonymous visitors get a random session id
// held in sessionStorage that dies with the tab — it is not a tracking
// cookie and does not follow anyone between visits.

import { supabase } from "./supabaseClient";

const ENABLED = import.meta.env.VITE_ANALYTICS !== "off";
const MAX_PER_SESSION = 200;

let sent = 0;
let sessionId = null;

function getSessionId() {
  if (sessionId) return sessionId;
  try {
    const KEY = "md_session";
    let id = sessionStorage.getItem(KEY);
    if (!id) {
      id = (crypto.randomUUID?.() || String(Math.random()).slice(2)) ;
      sessionStorage.setItem(KEY, id);
    }
    sessionId = id;
  } catch {
    sessionId = "no-storage";
  }
  return sessionId;
}

// Only short scalars survive. Anything else is a route to accidentally
// logging a person's details into an analytics table.
function safeProps(props) {
  if (!props) return null;
  const out = {};
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;
    if (typeof v === "boolean" || typeof v === "number") { out[k] = v; continue; }
    if (typeof v === "string") {
      if (v.includes("@") || /\d{10}/.test(v)) continue; // looks personal — drop it
      out[k] = v.slice(0, 60);
    }
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Record a product event. Fire-and-forget; never throws, never awaited by UI.
 *
 * @param name   short stable event name, e.g. "registration_started"
 * @param props  small scalar properties only
 */
export function track(name, props) {
  if (!ENABLED || sent >= MAX_PER_SESSION) return;
  sent++;
  (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      await supabase.from("analytics_events").insert({
        name: String(name).slice(0, 60),
        props: safeProps(props),
        path: typeof location !== "undefined" ? location.pathname : null,
        session_id: getSessionId(),
        user_id: data?.session?.user?.id || null,
        app_version: import.meta.env.VITE_APP_VERSION || "dev",
      });
    } catch {
      // Analytics must never surface to the user or break a flow.
    }
  })();
}

/** Page views, called from a router effect. */
export function trackPageView(path) {
  track("page_view", { path: String(path).replace(/\/[0-9a-f-]{8,}/gi, "/:id").slice(0, 60) });
}

export const __test = { safeProps };
