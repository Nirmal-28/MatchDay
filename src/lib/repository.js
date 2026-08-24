import { supabase } from "./supabaseClient";
import {
  nextPow2, bracketSeedOrder, roundRobinRounds, snakeIntoGroups, groupLetter, computeStandings,
} from "./engines";
import * as SchedulingEngine from "./schedulingEngine";

/* ==========================================================================
   Courtside — Supabase repository layer.

   This is the real version of the reducer's persistence logic from the demo
   artifact, talking to the live project (dkkpolnuywgvmlacjzto). Drop this
   into a real Vite/React project alongside supabaseClient.js.

   Known limitations, called out rather than hidden:
   - scorePoint() does a read-modify-write from the client. Fine for the
     realistic case of one scorer device per match, but not safe against two
     devices scoring the same match at the same instant. Harden later with a
     Postgres function (SQL, atomic) if that becomes a real scenario.
   - generateSchedule() updates matches one row at a time (Supabase JS has no
     "bulk update with different values per row" helper). Fine for a few
     dozen matches; for very large draws, move this into a Postgres function
     using unnest() for a single bulk UPDATE.
   - recordOfflinePayment() marks an entry paid because the ORGANIZER says
     they received the money (cash/UPI at the venue). That is a permanent
     feature, not a stand-in. What does NOT exist is any path for the browser
     to claim a GATEWAY payment succeeded: when Razorpay is connected,
     payment_status for an online payment must only ever be set by the
     server-side webhook using the service_role key. See lib/payments/.
   ========================================================================== */

/* ---------------------------- AUTH --------------------------------------- */

export async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}
export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}
export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}
export function onAuthStateChange(cb) {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => cb(session));
  return () => data.subscription.unsubscribe();
}

/**
 * Start a password reset. Supabase mails a one-time recovery link that lands
 * on /reset-password, where the link itself establishes a short-lived session
 * good only for changing the password.
 *
 * This deliberately does NOT report whether the address has an account.
 * Doing so would turn the form into a way of testing which emails are
 * registered. The UI says "if that address has an account, we have sent a
 * link" either way.
 */
export async function requestPasswordReset(email) {
  const redirectTo = `${window.location.origin}/reset-password`;
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  // A rate-limit response is worth surfacing, because the user should wait
  // rather than keep clicking. Anything else is swallowed so this endpoint
  // cannot be used to enumerate accounts.
  if (error && /rate|limit|too many/i.test(error.message)) throw error;
  return true;
}

/**
 * Set a new password for the currently signed-in user. Used by the recovery
 * page (session came from the emailed link) and by profile settings (session
 * came from a normal sign-in).
 */
export async function updateMyPassword(newPassword) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
  return true;
}

/**
 * Fires when the current session arrived from a password-recovery link rather
 * than a normal sign-in. The reset page uses this to tell someone who opened
 * /reset-password directly that they need to request a link first.
 */
export function onPasswordRecovery(cb) {
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") cb(session);
  });
  return () => data.subscription.unsubscribe();
}

/* ------------------------- TOURNAMENTS ------------------------------------ */

export async function listPublishedTournaments() {
  const { data, error } = await supabase.from("tournaments").select("*").neq("status", "DRAFT").order("start_date");
  if (error) throw error;
  return data;
}
// Every tournament this organizer owns, plus every tournament they're
// staffing (any tournament_members role). Previously this had no owner
// filter at all — combined with the public "published tournaments are
// readable by anyone" RLS policy, that meant a brand-new organizer's "My
// tournaments" page showed every OTHER organizer's published tournaments
// too, not just their own.
export async function listMyTournaments() {
  const session = await getSession();
  if (!session) return [];
  const [{ data: owned, error: oErr }, { data: staffed, error: sErr }] = await Promise.all([
    supabase.from("tournaments").select("*").eq("organizer_id", session.user.id).order("created_at", { ascending: false }),
    supabase.from("tournament_members").select("tournaments(*)").eq("user_id", session.user.id),
  ]);
  if (oErr) throw oErr;
  if (sErr) throw sErr;
  const byId = {};
  [...(owned || []), ...(staffed || []).map((r) => r.tournaments).filter(Boolean)].forEach((t) => (byId[t.id] = t));
  return Object.values(byId).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
}
export async function getTournament(id) {
  const { data, error } = await supabase.from("tournaments").select("*").eq("id", id).single();
  if (error) throw error;
  return data;
}
export async function getTournamentBySlug(slug) {
  const { data, error } = await supabase.from("tournaments").select("*").eq("slug", slug).single();
  if (error) throw error;
  return data;
}

export async function createTournament(basics, categories, settings) {
  const session = await getSession();
  if (!session) throw new Error("You must be signed in to create a tournament.");

  const { data: tournament, error: tErr } = await supabase
    .from("tournaments")
    .insert({ organizer_id: session.user.id, ...basics, settings, status: "DRAFT" })
    .select()
    .single();
  if (tErr) throw tErr;

  const courtRows = Array.from({ length: settings.courtsCount || 2 }, (_, i) => ({
    tournament_id: tournament.id, name: `Court ${i + 1}`,
  }));
  const { error: cErr } = await supabase.from("courts").insert(courtRows);
  if (cErr) throw cErr;

  const eventRows = categories.map((c, i) => ({
    tournament_id: tournament.id, category: c.category,
    max_entries: c.maxEntries, fee_inr: c.feeINR,
    format: c.format || "SINGLE_ELIM",
    age_group: c.ageGroup || "OPEN",
    skill_grade: c.skillGrade || null,
    group_count: c.format === "GROUP_KO" ? (c.groupCount || 2) : null,
    advance_per_group: c.format === "GROUP_KO" ? (c.advancePerGroup || 2) : 2,
    sort_order: i,
  }));
  const { error: eErr } = await supabase.from("tournament_events").insert(eventRows);
  if (eErr) throw eErr;

  return tournament;
}

export async function publishTournament(tournamentId, slugBase) {
  const slug = `${slugBase}-${Math.random().toString(36).slice(2, 6)}`;
  const { error: tErr } = await supabase.from("tournaments")
    .update({ status: "REGISTRATION_OPEN", slug }).eq("id", tournamentId);
  if (tErr) throw tErr;
  const { error: eErr } = await supabase.from("tournament_events")
    .update({ status: "REGISTRATION_OPEN" }).eq("tournament_id", tournamentId);
  if (eErr) throw eErr;
}

export async function closeRegistration(tournamentId) {
  await supabase.from("tournaments").update({ status: "REGISTRATION_CLOSED" }).eq("id", tournamentId);
  await supabase.from("tournament_events").update({ status: "REGISTRATION_CLOSED" })
    .eq("tournament_id", tournamentId).eq("status", "REGISTRATION_OPEN");
}

export async function startTournament(tournamentId) {
  await supabase.from("tournaments").update({ status: "LIVE" }).eq("id", tournamentId);
  await supabase.from("tournament_events").update({ status: "LIVE" })
    .eq("tournament_id", tournamentId).eq("status", "SCHEDULED");
  const { data: events } = await supabase.from("tournament_events")
    .select("id").eq("tournament_id", tournamentId).eq("status", "LIVE");
  const eventIds = (events || []).map((e) => e.id);
  if (eventIds.length) {
    await supabase.from("matches").update({ status: "READY" })
      .in("event_id", eventIds).eq("is_bye", false)
      .not("entry_a", "is", null).not("entry_b", "is", null)
      .in("status", ["PENDING", "SCHEDULED"]);
  }
}

export async function completeTournament(tournamentId) {
  await supabase.from("tournaments").update({ status: "COMPLETED" }).eq("id", tournamentId);
}
export async function cancelTournament(tournamentId) {
  await supabase.from("tournaments").update({ status: "CANCELLED" }).eq("id", tournamentId);
}
export async function updateTournament(tournamentId, patch) {
  const { error } = await supabase.from("tournaments").update(patch).eq("id", tournamentId);
  if (error) throw error;
}

/* ---------------------------- COURTS -------------------------------------- */

export async function listCourts(tournamentId) {
  const { data, error } = await supabase.from("courts").select("*").eq("tournament_id", tournamentId).order("name");
  if (error) throw error;
  return data;
}
export async function addCourt(tournamentId, name) {
  const { error } = await supabase.from("courts").insert({ tournament_id: tournamentId, name });
  if (error) throw error;
}
export async function updateCourt(courtId, patch) {
  const { error } = await supabase.from("courts").update(patch).eq("id", courtId);
  if (error) throw error;
}
export async function removeCourt(courtId) {
  const { error } = await supabase.from("courts").delete().eq("id", courtId);
  if (error) throw error;
}

/* -------------------------- EVENTS / ENTRIES ------------------------------ */

export async function listEvents(tournamentId) {
  const { data, error } = await supabase.from("tournament_events").select("*").eq("tournament_id", tournamentId).order("sort_order").order("created_at");
  if (error) throw error;
  return data;
}
export async function updateEvent(eventId, patch) {
  const { error } = await supabase.from("tournament_events").update(patch).eq("id", eventId);
  if (error) throw error;
}

export async function listEntries(eventId) {
  const { data, error } = await supabase
    .from("entries").select("*, entry_players(*)").eq("event_id", eventId).order("created_at");
  if (error) throw error;
  return data;
}

// Same shape as listEntries(), but for anonymous public pages. entry_players
// has no anon SELECT policy (it holds phone/email), so entries().select("*,
// entry_players(*)") silently comes back with entry_players: [] for anyone
// who isn't the organizer — every name on the public schedule/bracket/results
// pages would render as "TBD" for a real visitor. Fetch names separately
// through public_entry_names (name-only, published tournaments only) and
// merge them into the same entry_players shape entryName()/entryShort() read.
export async function listEntriesPublic(eventId) {
  const { data: entries, error } = await supabase
    .from("entries").select("*").eq("event_id", eventId).order("created_at");
  if (error) throw error;
  if (!entries?.length) return [];

  const entryIds = entries.map((e) => e.id);
  const { data: names, error: nErr } = await supabase
    .from("public_entry_names").select("id, entry_id, name, player_id").in("entry_id", entryIds);
  if (nErr) throw nErr;

  const byEntry = {};
  (names || []).forEach((n) => { (byEntry[n.entry_id] = byEntry[n.entry_id] || []).push(n); });
  return entries.map((e) => ({ ...e, entry_players: byEntry[e.id] || [] }));
}

