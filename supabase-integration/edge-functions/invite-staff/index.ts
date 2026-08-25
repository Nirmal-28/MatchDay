// Supabase Edge Function — invite-staff
//
// Deploy with: supabase functions deploy invite-staff
//   (JWT verification ON — unlike razorpay-webhook, this is called by a
//    signed-in organizer and must stay authenticated.)
//
// Required secrets (supabase secrets set ...):
//   RESEND_API_KEY, NOTIFY_FROM_EMAIL, SITE_URL
//   SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.
//
// Called by an organizer with { tournamentId, email, role }.
// Returns { ok: true, invited: "<email>", existingUser: boolean }.
//
// ─────────────────────────────────────────────────────────────────────────
// WHY THIS EXISTS AS A SERVER FUNCTION
//
// Resolving an email address to a user id requires the auth admin API, which
// requires the service_role key, which bypasses RLS entirely. That key can
// never touch a browser. So the whole operation moves here.
//
// THE SECURITY PROPERTY THIS FILE MUST HOLD
//
//   An organizer of tournament A must not be able to invite anyone into
//   tournament B.
//
// The caller's JWT is the only thing trusted below. `tournamentId` arrives
// from the client and is treated as a claim to be checked, never as
// permission — the role lookup is done server-side against the caller's own
// id before anything is written. Getting this backwards (trusting a
// tournament id in the body) would let any signed-in user add themselves as
// OWNER of any tournament in the system.
// ─────────────────────────────────────────────────────────────────────────

import { createClient } from "jsr:@supabase/supabase-js@2";

// Roles an invite may grant. OWNER is deliberately absent: ownership
// transfer is a different operation with different consequences and must not
// ride in on the invite path.
const GRANTABLE = ["ORGANIZER", "ADMIN", "REFEREE", "SCORER", "VOLUNTEER"];

// Only these may invite, and ADMIN cannot escalate someone to ORGANIZER.
const CAN_INVITE = ["OWNER", "ORGANIZER", "ADMIN"];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Two clients, on purpose:
  //   `caller`  — carries the user's JWT. Used ONLY to answer "who is this?"
  //   `admin`   — service_role. Used for the role check and the write, after
  //               that identity has been established.
  // Mixing them up is how privilege escalation happens.
  const caller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY") ?? serviceKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const admin = createClient(url, serviceKey);

  const { data: userData, error: userErr } = await caller.auth.getUser();
  const callerId = userData?.user?.id;
  if (userErr || !callerId) return json({ error: "unauthorized" }, 401);

  let body: { tournamentId?: string; email?: string; role?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid body" }, 400);
  }

  const tournamentId = String(body.tournamentId || "");
  const role = String(body.role || "").toUpperCase();
  const email = String(body.email || "").trim().toLowerCase();

  if (!tournamentId) return json({ error: "tournamentId is required" }, 400);
  if (!GRANTABLE.includes(role)) {
    return json({ error: `role must be one of ${GRANTABLE.join(", ")}` }, 400);
  }
  // Deliberately permissive but non-empty: real address validation is the
  // delivery attempt, not a regex.
  if (!email.includes("@") || email.length < 5) {
    return json({ error: "a valid email is required" }, 400);
  }

  /* ── The authorisation check ──────────────────────────────────────────
     Against the CALLER'S id and the tournament they named. This is the line
     that stops an organizer of A inviting into B: the row simply will not
     exist for a tournament they have no role in. */
  const { data: owner } = await admin
    .from("tournaments").select("owner_id").eq("id", tournamentId).maybeSingle();

  const { data: membership } = await admin
    .from("tournament_members")
    .select("role")
    .eq("tournament_id", tournamentId)
    .eq("user_id", callerId)
    .maybeSingle();

  const callerRole = owner?.owner_id === callerId ? "OWNER" : membership?.role ?? null;

  // 404 rather than 403 for a tournament the caller has no role in: a
  // stranger probing ids should not learn which ones exist.
  if (!callerRole) return json({ error: "not found" }, 404);
  if (!CAN_INVITE.includes(callerRole)) {
    return json({ error: "your role cannot invite staff" }, 403);
  }
  // An ADMIN must not be able to mint an ORGANIZER and thereby out-rank the
  // person who invited them.
  if (callerRole === "ADMIN" && role === "ORGANIZER") {
    return json({ error: "only the owner or an organizer can grant ORGANIZER" }, 403);
  }

  /* ── Does this address already have an account? ────────────────────────
     If so, grant the role immediately — there is nothing to claim later.
     If not, store the invite; claim_my_invites() converts it the moment
     they sign in with that address. */
  const { data: list } = await admin.auth.admin.listUsers();
  const existing = list?.users?.find((u) => (u.email || "").toLowerCase() === email);

  if (existing) {
    const { error } = await admin.from("tournament_members").upsert(
      { tournament_id: tournamentId, user_id: existing.id, role },
      { onConflict: "tournament_id,user_id" },
    );
    if (error) return json({ error: error.message }, 500);
  } else {
    const { error } = await admin.from("tournament_invites").upsert(
      { tournament_id: tournamentId, email, role, invited_by: callerId },
      { onConflict: "tournament_id,email" },
    );
    if (error) return json({ error: error.message }, 500);
  }

  /* ── Tell them ────────────────────────────────────────────────────────
     Email failure does NOT fail the request. The role or invite is already
     recorded, so the organizer can still fall back to sending the link
     themselves — which is exactly what they do today. Returning 500 here
     would imply nothing happened, which would be false. */
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("NOTIFY_FROM_EMAIL");
  const site = Deno.env.get("SITE_URL") || "";
  let emailed: "sent" | "skipped" | "failed" = "skipped";

  if (resendKey && from) {
    const { data: t } = await admin
      .from("tournaments").select("name").eq("id", tournamentId).maybeSingle();
    const tName = t?.name || "a tournament";
    const link = `${site}/login`;
    const pretty = role.charAt(0) + role.slice(1).toLowerCase();

    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          to: [email],
          subject: `You've been added to ${tName} on MatchDay`,
          html: `
            <p>You have been added as <strong>${pretty}</strong> for <strong>${tName}</strong> on MatchDay.</p>
            <p><a href="${link}">Sign in with this email address</a> and the role will be waiting for you.</p>
            <p style="color:#667;font-size:12px">If you were not expecting this, you can ignore it — nothing happens until you sign in.</p>
          `,
        }),
      });
      emailed = res.ok ? "sent" : "failed";
    } catch {
      emailed = "failed";
    }
  }

  return json({ ok: true, invited: email, existingUser: Boolean(existing), emailed });
});
