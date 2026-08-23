// Supabase Edge Function — razorpay-webhook
// NOT DEPLOYED. Skeleton only: shows exactly what production wiring needs.
//
// Deploy with: supabase functions deploy razorpay-webhook --no-verify-jwt
// (--no-verify-jwt because Razorpay calls this directly, not through a
// logged-in Supabase session — the HMAC signature check below is what
// actually authenticates the request instead.)
//
// Required secrets: RAZORPAY_WEBHOOK_SECRET, SUPABASE_SERVICE_ROLE_KEY
// Configure this URL as the webhook endpoint in the Razorpay dashboard,
// subscribed to payment.captured and payment.failed events.
//
// This is the ONLY place payment_status may be set to PAID in production —
// the browser must never set it directly.

import { createClient } from "jsr:@supabase/supabase-js@2";

async function verifySignature(body: string, signature: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const expected = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return expected === signature;
}

Deno.serve(async (req) => {
  const rawBody = await req.text();
  const signature = req.headers.get("x-razorpay-signature") || "";
  const secret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET")!;

  if (!(await verifySignature(rawBody, signature, secret))) {
    return new Response("Invalid signature", { status: 401 });
  }

  const event = JSON.parse(rawBody);
  const payload = event.payload?.payment?.entity;
  if (!payload) return new Response("ignored", { status: 200 });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: payment } = await supabase.from("payments")
    .select("*").eq("provider_order_id", payload.order_id).single();
  if (!payment) return new Response("no matching payment", { status: 200 });

  if (event.event === "payment.captured") {
    await supabase.from("payments").update({
      status: "PAID", provider_payment_id: payload.id, raw_response: payload, updated_at: new Date().toISOString(),
    }).eq("id", payment.id);
    await supabase.from("entries").update({ payment_status: "PAID", reg_status: "CONFIRMED" }).eq("id", payment.entry_id);
  } else if (event.event === "payment.failed") {
    await supabase.from("payments").update({ status: "FAILED", raw_response: payload, updated_at: new Date().toISOString() }).eq("id", payment.id);
    await supabase.from("entries").update({ payment_status: "FAILED" }).eq("id", payment.entry_id);
  }

  return new Response("ok", { status: 200 });
});