// Public registration — works for anon visitors because of the
// "public_register_entries" / "public_insert_entry_players" RLS policies,
// gated to REGISTRATION_OPEN events only. The capacity trigger on entries
// will raise a Postgres exception ("This category is full.") if the event
// is already at max_entries; surface that error message directly to the UI.
export async function registerEntry(eventId, players, feeINR, customAnswers = null) {
  const { data: entry, error: eErr } = await supabase
    .from("entries")
    .insert({ event_id: eventId, type: players.length > 1 ? "DOUBLES" : "SINGLES", fee_inr: feeINR ?? 0 })
    .select()
    .single();
  if (eErr) throw eErr;

  // Link each entrant to a persistent player row (keyed on phone) so results
  // accumulate into a career profile across tournaments instead of being
  // stranded as loose text on this one entry.
  const linked = await Promise.all(players.map((p) => upsertPlayer(p)));

  const rows = players.map((p, i) => ({
    entry_id: entry.id, name: p.name, phone: p.phone, email: p.email,
    player_id: linked[i]?.id ?? null,
  }));
  const { error: pErr } = await supabase.from("entry_players").insert(rows);
  if (pErr) throw pErr;

  // Answers to the organizer's custom questions go to `entry_details`, NOT to
  // a column on `entries` — `entries` is anon-readable for any published
  // event, so an emergency contact stored there would be world-readable
  // (migration 012 explains this at length).
  if (customAnswers && Object.keys(customAnswers).length) {
    const { error: dErr } = await supabase
      .from("entry_details")
      .insert({ entry_id: entry.id, answers: customAnswers });
    // A failed answer write must not strand the registration itself — the
    // entry is the thing that matters, and the organizer can collect a
    // missing jersey size by other means.
    if (dErr) console.warn("Registration answers were not saved:", dErr.message);
  }
  return entry;
}

/* -------------------- CONFIGURABLE REGISTRATION FIELDS --------------------- */

// The organizer's extra questions, stored on the tournament as configuration.
// See migration 012 for the field shape and why answers live elsewhere.
export async function updateRegistrationFields(tournamentId, fields) {
  const { data, error } = await supabase
    .from("tournaments")
    .update({ registration_fields: fields })
    .eq("id", tournamentId)
    .select("id, registration_fields")
    .single();
  if (error) throw error;
  return data;
}

// Answers for one tournament's entries, for the organizer's participant list
// and exports. RLS restricts this to staff of the owning tournament.
export async function listEntryDetails(entryIds) {
  if (!entryIds?.length) return {};
  const { data, error } = await supabase
    .from("entry_details")
    .select("entry_id, answers")
    .in("entry_id", entryIds);
  if (error) throw error;
  return Object.fromEntries((data || []).map((r) => [r.entry_id, r.answers || {}]));
}

