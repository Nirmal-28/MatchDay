// Supabase Edge Function — razorpay-create-order
// NOT DEPLOYED. Skeleton only: shows exactly what production wiring needs.
//
// Deploy with: supabase functions deploy razorpay-create-order
// Required secrets (supabase secrets set ...):
//   RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, SUPABASE_SERVICE_ROLE_KEY
//
// Called by the browser with { entryId, amountINR }. Returns { orderId, keyId }.
// The service_role key and Razorpay secret never leave this function.

import { createClient } from "jsr:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const { entryId, amountINR } = await req.json();

  const keyId = Deno.env.get("RAZORPAY_KEY_ID");
  const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET");
  if (!keyId || !keySecret) {
    return new Response(JSON.stringify({ error: "Razorpay is not configured on this project." }), { status: 500 });
  }

  // 1. Create the order with Razorpay.
  const auth = btoa(`${keyId}:${keySecret}`);
  const orderRes = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify({ amount: Math.round(amountINR * 100), currency: "INR", receipt: entryId }),
  });
  if (!orderRes.ok) return new Response(JSON.stringify({ error: "Razorpay order creation failed." }), { status: 502 });
  const order = await orderRes.json();

  // 2. Record the pending payment using the service_role key (bypasses RLS
  //    deliberately — this function IS the trusted server boundary).
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  await supabase.from("payments").insert({
    entry_id: entryId, provider: "RAZORPAY", provider_order_id: order.id,
    amount_inr: amountINR, status: "PENDING", raw_response: order,
  });

  return new Response(JSON.stringify({ orderId: order.id, keyId }), {
    headers: { "Content-Type": "application/json" },
  });
});
