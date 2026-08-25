# Going live — integration runbook

Step-by-step for the four external integrations. Every secret name, function
name and file path below was read out of the actual code in this repo, not
recalled from memory — if something here disagrees with the code, the code is
right and this file is stale.

**Project ref:** `dkkpolnuywgvmlacjzto` (ap-south-1)

Prerequisites for everything below:

```bash
npm i -g supabase
supabase login
supabase link --project-ref dkkpolnuywgvmlacjzto
```

A note on where secrets go. There are three different places and mixing them
up is the most common way to leak a key:

| Where | Who can read it | What belongs there |
|---|---|---|
| `.env` → `VITE_*` | **Everyone.** Compiled into the browser bundle. | Publishable keys only. |
| `supabase secrets set` | Edge Functions only. | Every real secret. |
| `alter database ... set` | Postgres only. | The service-role key used by the dispatch trigger. |

Nothing that is not safe on a billboard may ever have a `VITE_` prefix.

---

## 1. Payments (Razorpay)

### Read this first

The Edge Functions are written and the provider boundary exists, but **there
is currently no client call site**: nothing in `src/` constructs a
`RazorpayProvider` or a `MockPaymentProvider`. Today, money is handled
entirely by the organizer marking an entry paid by hand
(`recordOfflinePayment`, wired in the control center's participants tab).

So "deploy the functions" is **not** sufficient to turn payments on. There is
UI work after step 5, and it is the larger half of the job.

### 1.1 Create the account

1. Sign up at dashboard.razorpay.com and complete KYC (needs PAN, bank
   account, business proof — allow several days for activation).
2. Start in **Test mode**. You get `rzp_test_...` keys; use these for the
   whole of steps 2–6 and only switch to live keys at step 7.
3. Settings → API Keys → Generate. You see the secret **once** — store it now.

### 1.2 Set the function secrets

```bash
supabase secrets set \
  RAZORPAY_KEY_ID=rzp_test_xxxxxxxx \
  RAZORPAY_KEY_SECRET=xxxxxxxxxxxxx
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected into every Edge
Function automatically — do not set them yourself.

### 1.3 Deploy both functions

```bash
supabase functions deploy razorpay-create-order
supabase functions deploy razorpay-webhook --no-verify-jwt
```

`--no-verify-jwt` on the webhook is required and is not a weakening: Razorpay
calls it server-to-server with no user JWT. Its authentication is the HMAC
signature check inside the function, which is why step 1.4 is mandatory
rather than optional.

### 1.4 Register the webhook

1. Razorpay Dashboard → Settings → Webhooks → Add New.
2. URL: `https://dkkpolnuywgvmlacjzto.supabase.co/functions/v1/razorpay-webhook`
3. Active events: `payment.captured`, `payment.failed`, `refund.processed`.
4. Set a webhook secret (any long random string), then:

```bash
supabase secrets set RAZORPAY_WEBHOOK_SECRET=<the same string>
```

If these two strings ever differ, every webhook fails signature verification
and no payment is ever marked paid. That is the correct failure direction,
but check it first when payments appear to hang.

### 1.5 The rule that must not be broken

> `entries.payment_status` may only ever be set to `PAID` by the webhook.

Never from the browser, and never optimistically after Checkout closes. A
client that can mark its own entry paid is a free-entry button. The browser's
job ends at "Checkout closed"; the entry flips to PAID when the webhook lands,
and the UI should reflect that by subscribing to the row.

Verify the rule holds before launch: sign in as an ordinary player and try

```js
await supabase.from("entries").update({ payment_status: "PAID" }).eq("id", "<your entry>");
```

It must fail on RLS. If it succeeds, stop and fix the policy.

### 1.6 The client work that remains

1. Instantiate a provider (Razorpay when `VITE_RAZORPAY_KEY_ID` is set,
   otherwise Mock) and expose it where the registration flow completes.
2. Load Razorpay's `checkout.js`, call `createOrder({ entryId, amountINR })`,
   and open Checkout with the returned `orderId` / `keyId`.
3. On close, show "confirming payment" and **subscribe to the entry row**
   rather than assuming success.
4. Remove the "payments are simulated" line in `src/App.jsx` only once a real
   payment has actually completed end to end.

### 1.7 Test, then go live

Use Razorpay's test cards (`4111 1111 1111 1111`, any future expiry, any CVV).
Confirm: order created → Checkout completes → webhook received → row flips to
PAID. Then regenerate live-mode keys, re-run `supabase secrets set`, re-point
the webhook at the same URL from the live-mode dashboard, and re-test with a
real ₹1 payment you refund.

---

## 2. Email / SMS / Push

`notify-dispatch` is complete and handles all three channels. Each activates
only when its own secret is present and reports `skipped` otherwise, so you
can turn them on one at a time.

Secrets the function reads (from its source):
`RESEND_API_KEY`, `NOTIFY_FROM_EMAIL`, `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID`,
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `SITE_URL`.

### 2.1 Email (Resend)

1. resend.com → add your sending domain → add the DKIM/SPF DNS records they
   give you → wait for **Verified**. Sending before verification lands you in
   spam and hurts the domain's reputation for a long time afterwards.
2. Create an API key.

```bash
supabase secrets set \
  RESEND_API_KEY=re_xxxxxxxx \
  NOTIFY_FROM_EMAIL="MatchDay <noreply@yourdomain.com>" \
  SITE_URL=https://matchday-tournaments.vercel.app
```

`NOTIFY_FROM_EMAIL` must be on the verified domain.

### 2.2 SMS (MSG91 — India)

Indian SMS is template-gated by TRAI/DLT. You cannot send arbitrary text.

1. Register as a Principal Entity on a DLT portal (Jio/Airtel/Vodafone) — needs
   GST and business documents.
2. Register your sender ID (6 characters) and your message templates. Approval
   takes days; templates must match what you send **character for character**,
   with variables in `##VAR##` form.
3. MSG91 → link the DLT entity → get the auth key and the flow/template id.

```bash
supabase secrets set MSG91_AUTH_KEY=xxxxx MSG91_TEMPLATE_ID=xxxxx
```

Budget one to two weeks for DLT. Start it early; it is the long pole of the
whole launch.

### 2.3 Push (Web Push / VAPID)

```bash
npx web-push generate-vapid-keys
```

```bash
supabase secrets set \
  VAPID_PUBLIC_KEY=<public> \
  VAPID_PRIVATE_KEY=<private> \
  VAPID_SUBJECT=mailto:you@yourdomain.com
```

Then add the **public** half to the frontend — this one is genuinely public,
it is meant to ship in the bundle:

```
VITE_VAPID_PUBLIC_KEY=<public>
```

Set it in Vercel → Project → Settings → Environment Variables, and redeploy.
Until you do, the push toggle in profile settings says it is unavailable
rather than silently doing nothing.

`public/sw.js` is already a working service worker and `src/lib/push.js`
already handles subscription. Push needs HTTPS — it will not work on
`http://localhost` except in Chrome's localhost exemption.

### 2.4 Deploy and arm the trigger

```bash
supabase functions deploy notify-dispatch
```

Test it in isolation before arming anything:

```bash
supabase functions invoke notify-dispatch --body '{"notification_id":"<a real id>"}'
```

Then arm the trigger. The SQL is at the bottom of
`migrations/011_notification_delivery.sql`, commented out. Run it in the SQL
editor **in this order**:

```sql
create extension if not exists pg_net;

-- The dispatch trigger authenticates to the Edge Function with this. It lives
-- in database settings, never in a table and never in a client.
alter database postgres set app.service_role_key = '<SERVICE_ROLE_KEY>';
```

…then the `trg_dispatch_notification()` function and `trg_notify_dispatch`
trigger exactly as written in that file.

The `net.http_post` call is deliberately fire-and-forget: it queues the request
and returns, so a slow or failing provider can never block or roll back the
database write that triggered it.

### 2.5 Verify

Cause a real notification (change a match time on a test tournament) and check
`notification_deliveries` for per-channel results. A channel with no secret
must read `skipped`, not `failed` — if you see `failed`, the secret is present
but wrong.

---

## 3. Staff invitation emails

Today: invites are stored in `tournament_invites` and auto-convert to a real
role via `claim_my_invites()` when that person signs in with the same address.
The organizer sends the sign-in link themselves. **This works** — it is
manual, not broken.

To automate it you need a new Edge Function, because resolving an email to a
user id requires the admin API and the `service_role` key, which must never
run client-side.

1. Create `supabase-integration/edge-functions/invite-staff/index.ts`.
2. It should: verify the caller is an OWNER/ORGANIZER of that tournament (do
   not trust a tournament id from the body), insert the invite, then send the
   mail through Resend using the same setup as §2.1.
3. Deploy with `supabase functions deploy invite-staff` (JWT verification
   **on** — unlike the Razorpay webhook, this one is called by a signed-in
   user and must stay authenticated).

The security requirement: an organizer of tournament A must not be able to
invite anyone to tournament B. Check the caller's role against the tournament
inside the function, on the server.

---

## 4. WhatsApp

Not implemented at all — no boundary, no stub. It is a genuine build, not a
configuration step.

1. Meta Business verification, then a WhatsApp Business API account (via a BSP
   such as Gupshup, Twilio or 360dialog — or Meta Cloud API directly).
2. Register a sender number that is **not** in use on the consumer WhatsApp app.
3. Submit message templates for approval. Outside a 24-hour customer-service
   window you may only send approved templates, which is exactly the case for
   tournament notifications.
4. Add a `whatsapp` channel to `notify-dispatch` alongside email/SMS/push,
   following the same contract: report `skipped` when unconfigured, never
   claim to have sent.

Realistically several weeks. Do it last — SMS already covers the same need for
Indian users.

---

## Launch order

1. **Clean the test tournaments.** 16 of 23 published tournaments are
   `AUDIT CUP …` / `E2E DEBUG …` and are visible on the public homepage.
2. Enable leaked-password protection (Auth → Policies).
3. Record migrations 010–013 in the ledger — they are applied, but the
   `supabase_migrations` table stops at 009, so the next person will get this
   wrong.
4. Email (fastest real win).
5. Push.
6. Razorpay — functions **and** the client work in §1.6.
7. SMS — but start DLT registration at step 1, since it gates everything.
8. WhatsApp, if still wanted.
