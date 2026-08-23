import { PaymentProvider } from "./PaymentProvider";
import { supabase } from "../supabaseClient";

// Development/demo provider. Writes directly to `payments` and `entries`
// from the browser — fine because it's explicitly fake money, but this is
// exactly the shortcut RazorpayProvider must NOT take (see its file header).
export class MockPaymentProvider extends PaymentProvider {
  async createOrder({ entryId, amountINR }) {
    const { data, error } = await supabase.from("payments").insert({
      entry_id: entryId, provider: "MOCK", amount_inr: amountINR, status: "PENDING",
    }).select().single();
    if (error) throw error;
    return { orderId: data.id, providerData: null };
  }

  // succeeded=false lets the dev UI simulate a failed payment too.
  async simulateOutcome(orderId, succeeded = true) {
    const status = succeeded ? "PAID" : "FAILED";
    const { data: payment, error } = await supabase.from("payments")
      .update({ status, updated_at: new Date().toISOString() }).eq("id", orderId).select().single();
    if (error) throw error;
    const patch = succeeded ? { payment_status: "PAID", reg_status: "CONFIRMED" } : { payment_status: "FAILED" };
    await supabase.from("entries").update(patch).eq("id", payment.entry_id);
    return payment;
  }

  async verifyPayment() { return true; } // trivially true — there's no real gateway to verify against
  async refund({ providerPaymentId }) {
    await supabase.from("payments").update({ status: "REFUNDED" }).eq("id", providerPaymentId);
    return { refundId: `mock-refund-${providerPaymentId}` };
  }
}
