/* MatchDay service worker.
 *
 * Deliberately minimal. It does exactly two things:
 *   1. receives web push messages and shows them
 *   2. focuses (or opens) the right page when one is clicked
 *
 * It does NOT cache the app. Offline caching of a live scoreboard is worse
 * than useless — a cached bracket that looks current but is an hour old is
 * exactly the failure this product cannot afford. Scoring resilience is
 * handled properly in src/lib/offlineQueue.js, which queues writes rather
 * than pretending stale reads are fresh.
 */

self.addEventListener("install", (event) => {
  // Take over immediately rather than waiting for every tab to close, so a
  // deploy does not leave two versions running against one database.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "MatchDay", body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "MatchDay";
  const options = {
    body: payload.body || "",
    icon: "/logo.png",
    badge: "/logo.png",
    // Collapse repeat notifications about the same match instead of stacking
    // twelve of them on the lock screen during a close game.
    tag: payload.tag || payload.url || "matchday",
    renotify: false,
    data: { url: payload.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // Reuse an open tab if there is one — opening a fourth MatchDay tab is
      // not what someone tapping a match notification wants.
      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate?.(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
