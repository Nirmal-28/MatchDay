// Supabase Edge Function — notify-dispatch
//
// Fans a `notifications` row out to the channels that are actually
// configured. This is the server-side half that src/lib/notifications/
// describes but could not contain: every provider here needs an API key, and
// an API key must never reach the browser.
//
// ── Status ──────────────────────────────────────────────────────────────
// The code is complete. Each channel activates ONLY when its secret is set,
// and reports honestly when it is not. With no secrets set, this function
// deploys and runs and delivers nothing — which is exactly the current
// behaviour, made explicit rather than silent.
//
// ── Deploy ──────────────────────────────────────────────────────────────
//   supabase functions deploy notify-dispatch
//
// Then set only the channels you want:
//   supabase secrets set RESEND_API_KEY=...        NOTIFY_FROM_EMAIL="MatchDay <noreply@yourdomain>"
//   supabase secrets set MSG91_AUTH_KEY=...        MSG91_SENDER_ID=...  MSG91_TEMPLATE_ID=...
//   supabase secrets set VAPID_PUBLIC_KEY=...      VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@domain
//
// ── Trigger it ──────────────────────────────────────────────────────────
// Add this to the database once the function is deployed (needs pg_net):
//
//   create extension if not exists pg_net;
//   create or replace function public.trg_dispatch_notification()
//   returns trigger language plpgsql security definer as $$
//   begin
//     perform net.http_post(
//       url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/notify-dispatch',
//       headers := jsonb_build_object(
//         'Content-Type', 'application/json',
//         'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
//       ),
//       body    := jsonb_build_object('notification_id', new.id)
//     );
//     return new;
//   end $$;
//   create trigger trg_notify_dispatch after insert on public.notifications
//     for each row execute function public.trg_dispatch_notification();
//
// Store the key with:  alter database postgres set app.service_role_key = '...';
// (It lives in database settings, not in any table and not in any client.)

import { createClient } from "jsr:@supabase/supabase-js@2";

type Notification = {
  id: string;
  user_id: string | null;
  type: string;
  title: string | null;
  message: string;
  link: string | null;
  tournament_id: string | null;
};

type Result = { channel: string; status: "sent" | "skipped" | "failed"; detail?: string };

const SITE_URL = Deno.env.get("SITE_URL") ?? "https://matchday.app";

