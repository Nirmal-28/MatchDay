import { MockPaymentProvider } from "./MockPaymentProvider";
import { RazorpayProvider } from "./RazorpayProvider";
import { supabase } from "../supabaseClient";

/* ═══════════════════════════════════════════════════════════════════════
   PAYMENTS — provider selection and the one safe way to pay
   ═══════════════════════════════════════════════════════════════════════

   This module is the missing half of the payment feature. The provider
   classes and the Edge Functions already existed, but nothing in the app
   ever constructed a provider, so there was no way for a player to pay at
   all — an organizer marked entries paid by hand.

   HOW THE SWITCH WORKS

   Exactly one environment variable decides everything:

     VITE_RAZORPAY_KEY_ID unset  ->  MockPaymentProvider, and the UI says
                                     plainly that payment is simulated.
     VITE_RAZORPAY_KEY_ID set    ->  RazorpayProvider, real money.

   That key is Razorpay's *publishable* key id (`rzp_live_…`), which is
   designed to ship in a browser bundle. The secret half never leaves the
   Edge Function. Nothing here can move money on its own: `createOrder`
   goes to the server, and the amount is re-derived there from the entry
   rather than trusted from this client.

   THE RULE THIS FILE EXISTS TO PROTECT

       entries.payment_status may only ever become PAID because the
       webhook said so.

   So `pay()` deliberately has no success path that writes to `entries`.
   When Checkout closes it does not know, and does not claim to know,
   whether the payment worked — it watches the row and reports whatever
   the server eventually says. A client that marks its own entry paid is a
   free-entry button, and "the modal closed" is not evidence of payment:
   a user can close it, a card can fail after authorisation, a network can
   drop between capture and redirect.

   The mock provider is the one exception, and only because it is
   explicitly fake money end to end.
   ══════════════════════════════════════════════════════════════════════ */

const RAZORPAY_KEY_ID = import.meta.env.VITE_RAZORPAY_KEY_ID || "";
const CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

// True when real payments are configured. The UI reads this to decide
// whether to say "simulated" — never to decide whether someone owes money.
export const paymentsAreLive = () => Boolean(RAZORPAY_KEY_ID);

let provider = null;
export function paymentProvider() {
  if (!provider) {
    provider = paymentsAreLive() ? new RazorpayProvider() : new MockPaymentProvider();
  }
  return provider;
}

// Razorpay's Checkout script, loaded on demand rather than in index.html:
// most visitors never pay for anything, and this keeps ~50KB of third-party
// JavaScript off every page load — including the public tournament pages
// that are shared most widely.
let checkoutPromise = null;
function loadCheckout() {
  if (window.Razorpay) return Promise.resolve();
  if (checkoutPromise) return checkoutPromise;
  checkoutPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = CHECKOUT_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      checkoutPromise = null; // allow a retry after a flaky network
      reject(new Error("Could not load the payment window. Check your connection and try again."));
    };
    document.head.appendChild(s);
  });
  return checkoutPromise;
}

/* Waits for the server to confirm the entry is paid.

   Realtime first, because the webhook usually lands within a second or two
   and a subscription reports it immediately. The poll is not redundant: a
   websocket can be blocked by a corporate proxy or dropped on a phone
   switching networks, and "your payment worked but we never told you" is
   the worst possible outcome here. Whichever answers first wins.

   Resolves "paid" / "failed" / "timeout". A timeout is NOT a failure — the
   payment may still be in flight, so the caller must say so honestly
   rather than telling someone their money did not go through. */
function awaitPaymentResult(entryId, { timeoutMs = 90_000 } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearInterval(poll);
      clearTimeout(timer);
      supabase.removeChannel(channel);
      resolve(result);
    };

    const readRow = (row) => {
      if (!row) return;
      if (row.payment_status === "PAID") finish("paid");
      else if (row.payment_status === "FAILED") finish("failed");
    };

    const channel = supabase
      .channel(`pay-${entryId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "entries", filter: `id=eq.${entryId}` },
        (payload) => readRow(payload.new)
      )
      .subscribe();

    const poll = setInterval(async () => {
      const { data } = await supabase
        .from("entries").select("payment_status").eq("id", entryId).maybeSingle();
      readRow(data);
    }, 3000);

    const timer = setTimeout(() => finish("timeout"), timeoutMs);
  });
}

/**
 * Take payment for one entry.
 *
 * @param {object}   entry     the entry row being paid for
 * @param {number}   amountINR fee in rupees (display only — the server
 *                             re-derives the real amount from the entry)
 * @param {object}   player    { name, email, phone } to prefill Checkout
 * @returns {Promise<"paid"|"failed"|"timeout"|"dismissed">}
 */
export async function pay({ entry, amountINR, player = {} }) {
  const p = paymentProvider();

  // Mock: fake money, so it may settle itself. This is the branch that runs
  // until a Razorpay key is configured.
  if (!paymentsAreLive()) {
    const { orderId } = await p.createOrder({ entryId: entry.id, amountINR });
    await p.simulateOutcome(orderId, true);
    return "paid";
  }

  const { orderId, keyId } = await p.createOrder({ entryId: entry.id, amountINR });
  await loadCheckout();

  const dismissed = await new Promise((resolve) => {
    const rzp = new window.Razorpay({
      key: keyId || RAZORPAY_KEY_ID,
      order_id: orderId,
      name: "MatchDay",
      description: "Tournament entry fee",
      prefill: { name: player.name || "", email: player.email || "", contact: player.phone || "" },
      theme: { color: "#16c5b0" },
      // Note there is no success handler that marks the entry paid. Both
      // paths below only stop blocking the UI; the verdict comes from the
      // row, which only the webhook can change.
      handler: () => resolve(false),
      modal: { ondismiss: () => resolve(true) },
    });
    rzp.on("payment.failed", () => resolve(false));
    rzp.open();
  });

  // A dismissed modal still needs a short watch: Razorpay can capture a
  // payment and then have the window closed before the handler fires.
  return awaitPaymentResult(entry.id, { timeoutMs: dismissed ? 15_000 : 90_000 });
}
