import { PaymentProvider } from "./PaymentProvider";

// Production Razorpay boundary. NOT CONNECTED — there is no Razorpay account
// wired up in this environment. This class defines exactly what a real
// integration must do, and is safe to ship as-is: it makes no network calls
// with secrets, because it makes none at all yet.
//
// ── What's needed to go live ────────────────────────────────────────────
// 1. A Razorpay account, with RAZORPAY_KEY_ID (public, safe in the browser)
//    and RAZORPAY_KEY_SECRET (server-side only — NEVER in frontend code).
// 2. A Supabase Edge Function (e.g. `razorpay-create-order`) that:
//      - receives { entryId, amountINR } from the browser
//      - calls Razorpay's Orders API with the secret key
//      - inserts a `payments` row (provider='RAZORPAY', status='PENDING')
//        using the service_role key (server-side only)
//      - returns { orderId, keyId } to the browser
// 3. The browser loads Razorpay's Checkout.js with that orderId + keyId and
//    opens the payment sheet — this part IS safe client-side (no secrets).
// 4. A second Edge Function (`razorpay-webhook`) that Razorpay calls
//    directly (not the browser) on payment success/failure:
//      - verifies the webhook signature with RAZORPAY_WEBHOOK_SECRET
//        (HMAC-SHA256 over the raw request body)
//      - updates `payments.status` and `entries.payment_status` using the
//        service_role key — this is the ONLY place payment_status may ever
//        be set to PAID in production; the browser must never set it
//        directly (see MockPaymentProvider, which is explicitly the dev
//        shortcut this replaces).
// 5. Refunds go through the Razorpay Refunds API from a third Edge Function
//    (`razorpay-refund`), again server-side only.
//
// A skeleton for both edge functions lives in
// supabase-integration/edge-functions/ — copy them into a real Supabase
// project with `supabase functions deploy` once the account exists.
export class RazorpayProvider extends PaymentProvider {
  async createOrder({ entryId, amountINR }) {
    const res = await fetch("/functions/v1/razorpay-create-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entryId, amountINR }),
    });
    if (!res.ok) throw new Error("Could not start payment. Please try again.");
    return res.json(); // { orderId, keyId }
  }

  // Verification happens server-side via the webhook (step 4 above) — the
  // browser never verifies its own payment. This method exists only so
  // callers can await *something* after Checkout.js closes; real status
  // comes from the entries row once the webhook lands (subscribe/poll it).
  async verifyPayment() {
    throw new Error("RazorpayProvider.verifyPayment() runs server-side via webhook — see file header.");
  }

  async refund() {
    throw new Error("RazorpayProvider.refund() requires the razorpay-refund Edge Function — see file header.");
  }
}
