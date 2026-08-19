import { supabase } from "./supabaseClient";

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
   - devSimulatePayment() is exactly what it says — a stand-in so the UI has
     something to call. Replace with the Razorpay order+webhook flow before
     charging anyone for real; payment_status must only ever be set by the
     server-side webhook (using the service_role key), never by the client.
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

/* ------------------------- TOURNAMENTS ------------------------------------ */

export async function listPublishedTournaments() {
  const { data, error } = await supabase.from("tournaments").select("*").neq("status", "DRAFT").order("start_date");
  if (error) throw error;
  return data;
}
export async function listMyTournaments() {
  const { data, error } = await supabase.from("tournaments").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return data;
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

  const eventRows = categories.map((c) => ({
    tournament_id: tournament.id, category: c.category, max_entries: c.maxEntries, fee_inr: c.feeINR,
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
  const { data, error } = await supabase.from("tournament_events").select("*").eq("tournament_id", tournamentId);
  if (error) throw error;
  return data;
}

export async function listEntries(eventId) {
  const { data, error } = await supabase
    .from("entries").select("*, entry_players(*)").eq("event_id", eventId).order("created_at");
  if (error) throw error;
  return data;
}

// Public registration — works for anon visitors because of the
// "public_register_entries" / "public_insert_entry_players" RLS policies,
// gated to REGISTRATION_OPEN events only. The capacity trigger on entries
// will raise a Postgres exception ("This category is full.") if the event
// is already at max_entries; surface that error message directly to the UI.
export async function registerEntry(eventId, players, feeINR) {
  const { data: entry, error: eErr } = await supabase
    .from("entries")
    .insert({ event_id: eventId, type: players.length > 1 ? "DOUBLES" : "SINGLES", fee_inr: feeINR ?? 0 })
    .select()
    .single();
  if (eErr) throw eErr;

  const rows = players.map((p) => ({ entry_id: entry.id, name: p.name, phone: p.phone, email: p.email }));
  const { error: pErr } = await supabase.from("entry_players").insert(rows);
  if (pErr) throw pErr;
  return entry;
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

// DEV ONLY — see file header. Replace with the Razorpay webhook before launch.
export async function devSimulatePayment(entryId, succeeded = true) {
  const patch = succeeded
    ? { payment_status: "PAID", reg_status: "CONFIRMED" }
    : { payment_status: "FAILED" };
  const { error } = await supabase.from("entries").update(patch).eq("id", entryId);
  if (error) throw error;
}

/* ----------------------------- DRAW ---------------------------------------- */

const nextPow2 = (n) => { let p = 1; while (p < n) p *= 2; return p; };

export async function generateDraw(eventId) {
  const { data: entries, error: enErr } = await supabase
    .from("entries").select("id, created_at").eq("event_id", eventId).eq("reg_status", "CONFIRMED").order("created_at");
  if (enErr) throw enErr;
  if (entries.length < 2) throw new Error("At least 2 confirmed entries are required to generate a draw.");

  const seeded = entries.map((e, i) => ({ id: e.id, seed: i + 1 }));
  const n = seeded.length;
  const size = nextPow2(n);
  const totalRounds = Math.log2(size);
  const byeCount = size - n;
  const byeSeeds = seeded.slice(0, byeCount);
  const playSeeds = seeded.slice(byeCount);
  const playMatchesCount = playSeeds.length / 2;

  let matchNumber = 1;
  const round1 = [];
  byeSeeds.forEach((s) => {
    round1.push({
      id: crypto.randomUUID(), event_id: eventId, round: 1, match_number: matchNumber++,
      entry_a: s.id, entry_b: null, is_bye: true, status: "WALKOVER",
      winner_entry_id: s.id, completed_at: new Date().toISOString(),
    });
  });
  for (let i = 0; i < playMatchesCount; i++) {
    const a = playSeeds[i], b = playSeeds[playSeeds.length - 1 - i];
    round1.push({
      id: crypto.randomUUID(), event_id: eventId, round: 1, match_number: matchNumber++,
      entry_a: a.id, entry_b: b.id, is_bye: false, status: "PENDING",
    });
  }

  const rounds = [round1];
  let prev = round1;
  for (let r = 2; r <= totalRounds; r++) {
    const roundMatches = [];
    for (let i = 0; i < prev.length / 2; i++) {
      roundMatches.push({
        id: crypto.randomUUID(), event_id: eventId, round: r, match_number: matchNumber++,
        entry_a: null, entry_b: null, is_bye: false, status: "PENDING",
      });
    }
    prev.forEach((m, idx) => {
      const target = roundMatches[Math.floor(idx / 2)];
      m.next_match_id = target.id;
      m.next_slot = idx % 2 === 0 ? "A" : "B";
    });
    rounds.push(roundMatches);
    prev = roundMatches;
  }

  // All match ids are already known client-side (crypto.randomUUID()), so
  // round-1 rows can point at round-2 rows in the SAME insert — Postgres
  // checks non-deferred foreign keys at end-of-statement, not per-row.
  const all = rounds.flat();
  all.filter((m) => m.is_bye).forEach((bm) => {
    if (!bm.next_match_id) return;
    const target = all.find((m) => m.id === bm.next_match_id);
    if (bm.next_slot === "A") target.entry_a = bm.winner_entry_id; else target.entry_b = bm.winner_entry_id;
  });

  const { error: insErr } = await supabase.from("matches").insert(all);
  if (insErr) throw insErr;

  const { error: updErr } = await supabase.from("tournament_events")
    .update({ status: "DRAW_READY", total_rounds: totalRounds }).eq("id", eventId);
  if (updErr) throw updErr;
}

/* --------------------------- SCHEDULE --------------------------------------- */

export async function generateSchedule(eventId) {
  const { data: event, error: evErr } = await supabase.from("tournament_events").select("*").eq("id", eventId).single();
  if (evErr) throw evErr;
  const { data: tournament } = await supabase.from("tournaments").select("*").eq("id", event.tournament_id).single();
  const { data: courts } = await supabase.from("courts").select("*").eq("tournament_id", tournament.id).eq("status", "AVAILABLE");
  const { data: matches } = await supabase.from("matches").select("*").eq("event_id", eventId).order("match_number");

  const numCourts = Math.max(1, (courts || []).length);
  const duration = tournament.settings?.matchDurationMins || 40;
  const startBase = new Date(`${tournament.start_date}T${tournament.settings?.startTime || "09:00"}:00`);

  const byRound = {};
  matches.forEach((m) => { (byRound[m.round] = byRound[m.round] || []).push(m); });
  const roundNums = Object.keys(byRound).map(Number).sort((a, b) => a - b);

  let baseMinutes = 0;
  for (const r of roundNums) {
    const playable = byRound[r].filter((m) => !m.is_bye).sort((a, b) => a.match_number - b.match_number);
    for (let idx = 0; idx < playable.length; idx++) {
      const m = playable[idx];
      const court = courts[idx % numCourts];
      const slot = Math.floor(idx / numCourts);
      const start = new Date(startBase.getTime() + (baseMinutes + slot * duration) * 60000);
      const { error } = await supabase.from("matches").update({
        court: court ? court.name : `Court ${(idx % numCourts) + 1}`,
        scheduled_at: start.toISOString(),
        status: m.entry_a && m.entry_b ? "READY" : "SCHEDULED",
      }).eq("id", m.id);
      if (error) throw error;
    }
    const slotsUsed = Math.ceil(playable.length / numCourts) || 0;
    baseMinutes += slotsUsed * duration + 10;
  }

  await supabase.from("tournament_events").update({ status: "SCHEDULED" }).eq("id", eventId);
}

/* ----------------------------- MATCHES (read) ---------------------------------- */

// Matches for an event, each with its games nested (needed for bracket/scorer/results UI).
export async function listMatches(eventId) {
  const { data, error } = await supabase
    .from("matches").select("*, games(*)").eq("event_id", eventId).order("match_number");
  if (error) throw error;
  return data;
}

/* --------------------------- NOTIFICATIONS -------------------------------------- */

export async function listNotifications(tournamentId) {
  const { data, error } = await supabase
    .from("notifications").select("*").eq("tournament_id", tournamentId).order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}
export async function markNotificationsRead(tournamentId) {
  const { error } = await supabase.from("notifications")
    .update({ read: true }).eq("tournament_id", tournamentId).eq("read", false);
  if (error) throw error;
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

export async function scorePoint(matchId, side, delta) {
  const { data: match, error } = await supabase.from("matches").select("*, games(*)").eq("id", matchId).single();
  if (error) throw error;
  if (match.status !== "LIVE") return;

  const games = [...match.games].sort((a, b) => a.game_number - b.game_number);
  const last = games[games.length - 1];
  const key = side === "A" ? "score_a" : "score_b";
  if (delta > 0 && (isGameOver(last.score_a, last.score_b) || last[key] >= 30)) return;
  const value = Math.max(0, last[key] + delta);

  await supabase.from("games").update({ [key]: value }).eq("id", last.id);
  const updatedLast = { ...last, [key]: value };
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
  } else {
    await supabase.from("tournament_events")
      .update({ status: "COMPLETED", champion_entry_id: winnerEntryId }).eq("id", match.event_id);
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