// Correct an answer after the fact. Staff-only by RLS.
export async function updateEntryDetails(entryId, answers) {
  const { data, error } = await supabase
    .from("entry_details")
    .upsert({ entry_id: entryId, answers, updated_at: new Date().toISOString() })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/* ---------------------------- PLAYERS -------------------------------------- */

const normPhone = (phone) => (phone || "").replace(/[^\d]/g, "").slice(-10);

// Find-or-create a player by phone. Returns { id } or null when no usable
// phone was given, in which case the entry simply stays unlinked.
//
// This runs through a SECURITY DEFINER Postgres function rather than
// selecting/inserting `players` from the browser. The old client-side version
// needed anon SELECT on the whole table, which exposed every registrant's
// phone number and email to anyone holding the publishable key (migration
// 008 revoked that). The function also refuses to overwrite the name/email of
// a profile a real user has already claimed.
export async function upsertPlayer({ name, phone, email }) {
  const key = normPhone(phone);
  if (!key) return null;
  const { data, error } = await supabase.rpc("find_or_create_player", {
    p_name: name || null, p_phone: key, p_email: email || null,
  });
  if (error) throw error;
  return data ? { id: data } : null;
}

// Public projection — never the base table, which holds phone/email.
export async function getPlayer(playerId) {
  const { data, error } = await supabase.from("public_players").select("*").eq("id", playerId).single();
  if (error) throw error;
  return data;
}

export async function getPlayersByIds(ids) {
  if (!ids?.length) return [];
  const { data, error } = await supabase.from("public_players").select("*").in("id", ids);
  if (error) throw error;
  return data;
}

export async function searchPlayers(query) {
  const q = (query || "").trim();
  if (q.length < 2) return [];
  const { data, error } = await supabase
    .from("public_players").select("*").ilike("name", `%${q}%`).limit(20);
  if (error) throw error;
  return data;
}


// Every match this player has appeared in, with enough context to render a
// career profile (division, tournament, score).
//
// Reads through public_entry_names rather than entry_players: the base table is
// organizer-only because it holds phone/email, so querying it directly made a
// shared profile look empty to everyone but the organizer. The view exposes
// only entry_id/name/player_id, and only for published tournaments.
export async function getPlayerHistory(playerId) {
  const empty = { matches: [], entries: [], entryIds: [], entryToPlayer: {} };

  const { data: links, error } = await supabase
    .from("public_entry_names").select("entry_id").eq("player_id", playerId);
  if (error) throw error;
  const entryIds = [...new Set((links || []).map((l) => l.entry_id))];
  if (!entryIds.length) return empty;

  const { data: entries, error: eErr } = await supabase
    .from("entries")
    .select("id, event_id, tournament_events(id, category, age_group, skill_grade, format, champion_entry_id, total_rounds, tournaments(id, name, slug, start_date))")
    .in("id", entryIds);
  if (eErr) throw eErr;

  const eventIds = [...new Set((entries || []).map((e) => e.event_id).filter(Boolean))];
  if (!eventIds.length) return empty;

  const { data: matches, error: mErr } = await supabase
    .from("matches").select("*, games(*)").in("event_id", eventIds);
  if (mErr) throw mErr;

  // Resolve opponents' entries to player ids too, so a "rivals" section can
  // link to them — not just this player's own entries.
  const allEntryIds = [...new Set((matches || []).flatMap((m) => [m.entry_a, m.entry_b]).filter(Boolean))];
  const { data: allLinks } = await supabase
    .from("public_entry_names").select("entry_id, player_id").in("entry_id", allEntryIds);
  const entryToPlayer = Object.fromEntries((allLinks || []).filter((l) => l.player_id).map((l) => [l.entry_id, l.player_id]));

  // Shape kept compatible with the profile page: [{ entry_id, entries: {...} }]
  const appearances = (entries || []).map((e) => ({ entry_id: e.id, entries: e }));
  return { matches: matches || [], entries: appearances, entryIds, entryToPlayer };
}

export async function updateEntryStatus(entryId, regStatus) {
  const { error } = await supabase.from("entries").update({ reg_status: regStatus }).eq("id", entryId);
  if (error) throw error;
}
export async function removeEntry(entryId) {
  const { error } = await supabase.from("entries").delete().eq("id", entryId);
  if (error) throw error;
}
export async function markRefunded(entryId) {
  const { error } = await supabase.from("entries").update({ payment_status: "REFUNDED" }).eq("id", entryId);
  if (error) throw error;
}

/* Record a payment the organizer collected OUTSIDE the app — cash at the
   venue, a UPI transfer, a bank deposit. This is a real and permanent part of
   how club tournaments run in India, not a development shortcut, so it stays
   after a gateway is connected.

   It is deliberately NOT the same operation as a gateway payment succeeding:

     - here, the organizer is asserting "I received this money", and RLS
       already restricts that assertion to the entry's own organizer;
     - a gateway payment is asserted by the PROVIDER, verified server-side by
       webhook signature, and must never be writable from a browser.

   The old name (devSimulatePayment) blurred those two, which made it look
   like the app could fake a gateway success. It cannot, and must not. */
export async function recordOfflinePayment(entryId, { received = true, amountINR = null } = {}) {
  const patch = received
    ? { payment_status: "PAID", reg_status: "CONFIRMED" }
    : { payment_status: "FAILED" };
  const { error } = await supabase.from("entries").update(patch).eq("id", entryId);
  if (error) throw error;

  // Best-effort ledger line so Finance shows WHY an entry is marked paid.
  // `payments` has no browser insert policy by design (migration 005), so this
  // is expected to be refused until a server-side endpoint exists — the entry
  // status above is the authoritative record either way, and a missing ledger
  // row must not fail the organizer's action.
  if (received && amountINR !== null) {
    await supabase.from("payments").insert({
      entry_id: entryId, provider: "MOCK", amount_inr: amountINR, status: "PAID",
    }).then(({ error: e }) => {
      if (e) console.info("Offline payment ledger row not written (expected without a server endpoint):", e.message);
    });
  }
}

/* ----------------------------- DRAW ---------------------------------------- */

// Manually set seeds before generating a draw. seedMap: { entryId: seedNumber }
export async function setSeeds(seedMap) {
  const results = await Promise.all(
    Object.entries(seedMap).map(([entryId, seed]) =>
      supabase.from("entries").update({ seed: seed ?? null }).eq("id", entryId)
    )
  );
  const failed = results.find((r) => r.error);
  if (failed) throw failed.error;
}

async function confirmedEntries(eventId) {
  // Seeded entries first (seed 1, 2, 3...), then unseeded by registration time.
  // Previously this ordered purely by created_at, which meant the first person
  // to register was treated as the top seed and handed a free bye.
  const { data, error } = await supabase
    .from("entries").select("id, seed, created_at")
    .eq("event_id", eventId).eq("reg_status", "CONFIRMED");
  if (error) throw error;
  return [...data].sort((a, b) => {
    if (a.seed != null && b.seed != null) return a.seed - b.seed;
    if (a.seed != null) return -1;
    if (b.seed != null) return 1;
    return (a.created_at || "").localeCompare(b.created_at || "");
  });
}

function blankMatch(eventId, round, matchNumber) {
  return {
    id: crypto.randomUUID(), event_id: eventId, round, match_number: matchNumber,
    entry_a: null, entry_b: null, is_bye: false, status: "PENDING",
  };
}

// Builds a single-elimination bracket over `ordered` entry ids (index 0 = top
// seed). Round-1 slots follow the standard bracket seed order so seeds 1 and 2
// can only meet in the final, and byes fall to the top seeds rather than to
// whoever happened to register first.
function buildKnockout(eventId, ordered, startRound = 1, startMatchNumber = 1) {
  const size = nextPow2(ordered.length);
  const totalRounds = Math.log2(size);
  const slots = bracketSeedOrder(size).map((seedNo) => ordered[seedNo - 1] ?? null);

  let matchNumber = startMatchNumber;
  const round1 = [];
  for (let i = 0; i < size; i += 2) {
    const a = slots[i], b = slots[i + 1];
    const isBye = (a && !b) || (!a && b);
    const only = a || b;
    round1.push({
      id: crypto.randomUUID(), event_id: eventId, round: startRound, match_number: matchNumber++,
      entry_a: a, entry_b: b, is_bye: isBye,
      status: isBye ? "WALKOVER" : "PENDING",
      winner_entry_id: isBye ? only : null,
      completed_at: isBye ? new Date().toISOString() : null,
    });
  }

  const rounds = [round1];
  let prev = round1;
  for (let r = startRound + 1; r < startRound + totalRounds; r++) {
    const roundMatches = [];
    for (let i = 0; i < prev.length / 2; i++) roundMatches.push(blankMatch(eventId, r, matchNumber++));
    prev.forEach((m, idx) => {
      m.next_match_id = roundMatches[Math.floor(idx / 2)].id;
      m.next_slot = idx % 2 === 0 ? "A" : "B";
    });
    rounds.push(roundMatches);
    prev = roundMatches;
  }

  // Propagate bye winners into the next round immediately. All ids are known
  // client-side, so round-1 rows can reference round-2 rows in the same insert
  // (Postgres checks non-deferred FKs at end-of-statement, not per row).
  const all = rounds.flat();
  all.filter((m) => m.is_bye && m.next_match_id).forEach((bm) => {
    const target = all.find((m) => m.id === bm.next_match_id);
    if (bm.next_slot === "A") target.entry_a = bm.winner_entry_id;
    else target.entry_b = bm.winner_entry_id;
  });

  return { matches: all, totalRounds };
}

export async function generateDraw(eventId) {
  const entries = await confirmedEntries(eventId);
  if (entries.length < 2) throw new Error("At least 2 confirmed entries are required to generate a draw.");

  const { matches, totalRounds } = buildKnockout(eventId, entries.map((e) => e.id));

  const { error: insErr } = await supabase.from("matches").insert(matches);
  if (insErr) throw insErr;
  const { error: updErr } = await supabase.from("tournament_events")
    .update({ status: "DRAW_READY", total_rounds: totalRounds }).eq("id", eventId);
  if (updErr) throw updErr;
}

// Round robin: everyone plays everyone once. Best for small divisions, where a
// knockout would send half the paying entrants home after a single match.
export async function generateRoundRobin(eventId) {
  const entries = await confirmedEntries(eventId);
  if (entries.length < 3) throw new Error("At least 3 confirmed entries are required for a round robin.");

  const rounds = roundRobinRounds(entries.map((e) => e.id));
  let matchNumber = 1;
  const matches = rounds.flatMap((pairs, ri) =>
    pairs.map(([a, b]) => ({
      id: crypto.randomUUID(), event_id: eventId, round: ri + 1, match_number: matchNumber++,
      entry_a: a, entry_b: b, is_bye: false, status: "PENDING", group_label: "RR",
    }))
  );

  const { error: insErr } = await supabase.from("matches").insert(matches);
  if (insErr) throw insErr;
  const { error: updErr } = await supabase.from("tournament_events")
    .update({ status: "DRAW_READY", total_rounds: rounds.length }).eq("id", eventId);
  if (updErr) throw updErr;
}

// Groups -> knockout. Group matches are created now; the knockout bracket is
// built later by generateKnockoutFromGroups(), once results are in and we
// actually know who advanced.
export async function generateGroupStage(eventId, groupCount, advancePerGroup = 2) {
  const entries = await confirmedEntries(eventId);
  if (entries.length < groupCount * 2) {
    throw new Error(`At least ${groupCount * 2} confirmed entries are required for ${groupCount} groups.`);
  }

  const groups = snakeIntoGroups(entries.map((e) => e.id), groupCount);
  let matchNumber = 1;
  const matches = groups.flatMap((ids, gi) =>
    roundRobinRounds(ids).flatMap((pairs, ri) =>
      pairs.map(([a, b]) => ({
        id: crypto.randomUUID(), event_id: eventId, round: ri + 1, match_number: matchNumber++,
        entry_a: a, entry_b: b, is_bye: false, status: "PENDING", group_label: groupLetter(gi),
      }))
    )
  );

  const { error: insErr } = await supabase.from("matches").insert(matches);
  if (insErr) throw insErr;
  const { error: updErr } = await supabase.from("tournament_events")
    .update({ status: "DRAW_READY", group_count: groupCount, advance_per_group: advancePerGroup, total_rounds: null })
    .eq("id", eventId);
  if (updErr) throw updErr;
}

// After all group matches are done, seed the knockout from group standings.
export async function generateKnockoutFromGroups(eventId) {
  const { data: event, error: evErr } = await supabase
    .from("tournament_events").select("*").eq("id", eventId).single();
  if (evErr) throw evErr;

  const { data: matches, error: mErr } = await supabase
    .from("matches").select("*, games(*)").eq("event_id", eventId);
  if (mErr) throw mErr;

  const groupMatches = matches.filter((m) => m.group_label && m.group_label !== "RR");
  if (groupMatches.length === 0) throw new Error("No group stage found for this event.");
  if (matches.some((m) => !m.group_label)) throw new Error("The knockout stage has already been generated.");
  const unfinished = groupMatches.filter((m) => m.status !== "COMPLETED" && m.status !== "WALKOVER");
  if (unfinished.length > 0) throw new Error(`${unfinished.length} group match(es) still to be played.`);

  const advance = event.advance_per_group || 2;
  const labels = [...new Set(groupMatches.map((m) => m.group_label))].sort();
  const qualifiersByGroup = labels.map((label) => {
    const gm = groupMatches.filter((m) => m.group_label === label);
    const ids = [...new Set(gm.flatMap((m) => [m.entry_a, m.entry_b]).filter(Boolean))];
    return computeStandings(ids, gm).slice(0, advance).map((r) => r.entryId);
  });

  // Interleave by finishing position (all group winners, then all runners-up,
  // reversed) so same-group qualifiers stay apart in the early knockout rounds.
  const ordered = [];
  for (let pos = 0; pos < advance; pos++) {
    const slice = qualifiersByGroup.map((q) => q[pos]).filter(Boolean);
    if (pos % 2 === 1) slice.reverse();
    ordered.push(...slice);
  }
  if (ordered.length < 2) throw new Error("Not enough qualifiers to build a knockout.");

  const startRound = Math.max(...groupMatches.map((m) => m.round)) + 1;
  const startNumber = Math.max(...matches.map((m) => m.match_number)) + 1;
  const { matches: koMatches, totalRounds } = buildKnockout(eventId, ordered, startRound, startNumber);

  const { error: insErr } = await supabase.from("matches").insert(koMatches);
  if (insErr) throw insErr;
  const { error: updErr } = await supabase.from("tournament_events")
    .update({ total_rounds: startRound - 1 + totalRounds }).eq("id", eventId);
  if (updErr) throw updErr;
}
/* --------------------------- SCHEDULE --------------------------------------- */
/* Smart Scheduling + Conflict Detection engine integration.
   The heuristics themselves live in schedulingEngine.js (pure, unit-tested);
   everything here is about mapping Supabase rows into/out of that engine's
   generic Match/Court/Constraint shape and persisting the result.

   Player-conflict detection deliberately operates at the TOURNAMENT level,
   not per-event: a player in Men's Singles AND Men's Doubles must never be
   double-booked, even though those are two different tournament_events rows. */

function timeOnly(t, fallback = "09:00") { return (t || fallback).toString().slice(0, 5); }

// Inclusive list of 'YYYY-MM-DD' strings from start_date to end_date. Falls
// back to a single day if end_date is missing/before start_date.
function dateRange(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00`);
  const end = endDate ? new Date(`${endDate}T00:00:00`) : start;
  const dates = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates.length ? dates : [startDate];
}

// Loads every match/court/entry across the WHOLE tournament (all categories)
// and maps them into the engine's generic shape.
async function gatherSchedulingContext(tournamentId) {
  const { data: tournament, error: tErr } = await supabase.from("tournaments").select("*").eq("id", tournamentId).single();
  if (tErr) throw tErr;
  const { data: events, error: eErr } = await supabase.from("tournament_events").select("*").eq("tournament_id", tournamentId);
  if (eErr) throw eErr;
  const eventIds = events.map((e) => e.id);

  const { data: courtsRaw, error: cErr } = await supabase.from("courts").select("*").eq("tournament_id", tournamentId);
  if (cErr) throw cErr;
  const courtIds = (courtsRaw || []).map((c) => c.id);
  const { data: availabilityRows } = courtIds.length
    ? await supabase.from("court_availability").select("*").in("court_id", courtIds)
    : { data: [] };
  const availabilityByCourt = {};
  (availabilityRows || []).forEach((r) => {
    (availabilityByCourt[r.court_id] = availabilityByCourt[r.court_id] || {})[r.date] =
      { start: timeOnly(r.start_time), end: timeOnly(r.end_time) };
  });

  const [{ data: matches, error: mErr }, { data: entries, error: enErr }] = await Promise.all([
    eventIds.length ? supabase.from("matches").select("*").in("event_id", eventIds).order("match_number") : { data: [] },
    eventIds.length ? supabase.from("entries").select("id, event_id, entry_players(player_id)").in("event_id", eventIds) : { data: [] },
  ]);
  if (mErr) throw mErr;
  if (enErr) throw enErr;

  // entryId -> playerIds, falling back to the entry id itself so unlinked
  // entries (no phone captured) still get conflict-checked as themselves.
  const entryPlayers = {};
  (entries || []).forEach((e) => {
    const ids = (e.entry_players || []).map((p) => p.player_id).filter(Boolean);
    entryPlayers[e.id] = ids.length ? ids : [e.id];
  });

  const dependsOn = SchedulingEngine.dependencyMapFromNextMatchId(matches || []);

  const engineMatches = (matches || []).map((m) => ({
    id: m.id, eventId: m.event_id, round: m.round, matchNumber: m.match_number,
    participantIds: [m.entry_a, m.entry_b].filter(Boolean).flatMap((eid) => entryPlayers[eid] || [eid]),
    dependsOn: dependsOn[m.id] || [],
    status: m.status, locked: m.locked, priority: m.priority || "NORMAL",
    scheduledStart: m.scheduled_at, scheduledEnd: m.scheduled_end, courtId: m.court_id,
    _raw: m,
  }));

  const engineCourts = (courtsRaw || []).map((c) => ({
    id: c.id, name: c.name, active: c.status === "AVAILABLE",
    availableStart: timeOnly(c.available_start), availableEnd: timeOnly(c.available_end),
    availabilityByDate: availabilityByCourt[c.id] || {},
  }));

  const settings = tournament.settings || {};
  const constraints = {
    dates: dateRange(tournament.start_date, tournament.end_date),
    tournamentStart: timeOnly(settings.startTime, "09:00"),
    tournamentEnd: timeOnly(settings.endTime, "18:00"),
    durationMins: settings.matchDurationMins || 30,
    bufferMins: settings.bufferMins ?? 10,
    minRestMins: settings.minRestMins ?? 30,
  };

  return { tournament, events, courtsRaw: courtsRaw || [], engineMatches, engineCourts, constraints };
}

// Everything the Schedule tab UI needs in one round trip.
export async function getSchedulingBoard(tournamentId) {
  const ctx = await gatherSchedulingContext(tournamentId);
  const quality = SchedulingEngine.scoreScheduleQuality(ctx.engineMatches, ctx.engineCourts, ctx.constraints);
  const availabilityByCourt = Object.fromEntries(ctx.engineCourts.map((c) => [c.id, c.availabilityByDate]));
  return {
    tournament: ctx.tournament, events: ctx.events, courts: ctx.courtsRaw,
    constraints: ctx.constraints, matches: ctx.engineMatches.map((m) => m._raw), quality,
    courtAvailabilityByDate: availabilityByCourt,
  };
}

export async function updateSchedulingSettings(tournamentId, patch) {
  const { data: t, error: gErr } = await supabase.from("tournaments").select("settings").eq("id", tournamentId).single();
  if (gErr) throw gErr;
  const settings = { ...(t?.settings || {}), ...patch };
  const { error } = await supabase.from("tournaments").update({ settings }).eq("id", tournamentId);
  if (error) throw error;
}

export async function updateCourtAvailability(courtId, { availableStart, availableEnd }) {
  const { error } = await supabase.from("courts")
    .update({ available_start: availableStart, available_end: availableEnd }).eq("id", courtId);
  if (error) throw error;
}

// Full optimization pass: schedules every unlocked, eligible match across the
// whole tournament, routing around locked matches and existing bookings.
export async function optimizeSchedule(tournamentId) {
  const ctx = await gatherSchedulingContext(tournamentId);
  const { matches: result, conflicts, unresolved } = SchedulingEngine.generateSchedule(ctx.engineMatches, ctx.engineCourts, ctx.constraints);

  const changed = result.filter((m) => {
    const raw = m._raw;
    return m.scheduledStart && (raw.scheduled_at !== m.scheduledStart || raw.court_id !== m.courtId);
  });

  await Promise.all(changed.map((m) => {
    const courtName = ctx.courtsRaw.find((c) => c.id === m.courtId)?.name || null;
    return supabase.from("matches").update({
      scheduled_at: m.scheduledStart, scheduled_end: m.scheduledEnd, court_id: m.courtId, court: courtName,
      status: m._raw.entry_a && m._raw.entry_b ? "READY" : "SCHEDULED",
    }).eq("id", m.id);
  }));

  const scheduledEventIds = [...new Set(changed.map((m) => m.eventId))];
  await Promise.all(scheduledEventIds.map((eid) =>
    supabase.from("tournament_events").update({ status: "SCHEDULED" }).eq("id", eid).eq("status", "DRAW_READY")
  ));

  await supabase.from("schedule_audit_log").insert({
    tournament_id: tournamentId, action: "GENERATED",
    note: `Optimized ${changed.length} match(es); ${unresolved.length} left unscheduled (dependencies not yet resolved).`,
  });

  const quality = SchedulingEngine.scoreScheduleQuality(result, ctx.engineCourts, ctx.constraints);
  return { updatedCount: changed.length, unresolvedCount: unresolved.length, quality, conflicts };
}

export async function detectTournamentConflicts(tournamentId) {
  const ctx = await gatherSchedulingContext(tournamentId);
  return SchedulingEngine.detectConflicts(ctx.engineMatches, ctx.engineCourts, ctx.constraints);
}

export async function findBetterSlotsForMatch(tournamentId, matchId, topN = 3) {
  const ctx = await gatherSchedulingContext(tournamentId);
  return SchedulingEngine.findBetterSlots(matchId, ctx.engineMatches, ctx.engineCourts, ctx.constraints, topN);
}

// Moves one match (drag-and-drop or "use this slot"), logs it, and returns a
// PARTIAL conflict recheck scoped to matches actually connected to the move —
// the rest of the tournament schedule is left untouched (section 26).
export async function moveMatch(tournamentId, matchId, { courtId, scheduledAt }) {
  const ctx = await gatherSchedulingContext(tournamentId);
  const match = ctx.engineMatches.find((m) => m.id === matchId);
  if (!match) throw new Error("Match not found.");

  const newStart = new Date(scheduledAt);
  const newEnd = new Date(newStart.getTime() + ctx.constraints.durationMins * 60000);
  const fromCourtName = ctx.courtsRaw.find((c) => c.id === match.courtId)?.name || null;
  const toCourtName = ctx.courtsRaw.find((c) => c.id === courtId)?.name || null;

  const { error } = await supabase.from("matches").update({
    scheduled_at: newStart.toISOString(), scheduled_end: newEnd.toISOString(),
    court_id: courtId, court: toCourtName,
    status: match._raw.status === "PENDING" ? "SCHEDULED" : match._raw.status,
  }).eq("id", matchId);
  if (error) throw error;

  await supabase.from("schedule_audit_log").insert({
    tournament_id: tournamentId, match_id: matchId, action: "MOVED",
    from_court: fromCourtName, to_court: toCourtName,
    from_time: match.scheduledStart, to_time: newStart.toISOString(),
  });

  const updatedMatches = ctx.engineMatches.map((m) =>
    m.id === matchId ? { ...m, scheduledStart: newStart.toISOString(), scheduledEnd: newEnd.toISOString(), courtId } : m
  );
  return SchedulingEngine.recheckAfterMove(updatedMatches, ctx.engineCourts, ctx.constraints, matchId);
}

export async function setMatchLocked(tournamentId, matchId, locked) {
  const { error } = await supabase.from("matches").update({ locked }).eq("id", matchId);
  if (error) throw error;
  await supabase.from("schedule_audit_log").insert({ tournament_id: tournamentId, match_id: matchId, action: locked ? "LOCKED" : "UNLOCKED" });
}

export async function setMatchPriority(matchId, priority) {
  const { error } = await supabase.from("matches").update({ priority }).eq("id", matchId);
  if (error) throw error;
}

export async function publishSchedule(tournamentId) {
  const { error } = await supabase.from("tournaments").update({ schedule_published: true }).eq("id", tournamentId);
  if (error) throw error;
  await supabase.from("schedule_audit_log").insert({ tournament_id: tournamentId, action: "PUBLISHED" });
}

export async function listScheduleAudit(tournamentId) {
  const { data, error } = await supabase.from("schedule_audit_log")
    .select("*").eq("tournament_id", tournamentId).order("created_at", { ascending: false }).limit(50);
  if (error) throw error;
  return data;
}

// Backward-compatible one-click "Generate schedule" for a single event's
// draw — internally runs the full tournament-wide optimizer (needed so
// cross-category conflicts are caught even from a single-event trigger).
export async function generateSchedule(eventId) {
  const { data: event, error } = await supabase.from("tournament_events").select("tournament_id").eq("id", eventId).single();
  if (error) throw error;
  return optimizeSchedule(event.tournament_id);
}

/* ----------------------------- MATCHES (read) ---------------------------------- */

// Matches for an event, each with its games nested (needed for bracket/scorer/results UI).
export async function listMatches(eventId) {
  const { data, error } = await supabase
    .from("matches").select("*, games(*)").eq("event_id", eventId).order("match_number");
  if (error) throw error;
  return data;
}

// Single match + its games — used by the scorer UI to refresh just the
// match being scored after each point, instead of reloading the whole
// tournament (which was visibly re-rendering the entire scorer screen on
// every single point).
export async function getMatch(matchId) {
  const { data, error } = await supabase.from("matches").select("*, games(*)").eq("id", matchId).single();
  if (error) throw error;
  return data;
}


/* ---------------------- NOTIFICATION PREFERENCES -------------------------- */

// Which channels a person wants. In-app is not a preference — it is the
// notification itself. A missing row means the defaults below rather than
// "everything off", so nobody has to be migrated into a choice they never made.
//
// Whether a channel actually DELIVERS depends on the notify-dispatch Edge
// Function having the matching provider secret. channelDeliveryStatus() below
// is how the UI tells the truth about that instead of implying an SMS went out.
const DEFAULT_PREFS = { email: true, sms: false, push: false };

export async function getMyNotificationPreferences() {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;
  if (!userId) return { ...DEFAULT_PREFS };

  const { data, error } = await supabase
    .from("notification_preferences").select("*").eq("user_id", userId).maybeSingle();

  // Migration 011 may not be applied yet on this project. Treat a missing
  // table as "defaults" rather than breaking the settings page.
  if (error && !isMissingRelation(error)) throw error;
  return { ...DEFAULT_PREFS, ...(data || {}) };
}

export async function updateMyNotificationPreferences(patch) {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;
  if (!userId) throw new Error("You must be signed in.");

  const { error } = await supabase.from("notification_preferences").upsert({
    user_id: userId, ...patch, updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });
  if (error) throw error;
  return true;
}

// A table or view that does not exist yet, versus a real failure.
function isMissingRelation(error) {
  return error?.code === "42P01" || error?.code === "PGRST205" ||
    /does not exist|not found in the schema cache/i.test(error?.message || "");
}
/* --------------------------- NOTIFICATIONS -------------------------------------- */

// Notification records are written by Postgres triggers (migration 008) on
// the same statements that change the tournament — entry status, payment
// status, check-in, waitlist movement, match scheduling/court/status, dispute
// resolution, tournament completion. That means a player gets notified even
// when nobody had the relevant screen open, which a toast-only system can't do.
//
// Delivery is in-app only. Email/SMS/WhatsApp/push would each need a provider
// (and a server-side sender); the adapter boundary for that is
// src/lib/notifications/ — nothing is connected, so nothing claims to be.

// Everything visible to the signed-in user: their own notifications plus the
// tournament-level ones for tournaments they organize.
export async function listMyNotifications(limit = 50) {
  const { data, error } = await supabase
    .from("notifications")
    .select("*, tournaments(name, slug)")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function countMyUnreadNotifications() {
  const { count, error } = await supabase
    .from("notifications").select("id", { count: "exact", head: true }).eq("read", false);
  if (error) throw error;
  return count || 0;
}

export async function markNotificationRead(id) {
  const { error } = await supabase.from("notifications").update({ read: true }).eq("id", id);
  if (error) throw error;
}

export async function markAllNotificationsRead() {
  const { error } = await supabase.from("notifications").update({ read: true }).eq("read", false);
  if (error) throw error;
}

// Tournament-scoped feed for the organizer's control center.
export async function listNotifications(tournamentId) {
  const { data, error } = await supabase
    .from("notifications").select("*").eq("tournament_id", tournamentId)
    .order("created_at", { ascending: false }).limit(100);
  if (error) throw error;
  return data;
}
export async function markNotificationsRead(tournamentId) {
  const { error } = await supabase.from("notifications")
    .update({ read: true }).eq("tournament_id", tournamentId).eq("read", false);
  if (error) throw error;
}

// More than one component subscribes to the same user's notifications at
// once — the player dashboard and the notification bell both mount on /me.
// Supabase Realtime refuses a second `.subscribe()` on a channel name that's
// already live ("cannot add `postgres_changes` callbacks for realtime:..."),
// so the name must be unique per SUBSCRIPTION, not just per user.
let notifSubSeq = 0;
export function subscribeToMyNotifications(userId, onChange) {
  const channel = supabase
    .channel(`notif-${userId}-${++notifSubSeq}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, onChange)
    .subscribe();
  return () => supabase.removeChannel(channel);
}

