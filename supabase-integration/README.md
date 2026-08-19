# Courtside — Supabase integration

## What's already done (live, on your Supabase project)

Project: **Tournament app 1** (`dkkpolnuywgvmlacjzto`, region `ap-south-1` / Mumbai)

- 9 tables: `tournaments`, `courts`, `tournament_events`, `entries`,
  `entry_players`, `matches`, `games`, `notifications`, `organizer_profiles`
- Row Level Security enabled on all 9, policies written so:
  - Anyone can view a *published* tournament and its categories/matches/schedule.
  - Only the organizer who created a tournament can see/edit it while it's
    still a draft, or modify anything about it once published.
  - Anyone can submit a registration into a category that's open — but only
    the organizer can approve/reject/remove entries or touch payment status.
  - Player phone numbers and emails are **never** exposed publicly — there's
    a separate `public_entry_names` view (name only) for public bracket/
    schedule pages to read from instead of the full `entry_players` table.
- A database trigger blocks registrations past `max_entries`, even under
  concurrent signups (race-safe, not just a client-side count check).
- Realtime is turned on for `tournaments`, `tournament_events`, `matches`,
  `games`, `entries`, `courts`, `notifications` — so live scores update
  everywhere instantly once you subscribe from the client.
- Ran the security + performance advisor twice and fixed everything it
  flagged except one intentional exception (see `schema.sql` comments on
  `public_entry_names`).

`schema.sql` in this folder is a readable copy of all of that — you don't
need to run it against the live project, it's already there. It's here so
it's version-controlled and rebuildable if you ever spin up a second
environment (staging, etc).

## What you need to do

1. **Drop these three files into a real React project** (Vite recommended —
   `npm create vite@latest my-app -- --template react`):
   - `supabaseClient.js`
   - `repository.js`
   - `.env.example` → copy to `.env`, values are already filled in with your
     project's public URL and publishable key (safe to commit `.env.example`,
     never commit the real `.env`).

2. **Install the client:**
   ```bash
   npm install @supabase/supabase-js
   ```

3. **Replace the reducer's dispatch calls with these functions.** The shape
   matches one-to-one with what the demo artifact's reducer does — e.g.
   `dispatch({type: "GENERATE_DRAW", payload: {eventId}})` becomes
   `await generateDraw(eventId)`. The big structural difference: the demo
   kept everything in one in-memory object; here each function is a real
   network call, so your components will want loading states and to
   re-fetch (or better, subscribe — see below) after each write.

4. **Wire up realtime instead of polling.** Call
   `subscribeToEvent(eventId, () => refetchEverything())` when a
   tournament/event view mounts, and unsubscribe (the function returns a
   cleanup) on unmount. That's what makes the live scoreboard update on
   every device without anyone refreshing.

5. **Add Supabase Auth to the organizer side.** `signUp` / `signIn` /
   `signOut` / `onAuthStateChange` are already written — you just need a
   login form. Until a user is signed in, `createTournament()` will throw
   ("You must be signed in..."), which is the RLS `owner_insert_tournaments`
   policy doing its job.

## Why this can't run live inside the chat preview

The interactive artifact preview here is sandboxed to a fixed set of
libraries and can't install `@supabase/supabase-js` or make outbound calls
to arbitrary domains — so I can't demo the real, connected version inside
this chat. These files are the real thing, meant for an actual project
(Claude Code, or any local dev setup) where they'll genuinely talk to your
database. If you want, I can help you scaffold that actual Vite project
next and wire the demo app's UI components into these functions properly.

## Honest gaps, so nothing surprises you later

- **Payments are still fake.** `devSimulatePayment()` sets `payment_status`
  directly from the client — that only exists so you can click through the
  UI. In production, `payment_status` must only ever be written by a
  server-side Razorpay webhook using the `service_role` key (never shipped
  to the browser). That's the next piece to build.
- **Scoring has a small race window.** `scorePoint()` reads the current
  score, computes the next value, and writes it back — safe for the normal
  case (one scorer device per match) but not against two devices scoring
  the same match at the exact same moment. Fine to ship with; worth
  revisiting with an atomic Postgres function if that ever becomes real.
- **Schedule generation writes one row at a time.** Totally fine at
  tournament scale (tens of matches); if you ever generate schedules for
  hundreds of matches at once, move it into a Postgres function using
  `unnest()` for a single bulk update.
- **No "scorer" role yet** — right now it's organizer-or-nobody for
  entering scores. RLS is already structured (ownership via the tournament)
  so adding a `scorers` table and a policy branch for "assigned scorer for
  this match" later is additive, not a rewrite.
