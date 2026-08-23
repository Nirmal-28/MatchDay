// MatchDay — notification delivery boundary.
//
// In-app notifications are REAL and live: Postgres triggers (migration 008)
// insert `notifications` rows on the same statements that change a
// tournament, and the UI reads them back over RLS + realtime.
//
// Every OTHER channel — email, SMS, WhatsApp, push — is deliberately NOT
// connected. Each needs a provider account and a server-side sender (an Edge
// Function holding the API key; none of these keys may ever reach the
// browser). This file defines the shape such a sender must implement so the
// rest of the app never has to know which one is active, exactly the way
// PaymentProvider does for payments.
//
//   deliver({ userId, type, title, message, link, tournamentId }) -> Promise
//
// A channel reports isConnected() so the UI can tell a user the truth about
// where a notification will actually reach them, instead of implying an SMS
// went out when nothing did.
export class NotificationChannel {
  get key() { return "abstract"; }
  get label() { return "Abstract channel"; }
  isConnected() { return false; }
  async deliver(_notification) {
    throw new Error(`${this.label} is not connected.`);
  }
}

// Registry the UI reads to describe delivery honestly.
export function channelStatus(channels) {
  return channels.map((c) => ({ key: c.key, label: c.label, connected: c.isConnected() }));
}
