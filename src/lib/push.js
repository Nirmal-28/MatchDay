// MatchDay — browser push subscription.
//
// The client half of push notifications. The server half is the
// notify-dispatch Edge Function; the storage is `push_subscriptions`
// (migration 011).
//
// This is honest about being inert without configuration: if no VAPID public
// key is set, isPushConfigured() returns false and the UI says push is
// unavailable rather than showing a toggle that silently does nothing.
//
// Set VITE_VAPID_PUBLIC_KEY in .env to the PUBLIC half of the VAPID pair.
// (The private half is a Supabase secret and must never appear here — it is
// what proves the server is allowed to push to a device.)

import { supabase } from "./supabaseClient";

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || "";

export function isPushSupported() {
  return typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;
}

export function isPushConfigured() {
  return !!VAPID_PUBLIC_KEY;
}

export function pushPermission() {
  if (!isPushSupported()) return "unsupported";
  return Notification.permission; // "default" | "granted" | "denied"
}

// VAPID keys are base64url; the browser wants a Uint8Array.
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function registration() {
  return navigator.serviceWorker.register("/sw.js");
}

/**
 * Ask for permission, subscribe, and store the subscription.
 *
 * Returns { ok, reason } rather than throwing, because every failure here is
 * a thing the UI has to explain: the browser does not support it, the user
 * said no, or push is not configured on this deployment.
 */
export async function enablePush() {
  if (!isPushSupported()) return { ok: false, reason: "This browser does not support push notifications." };
  if (!isPushConfigured()) return { ok: false, reason: "Push is not configured on this deployment yet." };

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return {
      ok: false,
      reason: permission === "denied"
        // Once denied, the site cannot ask again — only the user can undo it.
        ? "Notifications are blocked for this site. Enable them in your browser settings to turn this on."
        : "Notification permission was not granted.",
    };
  }

  const reg = await registration();
  const existing = await reg.pushManager.getSubscription();
  const sub = existing || await reg.pushManager.subscribe({
    userVisibleOnly: true, // required by Chrome; we never push silently
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });

  const json = sub.toJSON();
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;
  if (!userId) return { ok: false, reason: "Sign in before enabling push notifications." };

  // Upsert on endpoint: the same device re-subscribing must update its row,
  // not accumulate a new one on every visit.
  const { error } = await supabase.from("push_subscriptions").upsert({
    user_id: userId,
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
    user_agent: navigator.userAgent.slice(0, 300),
    last_seen_at: new Date().toISOString(),
  }, { onConflict: "endpoint" });
  if (error) return { ok: false, reason: error.message };

  await supabase.from("notification_preferences")
    .upsert({ user_id: userId, push: true, updated_at: new Date().toISOString() }, { onConflict: "user_id" });

  return { ok: true };
}

/** Unsubscribe this device and stop pushing to it. */
export async function disablePush() {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;

  if (isPushSupported()) {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
      await sub.unsubscribe();
    }
  }

  // Turn the preference off too, otherwise the next device to be added would
  // silently inherit "push: true" from a device that is no longer subscribed.
  if (userId) {
    await supabase.from("notification_preferences")
      .upsert({ user_id: userId, push: false, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  }
  return { ok: true };
}

/** Is THIS device currently subscribed? Preferences are per account, not per device. */
export async function isThisDeviceSubscribed() {
  if (!isPushSupported() || Notification.permission !== "granted") return false;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    return !!(await reg?.pushManager.getSubscription());
  } catch {
    return false;
  }
}
