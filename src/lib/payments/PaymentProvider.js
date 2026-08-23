// MatchDay — payment provider boundary.
//
// Every payment provider implements this same shape so the rest of the app
// (registration, entry status) never needs to know which one is active.
// Nothing in this file talks to a network — it's the contract only.
//
//   createOrder({ entryId, amountINR }) -> { orderId, providerData }
//     Starts a payment. For Razorpay this must run server-side (an Edge
//     Function), never in the browser, because creating an order requires
//     the provider's secret key.
//
//   verifyPayment({ orderId, providerPaymentId, signature }) -> boolean
//     Confirms a payment actually succeeded. For Razorpay this is a webhook
//     signature check using HMAC-SHA256 with the webhook secret — again,
//     server-side only.
//
//   refund({ providerPaymentId, amountINR }) -> { refundId }
//
// See RazorpayProvider.js for exactly what's implemented vs. what needs a
// production Supabase Edge Function.
export class PaymentProvider {
  async createOrder(_args) { throw new Error("createOrder() not implemented"); }
  async verifyPayment(_args) { throw new Error("verifyPayment() not implemented"); }
  async refund(_args) { throw new Error("refund() not implemented"); }
}