/* ------------------------------- EMAIL ---------------------------------- */
// Resend. Swap the fetch for Postmark/SES if you prefer — the shape is the same.
async function sendEmail(to: string, n: Notification): Promise<Result> {
  const key = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("NOTIFY_FROM_EMAIL");
  if (!key || !from) return { channel: "email", status: "skipped", detail: "RESEND_API_KEY/NOTIFY_FROM_EMAIL not set" };

  const link = n.link ? `${SITE_URL}${n.link}` : SITE_URL;
  const subject = n.title || "MatchDay update";

  // Plain, transactional, no tracking pixels. Escaped because tournament and
  // player names are user-supplied.
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `<div style="font-family:system-ui,sans-serif;max-width:520px">
  <h2 style="margin:0 0 8px">${esc(subject)}</h2>
  <p style="margin:0 0 16px;color:#444">${esc(n.message)}</p>
  <p><a href="${esc(link)}" style="background:#0d9488;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Open MatchDay</a></p>
</div>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, html, text: `${n.message}\n\n${link}` }),
  });
  if (!res.ok) return { channel: "email", status: "failed", detail: `${res.status} ${await res.text()}` };
  return { channel: "email", status: "sent" };
}

/* -------------------------------- SMS ----------------------------------- */
// MSG91, because Indian transactional SMS requires DLT-registered templates
// and a sender id — you cannot send arbitrary text. TEMPLATE_ID must be an
// approved template whose variables match the payload below.
async function sendSms(phone: string, n: Notification): Promise<Result> {
  const key = Deno.env.get("MSG91_AUTH_KEY");
  const template = Deno.env.get("MSG91_TEMPLATE_ID");
  if (!key || !template) return { channel: "sms", status: "skipped", detail: "MSG91_AUTH_KEY/MSG91_TEMPLATE_ID not set" };

  const to = phone.replace(/\D/g, "").slice(-10);
  if (to.length !== 10) return { channel: "sms", status: "skipped", detail: "no valid mobile number" };

  const res = await fetch("https://control.msg91.com/api/v5/flow/", {
    method: "POST",
    headers: { authkey: key, "Content-Type": "application/json" },
    body: JSON.stringify({
      template_id: template,
      recipients: [{ mobiles: `91${to}`, MESSAGE: n.message.slice(0, 140) }],
    }),
  });
  if (!res.ok) return { channel: "sms", status: "failed", detail: `${res.status} ${await res.text()}` };
  return { channel: "sms", status: "sent" };
}

/* -------------------------------- PUSH ---------------------------------- */
// Web Push needs a signed VAPID JWT per endpoint origin plus encrypted
// payloads. Rather than hand-roll the crypto, this uses the standard library.
async function sendPush(
  subscriptions: Array<{ id: string; endpoint: string; p256dh: string; auth: string }>,
  n: Notification,
  supabase: ReturnType<typeof createClient>,
): Promise<Result> {
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const subject = Deno.env.get("VAPID_SUBJECT");
  if (!publicKey || !privateKey || !subject) {
    return { channel: "push", status: "skipped", detail: "VAPID keys not set" };
  }
  if (!subscriptions.length) return { channel: "push", status: "skipped", detail: "no registered devices" };

  const webpush = await import("npm:web-push@3.6.7");
  webpush.default.setVapidDetails(subject, publicKey, privateKey);

  const payload = JSON.stringify({
    title: n.title || "MatchDay",
    body: n.message,
    url: n.link ? `${SITE_URL}${n.link}` : SITE_URL,
  });

  let sent = 0;
  for (const sub of subscriptions) {
    try {
      await webpush.default.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
      );
      sent++;
    } catch (err) {
      // 404/410 means the browser threw the subscription away — delete it
      // rather than retrying it forever.
      const status = (err as { statusCode?: number })?.statusCode;
      if (status === 404 || status === 410) {
        await supabase.from("push_subscriptions").delete().eq("id", sub.id);
      }
    }
  }
  return { channel: "push", status: sent ? "sent" : "failed", detail: `${sent}/${subscriptions.length} devices` };
}

/* ------------------------------ HANDLER --------------------------------- */

Deno.serve(async (req) => {
  // Called by the database trigger with the service_role key, never by a
  // browser. Anything without it is refused.
  const auth = req.headers.get("Authorization") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (auth !== `Bearer ${serviceKey}`) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }

  const { notification_id } = await req.json();
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

  const { data: n } = await supabase
    .from("notifications").select("*").eq("id", notification_id).single();
  if (!n) return new Response(JSON.stringify({ error: "not found" }), { status: 404 });

  const notification = n as Notification;
  if (!notification.user_id) {
    // Tournament-scoped notices with no recipient are in-app only by design.
    return new Response(JSON.stringify({ results: [{ channel: "in_app", status: "sent" }] }), { status: 200 });
  }

  // Per-user preferences. A row that does not exist means defaults: in-app
  // and email on, SMS and push off — nobody is opted in to a channel they
  // never asked for.
  const { data: prefs } = await supabase
    .from("notification_preferences").select("*").eq("user_id", notification.user_id).maybeSingle();

  const wants = {
    email: prefs?.email ?? true,
    sms: prefs?.sms ?? false,
    push: prefs?.push ?? false,
  };

  const { data: player } = await supabase
    .from("players").select("email, phone").eq("user_id", notification.user_id).maybeSingle();

  // The account email is authoritative; the player row is the fallback.
  const { data: authUser } = await supabase.auth.admin.getUserById(notification.user_id);
  const email = authUser?.user?.email || player?.email || null;

  const { data: subs } = await supabase
    .from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", notification.user_id);

  const results: Result[] = [{ channel: "in_app", status: "sent" }];

  if (wants.email && email) results.push(await sendEmail(email, notification).catch((e) => ({ channel: "email", status: "failed" as const, detail: String(e) })));
  if (wants.sms && player?.phone) results.push(await sendSms(player.phone, notification).catch((e) => ({ channel: "sms", status: "failed" as const, detail: String(e) })));
  if (wants.push) results.push(await sendPush(subs ?? [], notification, supabase).catch((e) => ({ channel: "push", status: "failed" as const, detail: String(e) })));

  // Record what actually happened, so "did they get told?" has an answer.
  await supabase.from("notifications")
    .update({ delivery: results, dispatched_at: new Date().toISOString() })
    .eq("id", notification.id);

  return new Response(JSON.stringify({ results }), {
    headers: { "Content-Type": "application/json" },
  });
});