/* ---------------------------- SCORING ---------------------------------------- */

function isGameOver(a, b) { return a >= 30 || b >= 30 || (Math.max(a, b) >= 21 && Math.abs(a - b) >= 2); }
function gameWinnerSide(a, b) { if (!isGameOver(a, b)) return null; return a > b ? "A" : "B"; }
function matchWinnerSide(games) {
  let wa = 0, wb = 0;
  games.forEach((g) => { const w = gameWinnerSide(g.score_a, g.score_b); if (w === "A") wa++; else if (w === "B") wb++; });
  if (wa === 2) return "A"; if (wb === 2) return "B"; return null;
}

export async function startMatch(matchId) {
  await supabase.from("matches").update({ status: "LIVE", started_at: new Date().toISOString() }).eq("id", matchId);
  await supabase.from("games").insert({ match_id: matchId, game_number: 1, score_a: 0, score_b: 0 });
}

// Apply a single point atomically, falling back to the old client-side
// read-modify-write if migration 010 has not been applied to this project yet.
// The fallback is the previous behaviour exactly — including its race — so an
// un-migrated database keeps working rather than failing closed mid-tournament.
let atomicScoringAvailable = true;

async function applyPoint(last, matchId, side, key, delta) {
  if (atomicScoringAvailable) {
    const { data, error } = await supabase.rpc("score_point_atomic", {
      p_match_id: matchId, p_side: side, p_delta: delta,
    });
    if (!error) return data;

    // PGRST202 = no such function in the schema cache; 42883 = undefined
    // function. Anything else is a real failure and must surface.
    const missing = error.code === "PGRST202" || error.code === "42883" ||
      /score_point_atomic/.test(error.message || "");
    if (!missing) throw error;

    atomicScoringAvailable = false;
    console.warn(
      "[repository] score_point_atomic() is not present — falling back to " +
      "client-side scoring. Apply migration 010 to remove the two-device race."
    );
  }

  const value = Math.max(0, Math.min(30, last[key] + delta));
  const { error } = await supabase.from("games").update({ [key]: value }).eq("id", last.id);
  if (error) throw error;
  return { ...last, [key]: value };
}

