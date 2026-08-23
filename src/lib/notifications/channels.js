import { NotificationChannel } from "./NotificationChannel";

// The only channel that actually delivers today. It is a no-op at this layer
// on purpose: the notification row already exists by the time anything here
// could run, because it was written by the database trigger that made the
// change. Kept in the registry so "where will this reach me?" has a truthful
// connected entry rather than an empty list.
export class InAppChannel extends NotificationChannel {
  get key() { return "in_app"; }
  get label() { return "In-app"; }
  isConnected() { return true; }
  async deliver() { return { delivered: true, via: "database trigger" }; }
}

// ── Not connected ────────────────────────────────────────────────────────
// Each of these needs (a) a provider account, (b) the credential stored as a
// Supabase secret, and (c) a `notify-dispatch` Edge Function triggered by an
// INSERT on `notifications` that fans the row out to the enabled channels.
// None of that exists in this environment, so each one refuses rather than
// silently swallowing the call and letting the UI claim it sent something.

class UnconnectedChannel extends NotificationChannel {
  constructor(key, label, requirement) {
    super();
    this._key = key; this._label = label; this.requirement = requirement;
  }
  get key() { return this._key; }
  get label() { return this._label; }
  isConnected() { return false; }
  async deliver() {
    throw new Error(`${this._label} is not connected. Required: ${this.requirement}`);
  }
}

export class EmailChannel extends UnconnectedChannel {
  constructor() {
    super("email", "Email", "a transactional email provider (Resend/Postmark/SES) plus a notify-dispatch Edge Function");
  }
}

export class SmsChannel extends UnconnectedChannel {
  constructor() {
    super("sms", "SMS", "an Indian SMS gateway with DLT-registered templates (MSG91/Twilio) plus a notify-dispatch Edge Function");
  }
}

export class WhatsAppChannel extends UnconnectedChannel {
  constructor() {
    super("whatsapp", "WhatsApp", "a WhatsApp Business API account with approved message templates plus a notify-dispatch Edge Function");
  }
}

export class PushChannel extends UnconnectedChannel {
  constructor() {
    super("push", "Push", "a service worker, VAPID keys, and stored push subscriptions per device");
  }
}

// What the product supports right now, in the order the UI should show it.
export const CHANNELS = [
  new InAppChannel(),
  new EmailChannel(),
  new SmsChannel(),
  new WhatsAppChannel(),
  new PushChannel(),
];
