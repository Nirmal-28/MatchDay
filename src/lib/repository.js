import { supabase } from "./supabaseClient";
import {
  nextPow2, bracketSeedOrder, roundRobinRounds, snakeIntoGroups, groupLetter, computeStandings,
} from "./engines";

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
    tournament_id: tournament.id, category: c.category,
    max_entries: c.maxEntries, fee_inr: c.feeINR,
    format: c.format || "SINGLE_ELIM",
    age_group: c.ageGroup || "OPEN",
    skill_grade: c.skillGrade || null,
    group_count: c.format === "GROUP_KO" ? (c.groupCount || 2) : null,
    advance_per_group: c.format === "GROUP_KO" ? (c.advancePerGroup || 2) : 2,
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
export async function registerEntry(eventId, players, feeINR) {
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
  return entry;
}

/* ---------------------------- PLAYERS -------------------------------------- */

const normPhone = (phone) => (phone || "").replace(/[^\d]/g, "").slice(-10);

// Find-or-create a player by phone. Returns null when no usable phone was
// given, in which case the entry simply stays unlinked rather than failing.
export async function upsertPlayer({ name, phone, email }) {
  const key = normPhone(phone);
  if (!key) return null;

  const { data: existing } = await supabase
    .from("players").select("*").eq("phone", key).maybeSingle();
  if (existing) {
    // Keep the freshest name/email we've seen, but never blank out a value.
    const patch = {};
    if (name && name !== existing.name) patch.name = name;
    if (email && email !== existing.email) patch.email = email;
    if (Object.keys(patch).length) {
      await supabase.from("players").update(patch).eq("id", existing.id);
    }
    return existing;
  }

  const { data, error } = await supabase
    .from("players").insert({ phone: key, name: name || "Unknown", email: email || null })
    .select().single();
  if (error) {
    // Lost a race against a concurrent registration for the same phone.
    const { data: raced } = await supabase.from("players").select("*").eq("phone", key).maybeSingle();
    if (raced) return raced;
    throw error;
  }
  return data;
}

export async function getPlayer(playerId) {
  const { data, error } = await supabase.from("players").select("*").eq("id", playerId).single();
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

// Site-wide leaderboard from every completed match in every published
// tournament. RLS on `matches` already restricts anon reads to published
// events, so no extra filtering is needed here. Pulls all completed matches
// client-side and aggregates — fine at today's scale; if match volume grows
// into the thousands this should move into a Postgres view instead.
export async function getLeaderboard(limit = 50) {
  const { data: matches, error } = await supabase
    .from("matches").select("entry_a, entry_b, winner_entry_id")
    .in("status", ["COMPLETED", "WALKOVER"]);
  if (error) throw error;
  if (!matches?.length) return [];

  const entryIds = [...new Set(matches.flatMap((m) => [m.entry_a, m.entry_b]).filter(Boolean))];
  if (!entryIds.length) return [];

  const { data: links, error: lErr } = await supabase
    .from("public_entry_names").select("entry_id, player_id").in("entry_id", entryIds);
  if (lErr) throw lErr;
  const entryToPlayer = Object.fromEntries((links || []).filter((l) => l.player_id).map((l) => [l.entry_id, l.player_id]));

  const stats = {};
  for (const m of matches) {
    for (const [entryId, won] of [[m.entry_a, m.winner_entry_id === m.entry_a], [m.entry_b, m.winner_entry_id === m.entry_b]]) {
      const playerId = entryToPlayer[entryId];
      if (!playerId) continue;
      stats[playerId] = stats[playerId] || { played: 0, won: 0 };
      stats[playerId].played++;
      if (won) stats[playerId].won++;
    }
  }

  const playerIds = Object.keys(stats);
  if (!playerIds.length) return [];
  const { data: players, error: pErr } = await supabase.from("public_players").select("*").in("id", playerIds);
  if (pErr) throw pErr;

  return players
    .map((p) => {
      const s = stats[p.id];
      return { ...p, played: s.played, won: s.won, winPct: s.played ? Math.round((s.won / s.played) * 100) : 0 };
    })
    .filter((p) => p.played >= 2) // one lucky match shouldn't top the board
    .sort((a, b) => b.won - a.won || b.winPct - a.winPct)
    .slice(0, limit);
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

// DEV ONLY — see file header. Replace with the Razorpay webhook before launch.
export async function devSimulatePayment(entryId, succeeded = true) {
  const patch = succeeded
    ? { payment_status: "PAID", reg_status: "CONFIRMED" }
    : { payment_status: "FAILED" };
  const { error } = await supabase.from("entries").update(patch).eq("id", entryId);
  if (error) throw error;
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