export async function scorePoint(matchId, side, delta) {
  const { data: match, error } = await supabase.from("matches").select("*, games(*)").eq("id", matchId).single();
  if (error) throw error;
  if (match.status !== "LIVE") return;

  const games = [...match.games].sort((a, b) => a.game_number - b.game_number);
  const last = games[games.length - 1];
  const key = side === "A" ? "score_a" : "score_b";
  if (delta > 0 && (isGameOver(last.score_a, last.score_b) || last[key] >= 30)) return;

  // The increment itself goes through score_point_atomic() so two devices
  // scoring the same match cannot interleave a read-modify-write and lose a
  // point (migration 010). The cascade below — closing the game, opening the
  // next, advancing the winner — stays here; it is not where the race was.
  const updatedLast = await applyPoint(last, matchId, side, key, delta);
  const allGames = [...games.slice(0, -1), updatedLast];

  if (!isGameOver(updatedLast.score_a, updatedLast.score_b)) return;

  const winSide = matchWinnerSide(allGames);
  if (!winSide) {
    await supabase.from("games").insert({ match_id: matchId, game_number: allGames.length + 1, score_a: 0, score_b: 0 });
    return;
  }

  const winnerEntryId = winSide === "A" ? match.entry_a : match.entry_b;
  await supabase.from("matches")
    .update({ status: "COMPLETED", winner_entry_id: winnerEntryId, completed_at: new Date().toISOString() })
    .eq("id", matchId);

  if (match.next_match_id) {
    const patch = match.next_slot === "A" ? { entry_a: winnerEntryId } : { entry_b: winnerEntryId };
    const { data: next } = await supabase.from("matches").update(patch).eq("id", match.next_match_id).select().single();
    if (next?.entry_a && next?.entry_b && next?.scheduled_at) {
      await supabase.from("matches").update({ status: "READY" }).eq("id", next.id);
    }
  } else if (!match.group_label) {
    // Only a true knockout final has no next_match_id. Round-robin and group
    // matches never have one either (nothing to advance into), so without this
    // guard the FIRST round-robin match to finish would falsely crown its
    // winner "champion" and mark the whole division complete.
    await supabase.from("tournament_events")
      .update({ status: "COMPLETED", champion_entry_id: winnerEntryId }).eq("id", match.event_id);
  } else if (match.group_label === "RR") {
    // Pure round robin (not groups->knockout) has no final match to hang a
    // champion declaration off, so declare one here once every RR match in
    // the division is done: the top of the standings table.
    const { data: rrMatches } = await supabase
      .from("matches").select("*, games(*)").eq("event_id", match.event_id).eq("group_label", "RR");
    const allDone = rrMatches.every((m) => m.status === "COMPLETED" || m.status === "WALKOVER");
    if (allDone) {
      const ids = [...new Set(rrMatches.flatMap((m) => [m.entry_a, m.entry_b]).filter(Boolean))];
      const standings = computeStandings(ids, rrMatches);
      if (standings[0]) {
        await supabase.from("tournament_events")
          .update({ status: "COMPLETED", champion_entry_id: standings[0].entryId }).eq("id", match.event_id);
      }
    }
  }
}

export async function undoLastGame(matchId) {
  const { data: match } = await supabase.from("matches").select("*, games(*)").eq("id", matchId).single();
  const games = [...match.games].sort((a, b) => a.game_number - b.game_number);
  const last = games[games.length - 1];
  if (games.length < 2 || last.score_a !== 0 || last.score_b !== 0) return;
  await supabase.from("games").delete().eq("id", last.id);
}

export async function retireMatch(matchId, retiredSide) {
  const { data: match } = await supabase.from("matches").select("*").eq("id", matchId).single();
  const winnerEntryId = retiredSide === "A" ? match.entry_b : match.entry_a;
  await supabase.from("matches")
    .update({ status: "COMPLETED", winner_entry_id: winnerEntryId, retired: true, completed_at: new Date().toISOString() })
    .eq("id", matchId);
  if (match.next_match_id) {
    const patch = match.next_slot === "A" ? { entry_a: winnerEntryId } : { entry_b: winnerEntryId };
    await supabase.from("matches").update(patch).eq("id", match.next_match_id);
  } else {
    await supabase.from("tournament_events")
      .update({ status: "COMPLETED", champion_entry_id: winnerEntryId }).eq("id", match.event_id);
  }
}

/* ------------------------------- RBAC / STAFF ---------------------------------- */

export async function listMembers(tournamentId) {
  const { data, error } = await supabase.from("tournament_members").select("*").eq("tournament_id", tournamentId).order("created_at");
  if (error) throw error;
  return data;
}

// Adds a staff role for a user already known by their auth id. Inviting by
// email alone (before they've ever signed in) isn't wired up yet — that
// needs a server-side lookup via the admin API, which the browser can't do;
// for now the organizer shares the tournament link and adds the role once
// the person has an account.
export async function addMember(tournamentId, userId, role, invitedEmail = null) {
  const { error } = await supabase.from("tournament_members")
    .insert({ tournament_id: tournamentId, user_id: userId, role, invited_email: invitedEmail });
  if (error) throw error;
}
export async function updateMemberRole(memberId, role) {
  const { error } = await supabase.from("tournament_members").update({ role }).eq("id", memberId);
  if (error) throw error;
}
export async function removeMember(memberId) {
  const { error } = await supabase.from("tournament_members").delete().eq("id", memberId);
  if (error) throw error;
}

// This tournament's role for the current session — 'OWNER' (matches
// tournaments.organizer_id), a tournament_members role, or null if the
// caller has no access at all. Used to gate the Scorer/Referee UI.
export async function getMyRole(tournamentId) {
  const session = await getSession();
  if (!session) return null;
  const { data: t } = await supabase.from("tournaments").select("organizer_id").eq("id", tournamentId).single();
  if (t?.organizer_id === session.user.id) return "OWNER";
  const { data: m } = await supabase.from("tournament_members")
    .select("role").eq("tournament_id", tournamentId).eq("user_id", session.user.id).maybeSingle();
  return m?.role || null;
}

// Matches assigned to the current user for scoring: everything if they're
// OWNER/ORGANIZER/ADMIN, or only matches on courts they've been assigned to
// if that ever gets modeled — today every SCORER/REFEREE sees every match in
// the tournament, since MatchDay has no per-court staff assignment yet.
export async function listScorableTournaments() {
  const session = await getSession();
  if (!session) return [];
  const [{ data: owned }, { data: staffed }] = await Promise.all([
    supabase.from("tournaments").select("*").eq("organizer_id", session.user.id).in("status", ["LIVE", "REGISTRATION_CLOSED", "SCHEDULED"]),
    supabase.from("tournament_members").select("tournaments(*)").eq("user_id", session.user.id).in("role", ["ORGANIZER", "ADMIN", "REFEREE", "SCORER"]),
  ]);
  const fromStaff = (staffed || []).map((r) => r.tournaments).filter(Boolean);
  const byId = {};
  [...(owned || []), ...fromStaff].forEach((t) => (byId[t.id] = t));
  return Object.values(byId);
}

/* --------------------------- COURT AVAILABILITY (multi-day) -------------------- */

export async function listCourtAvailability(courtId) {
  const { data, error } = await supabase.from("court_availability").select("*").eq("court_id", courtId).order("date");
  if (error) throw error;
  return data;
}

export async function setCourtAvailabilityForDate(courtId, date, { startTime, endTime }) {
  const { error } = await supabase.from("court_availability")
    .upsert({ court_id: courtId, date, start_time: startTime, end_time: endTime }, { onConflict: "court_id,date" });
  if (error) throw error;
}

export async function clearCourtAvailabilityForDate(courtId, date) {
  const { error } = await supabase.from("court_availability").delete().eq("court_id", courtId).eq("date", date);
  if (error) throw error;
}

/* --------------------------------- WAITLIST ------------------------------------ */

export async function listWaitlist(eventId) {
  const { data, error } = await supabase.from("entries").select("*, entry_players(*)")
    .eq("event_id", eventId).eq("reg_status", "WAITLISTED").order("waitlist_position");
  if (error) throw error;
  return data;
}

// Promotes the next waitlisted entry to PENDING (organizer still confirms
// payment/approval as normal). Never runs silently — only ever called from
// an explicit organizer action, or automatically from cancelEntry() when the
// event has auto_promote_waitlist enabled.
export async function promoteNextWaitlisted(eventId) {
  const { data: next } = await supabase.from("entries").select("id")
    .eq("event_id", eventId).eq("reg_status", "WAITLISTED").order("waitlist_position").limit(1).maybeSingle();
  if (!next) return null;
  const { error } = await supabase.from("entries").update({ reg_status: "PENDING", waitlist_position: null }).eq("id", next.id);
  if (error) throw error;
  return next.id;
}

// Cancels a confirmed/pending entry and — if the event allows it — promotes
// the next waitlisted entry into the opening it leaves behind.
export async function cancelEntryWithWaitlistPromotion(entryId) {
  const { data: entry, error: eErr } = await supabase.from("entries").select("event_id").eq("id", entryId).single();
  if (eErr) throw eErr;
  const { error } = await supabase.from("entries").update({ reg_status: "CANCELLED" }).eq("id", entryId);
  if (error) throw error;
  const { data: event } = await supabase.from("tournament_events").select("auto_promote_waitlist").eq("id", entry.event_id).single();
  if (event?.auto_promote_waitlist) await promoteNextWaitlisted(entry.event_id);
}

/* -------------------------------- CHECK-IN -------------------------------------- */

export async function listCheckIn(eventId) {
  const { data, error } = await supabase.from("entries").select("*, entry_players(*)")
    .eq("event_id", eventId).in("reg_status", ["CONFIRMED", "PENDING"]).order("created_at");
  if (error) throw error;
  return data;
}

export async function setCheckInStatus(entryId, status) {
  const patch = { check_in_status: status };
  if (status === "CHECKED_IN" || status === "LATE") patch.checked_in_at = new Date().toISOString();
  const { error } = await supabase.from("entries").update(patch).eq("id", entryId);
  if (error) throw error;
}

// Scans a QR/check-in code and marks that entry CHECKED_IN. Throws a clear
// error if the code doesn't match anything the caller can see (wrong
// tournament, or the code was mistyped).
export async function checkInByCode(code) {
  const { data: entry, error } = await supabase.from("entries").select("*, entry_players(*)").eq("check_in_code", code).maybeSingle();
  if (error) throw error;
  if (!entry) throw new Error("No participant found for that code.");
  await setCheckInStatus(entry.id, "CHECKED_IN");
  return entry;
}

/* ------------------------------ SCORE DISPUTES ---------------------------------- */

export async function listDisputes(tournamentId) {
  const { data, error } = await supabase.from("match_disputes").select("*").eq("tournament_id", tournamentId).order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function raiseDispute(matchId, tournamentId, type, description) {
  const session = await getSession();
  const role = session ? await getMyRole(tournamentId) : null;
  const { error } = await supabase.from("match_disputes").insert({
    match_id: matchId, tournament_id: tournamentId, type, description,
    raised_by: session?.user.id ?? null, raised_by_role: role,
  });
  if (error) throw error;
}

export async function resolveDispute(disputeId, status, resolutionNote) {
  const session = await getSession();
  const { error } = await supabase.from("match_disputes").update({
    status, resolution_note: resolutionNote, resolved_at: new Date().toISOString(), resolved_by: session?.user.id ?? null,
  }).eq("id", disputeId);
  if (error) throw error;
}

/* --------------------------- CSV / BULK PARTICIPANT IMPORT ---------------------- */

// Bulk-imports pre-validated rows (validation happens client-side in
// CsvImportModal so the organizer can fix errors before anything is
// written). Each row becomes one entry + its player(s), same shape as
// registerEntry() but using the owner_insert_entries policy so it works
// regardless of registration status.
export async function importEntries(eventId, feeINR, rows) {
  const results = { imported: 0, failed: [] };
  for (const row of rows) {
    try {
      const players = row.partnerName
        ? [{ name: row.name, phone: row.phone, email: row.email }, { name: row.partnerName, phone: row.partnerPhone, email: row.partnerEmail }]
        : [{ name: row.name, phone: row.phone, email: row.email }];
      const entry = await registerEntry(eventId, players, feeINR);
      if (row.seed) await supabase.from("entries").update({ seed: Number(row.seed) }).eq("id", entry.id);
      if (row.paymentStatus === "PAID") await supabase.from("entries").update({ payment_status: "PAID", reg_status: "CONFIRMED" }).eq("id", entry.id);
      results.imported++;
    } catch (e) {
      results.failed.push({ row, error: e.message });
    }
  }
  return results;
}

/* --------------------------- REALTIME ---------------------------------------- */

// Subscribes to live changes for one event (matches + entries). `games`
// rows don't carry event_id directly, so filter those client-side against
// the match ids you already have loaded, or denormalize event_id onto
// `games` later if you want a server-side filter instead.
export function subscribeToEvent(eventId, onChange) {
  const channel = supabase
    .channel(`event-${eventId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "matches", filter: `event_id=eq.${eventId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "entries", filter: `event_id=eq.${eventId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "games" }, onChange)
    .subscribe();
  return () => supabase.removeChannel(channel);
}

/* ══════════════════════════ PLAYER ACCOUNTS ══════════════════════════════
   A player is a `players` row linked to an auth user. The row may already
   exist (created when an organizer registered them, keyed on phone) — see
   link_my_player() in migration 008 for exactly when claiming an existing row
   is allowed. Everything below operates on the signed-in user's own row only.
   ======================================================================== */

// The signed-in user's player row, or null if they haven't claimed/created one.
export async function getMyPlayer() {
  const session = await getSession();
  if (!session) return null;
  const { data, error } = await supabase
    .from("players").select("*").eq("user_id", session.user.id).maybeSingle();
  if (error) throw error;
  return data;
}

// Claim an existing player row (by verified email, or by phone when that row
// carries no conflicting email) or create a fresh one. Idempotent.
export async function linkMyPlayer({ phone, name } = {}) {
  const { data, error } = await supabase.rpc("link_my_player", {
    p_phone: phone || null, p_name: name || null,
  });
  if (error) throw error;
  return data;
}

export async function updateMyProfile(patch) {
  const session = await getSession();
  if (!session) throw new Error("You must be signed in.");
  const { data, error } = await supabase
    .from("players").update(patch).eq("user_id", session.user.id).select().single();
  if (error) throw error;
  return data;
}

// Uploads to the public `avatars` bucket under <uid>/… — the storage policy
// only lets a user write inside their own folder.
export async function uploadAvatar(file) {
  const session = await getSession();
  if (!session) throw new Error("You must be signed in.");
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `${session.user.id}/avatar-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
  if (error) throw error;
  return supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl;
}

export async function uploadTournamentMedia(tournamentId, file, kind = "asset") {
  const ext = (file.name.split(".").pop() || "png").toLowerCase();
  const path = `${tournamentId}/${kind}-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from("tournament-media").upload(path, file, { upsert: true });
  if (error) throw error;
  return supabase.storage.from("tournament-media").getPublicUrl(path).data.publicUrl;
}

// Everything the player dashboard needs, in one pass: their entries with
// tournament/event context, every match those entries appear in, and both
// sides resolved to display names through the public name-only projection.
export async function getMyPlayerData() {
  const player = await getMyPlayer();
  const empty = { player, entries: [], matches: [], entriesById: {}, myEntryIds: [] };
  if (!player) return empty;

  const { data: links, error: lErr } = await supabase
    .from("entry_players").select("entry_id").eq("player_id", player.id);
  if (lErr) throw lErr;
  const myEntryIds = [...new Set((links || []).map((l) => l.entry_id))];
  if (!myEntryIds.length) return empty;

  const { data: entries, error: eErr } = await supabase
    .from("entries")
    .select("*, tournament_events(*, tournaments(*))")
    .in("id", myEntryIds);
  if (eErr) throw eErr;

  const eventIds = [...new Set((entries || []).map((e) => e.event_id))];
  let matches = [];
  if (eventIds.length) {
    const idList = myEntryIds.join(",");
    const { data, error: mErr } = await supabase
      .from("matches").select("*, games(*), courts(id, name)")
      .in("event_id", eventIds)
      .or(`entry_a.in.(${idList}),entry_b.in.(${idList})`);
    if (mErr) throw mErr;
    matches = data || [];
  }

  const allEntryIds = [...new Set([
    ...myEntryIds,
    ...matches.flatMap((m) => [m.entry_a, m.entry_b]).filter(Boolean),
  ])];
  const { data: names } = await supabase
    .from("public_entry_names").select("entry_id, name, player_id").in("entry_id", allEntryIds);
  const byEntry = {};
  (names || []).forEach((n) => { (byEntry[n.entry_id] = byEntry[n.entry_id] || []).push(n); });

  const entriesById = {};
  (entries || []).forEach((e) => { entriesById[e.id] = { ...e, entry_players: byEntry[e.id] || [] }; });
  allEntryIds.forEach((id) => {
    if (!entriesById[id]) entriesById[id] = { id, entry_players: byEntry[id] || [] };
  });

  return {
    player,
    entries: (entries || []).map((e) => ({ ...e, entry_players: byEntry[e.id] || [] })),
    matches,
    entriesById,
    myEntryIds,
  };
}

/* ══════════════════════════ STAFF / OFFICIALS ════════════════════════════ */

// tournament_staff is a security_invoker view over tournament_members that
// joins a display name in, so the UI never needs to read auth.users.
export async function listStaff(tournamentId) {
  const { data, error } = await supabase
    .from("tournament_staff").select("*").eq("tournament_id", tournamentId).order("created_at");
  if (error) throw error;
  return data || [];
}

// Records a pending invite. Resolving an email address to a user id, and
// sending the actual invitation mail, both require Supabase's admin API with
// the service_role key — which must never run in the browser. So the invite
// sits here until that person signs in with the same address, at which point
// claimMyInvites() turns it into a real tournament_members row.
// See supabase-integration/README.md for the server-side piece.
export async function inviteStaff(tournamentId, email, role) {
  const session = await getSession();
  const { error } = await supabase.from("tournament_invites").insert({
    tournament_id: tournamentId, email: email.trim().toLowerCase(), role,
    created_by: session?.user?.id ?? null,
  });
  if (error) throw error;
}

export async function listInvites(tournamentId) {
  const { data, error } = await supabase
    .from("tournament_invites").select("*").eq("tournament_id", tournamentId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function revokeInvite(inviteId) {
  const { error } = await supabase.from("tournament_invites").update({ status: "REVOKED" }).eq("id", inviteId);
  if (error) throw error;
}

// Called once after every sign-in: turns any pending invite addressed to this
// user's (Supabase-verified) email into a staff role.
export async function claimMyInvites() {
  const { data, error } = await supabase.rpc("claim_my_invites");
  if (error) return 0; // never block sign-in on this
  return data || 0;
}

export async function assignMatchOfficials(matchId, patch) {
  const { error } = await supabase.from("matches").update(patch).eq("id", matchId);
  if (error) throw error;
}

/* ══════════════════════════ FINANCE ══════════════════════════════════════ */

// The provider-neutral payment ledger for one tournament. `payments` rows are
// written server-side only (the mock provider, or the Razorpay webhook using
// the service_role key) — this is a read.
export async function listPayments(tournamentId) {
  const { data, error } = await supabase
    .from("payments")
    .select("*, entries!inner(id, event_id, fee_inr, tournament_events!inner(id, tournament_id))")
    .eq("entries.tournament_events.tournament_id", tournamentId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

/* ══════════════════════════ MATCH DETAIL ════════════════════════════════ */

// One match with everything a detail page shows, resolved for whoever is
// asking: organizers/staff get full rows through RLS, the public gets the
// name-only projection. Works logged-out.
export async function getMatchDetail(matchId) {
  const { data: match, error } = await supabase
    .from("matches").select("*, games(*), courts(id, name)").eq("id", matchId).single();
  if (error) throw error;

  const { data: event, error: evErr } = await supabase
    .from("tournament_events").select("*, tournaments(*)").eq("id", match.event_id).single();
  if (evErr) throw evErr;

  // Feeder matches and the match the winner advances into — enough to answer
  // "where did these two come from, and who do I play next?".
  const { data: siblings } = await supabase
    .from("matches")
    .select("id, round, match_number, status, entry_a, entry_b, winner_entry_id, next_match_id, next_slot, scheduled_at, court, group_label")
    .eq("event_id", match.event_id);

  const entryIds = [...new Set([
    match.entry_a, match.entry_b,
    ...(siblings || [])
      .filter((s) => s.next_match_id === match.id || s.id === match.next_match_id)
      .flatMap((s) => [s.entry_a, s.entry_b]),
  ].filter(Boolean))];

  const entriesById = {};
  if (entryIds.length) {
    const { data: names } = await supabase
      .from("public_entry_names").select("entry_id, name, player_id").in("entry_id", entryIds);
    const byEntry = {};
    (names || []).forEach((n) => { (byEntry[n.entry_id] = byEntry[n.entry_id] || []).push(n); });
    entryIds.forEach((id) => { entriesById[id] = { id, entry_players: byEntry[id] || [] }; });
  }

  // Officials, resolved through the same staff view the organizer uses. Comes
  // back empty for anonymous visitors (RLS), which is correct — who is
  // officiating is not public information.
  let officials = { scorer: null, referee: null };
  if (match.scorer_id || match.referee_id) {
    const { data: staff } = await supabase
      .from("tournament_staff").select("user_id, display_name, role")
      .eq("tournament_id", event.tournament_id);
    const byUser = Object.fromEntries((staff || []).map((s) => [s.user_id, s]));
    officials = { scorer: byUser[match.scorer_id] || null, referee: byUser[match.referee_id] || null };
  }

  return {
    match, event, tournament: event.tournaments, entriesById, officials,
    feeders: (siblings || []).filter((s) => s.next_match_id === match.id),
    nextMatch: (siblings || []).find((s) => s.id === match.next_match_id) || null,
  };
}

export function subscribeToMatch(matchId, onChange) {
  const channel = supabase
    .channel(`match-${matchId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "matches", filter: `id=eq.${matchId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "games", filter: `match_id=eq.${matchId}` }, onChange)
    .subscribe();
  return () => supabase.removeChannel(channel);
}

/* ══════════════════════════ DISCOVERY ═══════════════════════════════════ */

// Published tournaments enriched with the per-category facts a discovery card
// and its filters need: divisions offered, fee range, capacity and how much of
// it is taken. Anonymous-safe — RLS already limits `entries` reads to
// published events, and only ids/status are selected, never names.
export async function listDiscoverableTournaments() {
  const tournaments = await listPublishedTournaments();
  if (!tournaments.length) return [];

  const ids = tournaments.map((t) => t.id);
  const { data: events, error: evErr } = await supabase
    .from("tournament_events").select("*").in("tournament_id", ids).order("sort_order");
  if (evErr) throw evErr;

  const eventIds = (events || []).map((e) => e.id);
  const counts = {};
  if (eventIds.length) {
    const { data: entries, error: enErr } = await supabase
      .from("entries").select("event_id, reg_status").in("event_id", eventIds);
    if (enErr) throw enErr;
    (entries || []).forEach((e) => {
      if (e.reg_status === "REJECTED" || e.reg_status === "CANCELLED") return;
      counts[e.event_id] = (counts[e.event_id] || 0) + 1;
    });
  }

  const eventsByTournament = {};
  (events || []).forEach((e) => {
    const taken = counts[e.id] || 0;
    (eventsByTournament[e.tournament_id] = eventsByTournament[e.tournament_id] || [])
      .push({ ...e, taken, spotsLeft: Math.max(0, (e.max_entries || 0) - taken) });
  });

  return tournaments.map((t) => {
    const evs = eventsByTournament[t.id] || [];
    const fees = evs.map((e) => Number(e.fee_inr || 0));
    return {
      ...t,
      events: evs,
      categories: [...new Set(evs.map((e) => e.category))],
      ageGroups: [...new Set(evs.map((e) => e.age_group || "OPEN"))],
      skillGrades: [...new Set(evs.map((e) => e.skill_grade).filter(Boolean))],
      minFee: fees.length ? Math.min(...fees) : 0,
      maxFee: fees.length ? Math.max(...fees) : 0,
      spotsLeft: evs.reduce((n, e) => n + e.spotsLeft, 0),
      capacity: evs.reduce((n, e) => n + (e.max_entries || 0), 0),
      registrationOpen: t.status === "REGISTRATION_OPEN" && evs.some((e) => e.status === "REGISTRATION_OPEN"),
    };
  });
}

/* ══════════════ ONE ACCOUNT, MANY ROLES ═════════════════════════════════

   MatchDay has exactly one kind of account. "Player", "organizer", "referee"
   and "scorer" are not account types and never were — they are capabilities a
   single auth user accumulates:

     players.user_id            -> this user competes
     tournaments.organizer_id   -> this user OWNS that tournament
     tournament_members.role    -> this user staffs that tournament

   All three are tournament-scoped except the player identity. Owning
   tournament A grants nothing whatsoever on tournament B — that boundary is
   enforced by RLS (is_tournament_owner / has_tournament_role), not here.
   This function only decides which navigation to show.
   ======================================================================== */

export async function getMyCapabilities() {
  const session = await getSession();
  const none = { signedIn: false, player: null, organizes: 0, memberships: [], officiates: 0, canOrganize: true };
  if (!session) return none;
  const uid = session.user.id;

  const [player, owned, memberships] = await Promise.all([
    getMyPlayer(),
    supabase.from("tournaments").select("id", { count: "exact", head: true }).eq("organizer_id", uid),
    supabase.from("tournament_members").select("tournament_id, role").eq("user_id", uid),
  ]);

  const rows = memberships.data || [];
  return {
    signedIn: true,
    userId: uid,
    player,
    organizes: (owned.count || 0) + rows.filter((r) => ["ORGANIZER", "ADMIN"].includes(r.role)).length,
    officiates: rows.filter((r) => ["REFEREE", "SCORER"].includes(r.role)).length,
    volunteers: rows.filter((r) => r.role === "VOLUNTEER").length,
    memberships: rows,
    // Anyone may create a tournament. Doing so makes them the owner of THAT
    // tournament; it does not change who they are anywhere else.
    canOrganize: true,
  };
}

// Every match this user is personally assigned to officiate, across all
// tournaments — the "Officiate" surface. Reads through the staff RLS
// (can_score_match), so it can only ever return matches they may act on.
export async function listMyAssignedMatches() {
  const session = await getSession();
  if (!session) return [];
  const uid = session.user.id;

  const { data, error } = await supabase
    .from("matches")
    .select("*, games(*), courts(id, name), tournament_events(id, category, age_group, skill_grade, format, total_rounds, tournaments(id, name, slug, status))")
    .or(`scorer_id.eq.${uid},referee_id.eq.${uid}`)
    .order("scheduled_at", { nullsFirst: false });
  if (error) throw error;

  const matches = data || [];
  const entryIds = [...new Set(matches.flatMap((m) => [m.entry_a, m.entry_b]).filter(Boolean))];
  const entriesById = {};
  if (entryIds.length) {
    const { data: names } = await supabase
      .from("public_entry_names").select("entry_id, name, player_id").in("entry_id", entryIds);
    const byEntry = {};
    (names || []).forEach((n) => { (byEntry[n.entry_id] = byEntry[n.entry_id] || []).push(n); });
    entryIds.forEach((id) => { entriesById[id] = { id, entry_players: byEntry[id] || [] }; });
  }

  return matches.map((m) => ({
    ...m,
    role: m.referee_id === uid && m.scorer_id === uid ? "BOTH" : m.referee_id === uid ? "REFEREE" : "SCORER",
    event: m.tournament_events,
    tournament: m.tournament_events?.tournaments,
    sideA: entriesById[m.entry_a] || null,
    sideB: entriesById[m.entry_b] || null,
  }));
}

/* ══════════════ RANKING TABLE ═══════════════════════════════════════════ */

// Site-wide ranking, computed from real completed matches. Pulls the match
// rows plus the event context the points model needs (round depth, champion),
// then aggregates per player. RLS already limits `matches` to published
// events, so an unpublished draft never contributes.
export async function getRankingData() {
  const { data: matches, error } = await supabase
    .from("matches")
    .select("id, event_id, round, group_label, status, entry_a, entry_b, winner_entry_id, completed_at")
    .in("status", ["COMPLETED", "WALKOVER"]);
  if (error) throw error;
  if (!matches?.length) return { players: [], matchesByPlayer: {}, eventById: {} };

  const eventIds = [...new Set(matches.map((m) => m.event_id).filter(Boolean))];
  const { data: events } = await supabase
    .from("tournament_events")
    .select("id, category, age_group, skill_grade, total_rounds, champion_entry_id, tournaments(id, sport)")
    .in("id", eventIds);
  const eventById = Object.fromEntries((events || []).map((e) => [e.id, e]));

  const entryIds = [...new Set(matches.flatMap((m) => [m.entry_a, m.entry_b]).filter(Boolean))];
  const { data: links } = await supabase
    .from("public_entry_names").select("entry_id, player_id").in("entry_id", entryIds);
  const entryToPlayer = {};
  (links || []).forEach((l) => { if (l.player_id) entryToPlayer[l.entry_id] = l.player_id; });

  // player_id -> { entryIds, matches }
  const byPlayer = {};
  for (const m of matches) {
    for (const entryId of [m.entry_a, m.entry_b]) {
      const pid = entryToPlayer[entryId];
      if (!pid) continue;
      const rec = (byPlayer[pid] = byPlayer[pid] || { entryIds: new Set(), matches: [] });
      rec.entryIds.add(entryId);
      if (!rec.matches.some((x) => x.id === m.id)) rec.matches.push(m);
    }
  }

  const playerIds = Object.keys(byPlayer);
  if (!playerIds.length) return { players: [], matchesByPlayer: {}, eventById };
  const { data: players } = await supabase.from("public_players").select("*").in("id", playerIds);

  return {
    players: players || [],
    matchesByPlayer: Object.fromEntries(
      Object.entries(byPlayer).map(([pid, r]) => [pid, { entryIds: [...r.entryIds], matches: r.matches }])
    ),
    eventById,
  };
}

/* ══════════════ TOURNAMENT SERIES (recurring competition) ════════════════

   A series is a name that groups existing tournaments — each matchday stays a
   normal tournament with its own events, draws and schedule. Standings across
   matchdays are an aggregation over those tournaments, not a second
   competition model.                                                        */

export async function listMySeries() {
  const session = await getSession();
  if (!session) return [];
  const { data, error } = await supabase
    .from("tournament_series").select("*").eq("owner_id", session.user.id).order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function createSeries({ name, description, sport = "badminton" }) {
  const session = await getSession();
  if (!session) throw new Error("You must be signed in.");
  const { data, error } = await supabase
    .from("tournament_series")
    .insert({ owner_id: session.user.id, name, description: description || null, sport })
    .select().single();
  if (error) throw error;
  return data;
}

export async function listSeriesTournaments(seriesId) {
  const { data, error } = await supabase
    .from("tournaments").select("*").eq("series_id", seriesId).order("series_round").order("start_date");
  if (error) throw error;
  return data || [];
}

/* ══════════════ REGISTRATION SUPPORT ════════════════════════════════════ */

// Live capacity for one event, used by the registration flow so the visitor
// is told "3 places left" or "you will join the waitlist" before they type
// anything. Counts only entries actually holding a place.
export async function getEventCapacity(eventId) {
  const { data, error } = await supabase
    .from("entries").select("reg_status").eq("event_id", eventId);
  if (error) throw error;
  const rows = data || [];
  return {
    taken: rows.filter((r) => ["PENDING", "CONFIRMED"].includes(r.reg_status)).length,
    waitlisted: rows.filter((r) => r.reg_status === "WAITLISTED").length,
  };
}

// Register the signed-in user into an event, linking the entry to their own
// player row so it lands on their dashboard immediately. Falls back to the
// anonymous path when nobody is signed in.
export async function registerMyself(eventId, players, feeINR, customAnswers = null) {
  const entry = await registerEntry(eventId, players, feeINR, customAnswers);
  return entry;
}

/* ------------------------------- FOLLOWS ---------------------------------- */

// Follow edges are deliberately minimal (migration 012): a user reads only
// their own rows, and counts come from an aggregate function so that no page
// can ever enumerate who follows whom.

export async function listMyFollows(subjectType = null) {
  const { data: sess } = await supabase.auth.getSession();
  if (!sess?.session) return [];
  let q = supabase.from("follows").select("id, subject_type, subject_id, created_at");
  if (subjectType) q = q.eq("subject_type", subjectType);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function isFollowing(subjectType, subjectId) {
  const { data: sess } = await supabase.auth.getSession();
  if (!sess?.session) return false;
  const { data, error } = await supabase
    .from("follows").select("id")
    .eq("subject_type", subjectType).eq("subject_id", subjectId)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

export async function followSubject(subjectType, subjectId) {
  const { data: sess } = await supabase.auth.getSession();
  if (!sess?.session) throw new Error("Sign in to follow.");
  const { error } = await supabase.from("follows").insert({
    follower_id: sess.session.user.id, subject_type: subjectType, subject_id: subjectId,
  });
  // The unique constraint makes a double-follow harmless rather than an error
  // the UI has to explain.
  if (error && error.code !== "23505") throw error;
  return true;
}

export async function unfollowSubject(subjectType, subjectId) {
  const { error } = await supabase
    .from("follows").delete()
    .eq("subject_type", subjectType).eq("subject_id", subjectId);
  if (error) throw error;
  return true;
}

// Aggregate only — returns a number, never an identity.
export async function getFollowerCount(subjectType, subjectId) {
  const { data, error } = await supabase.rpc("follower_count", {
    p_subject_type: subjectType, p_subject_id: subjectId,
  });
  if (error) throw error;
  return Number(data || 0);
}

// One round trip for a list of subjects instead of N.
export async function getFollowerCounts(subjectType, subjectIds) {
  if (!subjectIds?.length) return {};
  const { data, error } = await supabase.rpc("follower_counts", {
    p_subject_type: subjectType, p_subject_ids: subjectIds,
  });
  if (error) throw error;
  return Object.fromEntries((data || []).map((r) => [r.subject_id, Number(r.followers)]));
}

// The tournaments a player follows, resolved to real rows for their dashboard.
export async function listFollowedTournaments() {
  const follows = await listMyFollows("TOURNAMENT");
  if (!follows.length) return [];
  const { data, error } = await supabase
    .from("tournaments")
    .select("id, name, slug, venue, location, start_date, end_date, status, sport, logo_url, accent_color")
    .in("id", follows.map((f) => f.subject_id))
    .order("start_date", { ascending: true });
  if (error) throw error;
  return data || [];
}

// Followed players, via the public projection so no PII is pulled in.
export async function listFollowedPlayers() {
  const follows = await listMyFollows("PLAYER");
  if (!follows.length) return [];
  const { data, error } = await supabase
    .from("public_players")
    .select("id, name, city, club, photo_url, skill_level")
    .in("id", follows.map((f) => f.subject_id));
  if (error) throw error;
  return data || [];
}

export function subscribeToMyMatches(entryIds, onChange) {
  if (!entryIds?.length) return () => {};
  // `matches` has no player column to filter on server-side, so this listens
  // to the tournaments the player is actually in via their events instead.
  const channel = supabase
    .channel(`my-matches-${entryIds[0]}`)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "matches" }, (payload) => {
      const m = payload.new;
      if (entryIds.includes(m.entry_a) || entryIds.includes(m.entry_b)) onChange(m);
    })
    .subscribe();
  return () => supabase.removeChannel(channel);
}

/* ══════════════ SERIES MANAGEMENT ═══════════════════════════════════════
   A series groups existing tournaments into matchdays. Nothing about the
   tournament model changes — series_id/series_round are just a label and an
   order — so every draw, schedule and result keeps working exactly as it does
   for a standalone tournament.                                             */

export async function getSeries(seriesId) {
  const { data, error } = await supabase.from("tournament_series").select("*").eq("id", seriesId).single();
  if (error) throw error;
  return data;
}

export async function updateSeries(seriesId, patch) {
  const { error } = await supabase.from("tournament_series").update(patch).eq("id", seriesId);
  if (error) throw error;
}

export async function deleteSeries(seriesId) {
  // tournaments.series_id is ON DELETE SET NULL, so removing a series never
  // deletes the tournaments in it — they simply become standalone again.
  const { error } = await supabase.from("tournament_series").delete().eq("id", seriesId);
  if (error) throw error;
}

// Attach/detach a tournament. Only the tournament's own organizer can do this
// (RLS on tournaments), which is the right boundary: a series owner cannot
// pull somebody else's tournament into their series.
export async function setTournamentSeries(tournamentId, seriesId, seriesRound = null) {
  const { error } = await supabase
    .from("tournaments").update({ series_id: seriesId, series_round: seriesRound }).eq("id", tournamentId);
  if (error) throw error;
}

export async function reorderSeriesTournaments(orderedIds) {
  // Small lists (matchdays), so a per-row update is fine and keeps this
  // readable; revisit only if a series ever holds hundreds of matchdays.
  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase.from("tournaments").update({ series_round: i + 1 }).eq("id", orderedIds[i]);
    if (error) throw error;
  }
}

// Tournaments this organizer owns that are not yet in any series — the
// candidate list for "add a matchday".
export async function listAttachableTournaments() {
  const session = await getSession();
  if (!session) return [];
  const { data, error } = await supabase
    .from("tournaments").select("*")
    .eq("organizer_id", session.user.id).is("series_id", null)
    .order("start_date", { ascending: false });
  if (error) throw error;
  return data || [];
}

/* ---- Series standings source data --------------------------------------
   Everything needed to aggregate real results across a series, in one pass.
   Reads only completed matches from tournaments actually in the series; RLS
   still restricts this to published events, so a draft matchday contributes
   nothing until it is published.                                           */
export async function getSeriesData(seriesId) {
  const [series, tournaments] = await Promise.all([
    getSeries(seriesId),
    listSeriesTournaments(seriesId),
  ]);
  const empty = { series, tournaments, events: [], matches: [], players: [], entryToPlayer: {}, eventById: {}, entriesByTournament: {} };
  if (!tournaments.length) return empty;

  const tIds = tournaments.map((t) => t.id);
  const { data: events, error: evErr } = await supabase
    .from("tournament_events").select("*").in("tournament_id", tIds);
  if (evErr) throw evErr;
  if (!events?.length) return empty;

  const eventIds = events.map((e) => e.id);
  const [{ data: matches, error: mErr }, { data: entries, error: enErr }] = await Promise.all([
    supabase.from("matches")
      .select("id, event_id, round, group_label, status, entry_a, entry_b, winner_entry_id, completed_at")
      .in("event_id", eventIds).in("status", ["COMPLETED", "WALKOVER"]),
    supabase.from("entries").select("id, event_id, reg_status").in("event_id", eventIds),
  ]);
  if (mErr) throw mErr;
  if (enErr) throw enErr;

  // Resolve entries to persistent players through the name-only public view,
  // so this works for anonymous visitors too and never touches contact details.
  const allEntryIds = [...new Set((entries || []).map((e) => e.id))];
  const entryToPlayer = {};
  const entryNames = {};
  if (allEntryIds.length) {
    const { data: links } = await supabase
      .from("public_entry_names").select("entry_id, name, player_id").in("entry_id", allEntryIds);
    (links || []).forEach((l) => {
      if (l.player_id) entryToPlayer[l.entry_id] = l.player_id;
      (entryNames[l.entry_id] = entryNames[l.entry_id] || []).push(l.name);
    });
  }

  const playerIds = [...new Set(Object.values(entryToPlayer))];
  let players = [];
  if (playerIds.length) {
    const { data } = await supabase.from("public_players").select("*").in("id", playerIds);
    players = data || [];
  }

  const eventById = Object.fromEntries(events.map((e) => [e.id, e]));
  const tournamentByEvent = Object.fromEntries(events.map((e) => [e.id, e.tournament_id]));

  return {
    series, tournaments, events,
    matches: matches || [],
    entries: entries || [],
    players, entryToPlayer, entryNames, eventById, tournamentByEvent,
  };
}

// Series a given player has competed in — used on the player dashboard.
export async function getMySeries() {
  const player = await getMyPlayer();
  if (!player) return [];

  const { data: links } = await supabase
    .from("entry_players").select("entry_id").eq("player_id", player.id);
  const entryIds = [...new Set((links || []).map((l) => l.entry_id))];
  if (!entryIds.length) return [];

  const { data: entries } = await supabase
    .from("entries")
    .select("id, tournament_events(tournament_id, tournaments(id, name, series_id, series_round, status, start_date))")
    .in("id", entryIds);

  const bySeries = {};
  (entries || []).forEach((e) => {
    const t = e.tournament_events?.tournaments;
    if (!t?.series_id) return;
    (bySeries[t.series_id] = bySeries[t.series_id] || { seriesId: t.series_id, tournaments: [] });
    if (!bySeries[t.series_id].tournaments.some((x) => x.id === t.id)) {
      bySeries[t.series_id].tournaments.push(t);
    }
  });

  const ids = Object.keys(bySeries);
  if (!ids.length) return [];
  const { data: series } = await supabase.from("tournament_series").select("*").in("id", ids);
  return (series || []).map((s) => ({ ...s, myTournaments: bySeries[s.id].tournaments }));
}
