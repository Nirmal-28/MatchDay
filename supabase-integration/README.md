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

## Migration 008 — core product layer

`migrations/008_core_product_layer.sql` is applied to the live project. It adds:

- **Player accounts.** `players.user_id` links a player identity to an auth
  user, plus `photo_url`, `date_of_birth`, `sports`, `skill_level`, `bio`.
  `link_my_player()` claims an existing phone/email-matched row so a player who
  was entered by an organizer arrives with their history attached.
- **A closed data leak.** `players` previously had `select using (true)` granted
  to `anon`, which exposed every registrant's phone number and email to anyone
  holding the publishable key. Direct table access is now revoked; anonymous
  registration goes through the `SECURITY DEFINER` `find_or_create_player()`
  function and public reads go through the name-only `public_players` view.
- **RBAC that actually works.** `tournament_members` existed, but nothing in the
  RLS on `matches`/`games` honoured it — a SCORER could open Scorer Mode and
  every write silently failed. Staff select/update policies added.
- **Per-match officials** (`matches.scorer_id`, `matches.referee_id`) and
  `tournament_invites` + `claim_my_invites()`.
- **Real notifications.** `notifications` gains `user_id`/`title`/`link`/
  `entry_id`/`match_id`, and four Postgres triggers write rows on the same
  statements that change the tournament — so a player is notified even when
  nobody had the relevant screen open.
- **Branding** (`logo_url`, `cover_image_url`, `accent_color`, `sponsors`,
  `announcement`) and two public storage buckets, `avatars` and
  `tournament-media`, each writable only inside the owner's own folder.

## Migration 009 — lifecycle, deadlines, series

Applied to the live project. Adds:

- **Registration windows.** `tournaments.registration_opens_at` /
  `registration_closes_at`. The public insert policy on `entries` now checks
  them, so registration opens and closes on its own — previously a passed
  deadline still accepted entries until someone manually closed the tournament.
  The organizer's own `owner_insert_entries` path is untouched, so they can
  still add a late entry deliberately.
- **`ARCHIVED` status**, plus a trigger that refuses to move a
  COMPLETED/CANCELLED/ARCHIVED tournament back to an earlier state.
- **Check-in staging.** A trigger rejects check-in unless the tournament is
  REGISTRATION_CLOSED or LIVE.
- **Published results are protected.** A trigger on `games` refuses inserts,
  updates and deletes once the parent match is COMPLETED/WALKOVER, unless the
  caller holds ORGANIZER/ADMIN — so a scorer device cannot silently rewrite a
  finished result; that is a correction, via the dispute flow.
- **A played draw cannot be regenerated.** A trigger on `matches` blocks
  deletion when any match in that event has been played. It deliberately
  allows cascade deletes (tournament → events → matches), detected by the
  parent event row already being gone.
- **`tournament_series`** + `tournaments.series_id` / `series_round`. A series
  is only a name grouping existing tournaments: each matchday stays a normal
  tournament with its own events, draws and schedule, so standings across
  matchdays are an aggregation rather than a second competition system.

### Lifecycle states: what is and isn't a column

`DRAW_READY` and `SCHEDULE_PUBLISHED` are **not** tournament statuses. They
already exist as `tournament_events.status = 'DRAW_READY'` (per category — one
category can be drawn while another isn't) and `tournaments.schedule_published`.
`src/lib/lifecycle.js` derives the single display stage from those, so the
database never holds two competing answers to "what stage is this?". The same
module exposes `canAct()`, which mirrors the triggers above so the UI can
explain why an action is unavailable instead of letting it fail.

## Series (Phase 3) — no new schema

Series shipped entirely on migration 009's `tournament_series` +
`tournaments.series_id` / `series_round`. **No migration 010 exists** and none
is needed: a series is an ordered label over existing tournaments, so every
draw, schedule and result keeps working exactly as it does standalone.

- `src/lib/seriesStandings.js` aggregates across matchdays. Three configurable
  scoring models (`standard`, `attendance`, `winsOnly`); the single-tournament
  ranking in `ranking.js` is untouched and still drives the leaderboard.
- A matchday with no completed matches contributes nothing — not zeros.
- `playerSeriesPosition()` reports movement only when there are two played
  matchdays to compare; otherwise it returns `null` rather than implying a trend.
- `npm run test:series` — 30 assertions over the pure aggregation, because no
  live tournament yet spans multiple matchdays. This caught a real
  double-counting bug (see below).

### Bug found and fixed by that test suite

A knockout champion was credited a title **twice** — once for winning the final
and again via `champion_entry_id` on an earlier match in the same division. The
title *count* was capped in `ranking.js` but the **points bonus was not**, so
every knockout champion's ranking points were silently inflated by one
`titleBonus` (400 for badminton). Fixed in both `ranking.js` and
`seriesStandings.js` by treating `champion_entry_id` as the single source of
truth and awarding the bonus once per player per division. Any ranking figure
shown before this fix was too high for champions; nothing was stored, so the
numbers correct themselves on next render.

## Migrations 010 and 011 — hardening, observability, notification delivery

> **These two are written but NOT applied.** The Supabase MCP connection was
> down when they were authored, so unlike 008 and 009 they have not been run
> against the live project. Apply them with `supabase db push`, or paste each
> into the SQL editor. Both are idempotent and safe to re-run.

**`010_hardening_and_observability.sql`**

- **`client_errors`** — insert-only from the browser, readable by nobody
  through the API. This is what makes a crash in someone else's browser
  visible to you at all; before it, the only bug report was a user complaining.
  `src/lib/monitoring.js` writes to it and scrubs emails, phone numbers and
  tokens out of every message first (asserted in `src/lib/monitoring.test.js`).
- **`analytics_events`** — same shape, for product usage. No third-party
  script, no cross-site cookie, so nothing here needs a consent banner.
- **`rate_limits` + `consume_rate_limit()`** — a rolling-window counter behind
  `find_or_create_player()` and public entry inserts. Registration and check-in
  were previously open to scripted abuse.
- **`find_or_create_player()` is no longer able to overwrite an existing row.**
  It used to update the name and email of any *unclaimed* player whose phone
  number the caller supplied — so an anonymous registration could rewrite that
  person's profile and attach its own email (which `link_my_player()` matches
  on). It now only ever creates.
- **`score_point_atomic()`** — does the read and the write in one statement
  with `for update`, closing the two-device scoring race that was previously
  documented as acceptable. `SECURITY INVOKER`, so the existing RLS on `games`
  still decides who may score; the function adds atomicity, never authority.
  `scorePoint()` falls back to the old client-side path if this function is
  absent, so an un-migrated project keeps working mid-tournament.
- **Length limits** on every free-text column that a form can reach, matching
  `LIMITS` in `src/lib/validation.js` exactly, so the user is told before the
  request rather than after Postgres rejects it.

**`011_notification_delivery.sql`** adds `notification_preferences`,
`push_subscriptions`, and `notifications.delivery` / `dispatched_at` — the
storage the `notify-dispatch` Edge Function needs. The trigger that calls that
function is included but **commented out**, because a trigger pointing at an
undeployed function would fail and roll back the tournament change that
produced the notification.

## Migration 012 — configurable registration fields + follows

**`012_registration_fields_and_follows.sql`** adds two things.

**Configurable registration fields.** Organizers can ask for more than
name/phone/email — club, skill level, jersey size, emergency contact, a waiver
acknowledgement. The field *definitions* live on
`tournaments.registration_fields` (jsonb, capped at 25) because they are
configuration, always read as a whole set with their tournament.

The *answers* deliberately do **not** live on `entries`. `select_entries`
(schema.sql) is readable by `anon` for any published event, so a
`custom_fields` column there would have made every emergency contact number
world-readable the moment the tournament went public. Answers therefore live
in `entry_details`, whose RLS restricts reads to the entry's own players and
the owning tournament's staff. Only fields the organizer explicitly marks
`visibility: "PUBLIC"` are exposed, through the `public_entry_details` view
which filters by the tournament's own field definitions. Private answers have
no public read path at all.

`src/lib/registrationFields.js` mirrors that boundary client-side and refuses
to let a field that looks like contact or identity data (`tel`/`email`/`date`
types, or a label matching emergency/phone/address/medical/…) be marked
public — the SQL view is the enforcement, this is just so the organizer never
gets that far.

Note the new helper `is_entry_tournament_staff()`: policies could not call the
existing `entry_tournament_id()` because 008 revoked `EXECUTE` on it from
`authenticated` to keep it off the RPC surface, and Postgres evaluates policy
expressions as the calling role.

**Follows.** One row per (user, subject) in `follows`, where subject is a
PLAYER or a TOURNAMENT. Deliberately not a social graph: a user can read only
their *own* follow rows, so nobody can enumerate who follows whom. Counts come
from `follower_count()` / `follower_counts()`, which are SECURITY DEFINER and
return numbers only. There is no feed, no follower list, and no mutual-follow
concept, by design.

## Migration 013 — P0: infinite RLS recursion on `matches`

**Apply this one first, ahead of anything else.** Until it is applied, every
authenticated user reading a tournament that has a draw gets:

```
GET /rest/v1/matches?select=*,games(*)  ->  500
{"code":"54001","message":"stack depth limit exceeded"}
```

That takes out the draw, bracket, schedule, live scoring, Scorer Mode,
results, Match Center, next-match and Tournament Health simultaneously.
Anonymous spectators are unaffected, because the failing policy is
`to authenticated` — which is exactly why public tournament pages kept
working and hid the problem for so long.

`can_score_match()` (migration 005) is `SECURITY INVOKER` *and* reads
`public.matches`, while being the `USING` clause of `staff_select_matches`
**on `public.matches`**. Reading a match re-enters the policy, which re-enters
the function. 013 changes one word — `security invoker` → `security definer` —
which is the same treatment migration 008 already gave `is_tournament_staff()`
for the identical reason.

It also resolves a transitive case: reading `games` evaluates
`is_match_owner()`, which reads `matches`, which re-entered the same cycle.

Guarded by `npm run test:migrations`, which applies 013 as shipped and asserts
both that the recursion is gone and that `SECURITY DEFINER` did not widen
access (a stranger still sees nothing; a SCORER sees only their own
tournament; published tournaments stay publicly readable).

## Applying 010, 011, 012 and 013 — exact procedure

All three are idempotent (`if not exists` / `drop policy if exists` / `create
or replace` throughout) and safe to re-run. **Apply them in order**, and apply
**013 first and on its own** — it is the only one repairing an active
outage, and it is a single `create or replace function`, so it is safe to
apply at any time and needs no coordination with the others. Confirm the app
works again before layering anything else on top.

```bash
# Option A — Supabase CLI (needs the DB password / a linked project)
supabase link --project-ref dkkpolnuywgvmlacjzto
supabase db push

# Option B — SQL editor: paste each file, in this order, one at a time
#   1. 013_fix_can_score_match_recursion.sql   <-- P0, apply first
#   2. 010_hardening_and_observability.sql
#   3. 011_notification_delivery.sql
#   4. 012_registration_fields_and_follows.sql
```

Applying 013 out of numeric order is fine and intentional: it only redefines a
function that has existed since 005, and depends on nothing 010–012 add.

Migration 012's DDL is executed against a real Postgres in CI
(`npm run test:migrations`, PGlite/WASM) — 24 assertions covering the
constraints, the policies and, most importantly, that answers marked PRIVATE
never appear in `public_entry_details`. That proves the SQL is valid and
self-consistent; it does **not** prove anything about your live project's data,
so still apply to staging first if you have one.

### Verifying after you apply

```sql
-- 013: can_score_match MUST come back with prosecdef = true. If it is false,
-- the fix did not land and matches will still 500 for signed-in users.
select proname, prosecdef as is_security_definer
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'can_score_match';
```

The end-to-end check that actually matters: sign in, open a tournament that
has a generated draw, and confirm the Draw tab renders a bracket instead of
"Generate the draw", and that the matches count in the header is non-zero.
Before 013 that page showed `MATCHES: 0` next to a `DRAW PUBLISHED` badge and
a red `stack depth limit exceeded` toast.

```sql
-- Expect 3 rows: score_point_atomic, consume_rate_limit, follower_count
select proname from pg_proc
where proname in ('score_point_atomic','consume_rate_limit','follower_count');

-- Expect 6 rows: client_errors, analytics_events, rate_limits,
-- notification_preferences, push_subscriptions, entry_details, follows
select tablename, rowsecurity from pg_tables
where schemaname = 'public'
  and tablename in ('client_errors','analytics_events','rate_limits',
                    'notification_preferences','push_subscriptions',
                    'entry_details','follows');
-- rowsecurity must be true for every one of them.

-- The PII boundary: this must return ZERO rows. Any row means a field marked
-- PRIVATE is reachable through the public view.
select d.entry_id, f.key
from public.entry_details d
join public.entries e            on e.id  = d.entry_id
join public.tournament_events ev on ev.id = e.event_id
join public.tournaments t        on t.id  = ev.tournament_id
cross join lateral (
  select value ->> 'key' k, value ->> 'visibility' v
  from jsonb_array_elements(t.registration_fields)
) f(key, visibility)
where f.visibility <> 'PUBLIC'
  and (select answers from public.public_entry_details p where p.entry_id = d.entry_id) ? f.key;
```

Once 010 is applied, confirm the scoring race is actually closed from the
client side too: score a point in Scorer Mode with the browser console open.
Before the migration you get

```
[repository] score_point_atomic() is not present — falling back to
client-side scoring. Apply migration 010 to remove the two-device race.
```

After it, that warning must not appear. If it still does, the function did not
land (check the schema cache — `notify pgrst, 'reload schema';`), and scoring
is still racy.

## External integrations still required

None of these can be done from the browser; each needs a server-side piece.

| Capability | What is built | What is still needed |
|---|---|---|
| **Staff invitation emails** | Invites are stored in `tournament_invites` and auto-convert to a real role via `claim_my_invites()` when that person signs in with the same address. | Resolving an email to a user id, or sending the invitation mail, needs Supabase's **admin API with the `service_role` key**. Build it as an Edge Function; it must never run client-side. Today the organizer sends the sign-in link themselves. |
| **Real payments** | Provider-neutral `payments` ledger, `PaymentProvider` boundary, `MockPaymentProvider` (explicitly fake), `RazorpayProvider` skeleton. | A Razorpay account, then deploy `edge-functions/razorpay-create-order` and `razorpay-webhook` with `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` as Supabase secrets. **`payment_status` may only ever be set to PAID by the webhook**, never by the browser. |
| **Email / SMS / push notifications** | In-app notifications are real and live. **The whole server-side path now exists**: `edge-functions/notify-dispatch` is complete (Resend for email, MSG91 for SMS, Web Push for push), `public/sw.js` is a working service worker, `src/lib/push.js` handles subscription, and migration 011 stores preferences, devices and per-channel delivery results. Each channel activates **only** when its secret is set and reports `skipped` otherwise — nothing claims to have sent anything. | Provider accounts and their secrets, then `supabase functions deploy notify-dispatch` and uncommenting the trigger in migration 011. For push, generate VAPID keys (`npx web-push generate-vapid-keys`) and set `VITE_VAPID_PUBLIC_KEY`; until you do, the push toggle in profile settings says it is unavailable rather than doing nothing silently. WhatsApp is still not implemented at all — it needs a Business API account and pre-approved templates. |
| **Leaked-password protection** | — | A dashboard toggle: Auth → Policies → enable HaveIBeenPwned checking. Flagged by the security advisor. |

### Two advisor warnings that are intentional

- `public_players` and `public_entry_names` are flagged as **security definer
  views**. That is the whole point of them: they are the safe, name-only
  projection that lets anonymous visitors read participant names for published
  tournaments *without* being able to read the underlying tables (which hold
  phone numbers and emails). Removing the property would either break public
  pages or re-open the leak.
- Internal helper functions (`notify_users`, `entry_user_ids`,
  `entry_tournament_id`, the `trg_notify_*` functions) have had `EXECUTE`
  revoked from `anon`/`authenticated`, so they no longer appear on the RPC
  surface. The four helpers used *inside RLS policy expressions*
  (`my_player_id`, `my_entry_ids`, `is_tournament_staff`,
  `has_tournament_role`) must keep `EXECUTE` for `authenticated` — Postgres
  evaluates policy expressions as the calling role, so revoking them makes
  every dependent policy fail closed.

## Honest gaps, so nothing surprises you later

- **No online payments.** There is no gateway connected, and nothing in the
  app claims otherwise. What *does* exist is `recordOfflinePayment()`, where
  the organizer asserts "I received this money" for cash/UPI collected at the
  venue — a permanent feature of how club tournaments actually run, restricted
  to the entry's own organizer by RLS. It is deliberately not the same
  operation as a gateway payment succeeding: when Razorpay is connected,
  `payment_status` for an *online* payment must only ever be written by the
  server-side webhook using the `service_role` key (never shipped to the
  browser). See `src/lib/payments/RazorpayProvider.js` for the full checklist.
  (This function was previously named `devSimulatePayment()`, which wrongly
  implied the app could fake a gateway success. It never could.)
- ~~**Scoring has a small race window.**~~ — **fixed in migration 010** by
  `score_point_atomic()`, which does the read and the write in one statement
  under a row lock. Note the client falls back to the old racy path if that
  function is missing, so this is only actually fixed once 010 is applied.
- **Schedule generation writes one row at a time.** Totally fine at
  tournament scale (tens of matches); if you ever generate schedules for
  hundreds of matches at once, move it into a Postgres function using
  `unnest()` for a single bulk update.
- ~~**No "scorer" role yet**~~ — **done in migration 008.** `tournament_members`
  carries ORGANIZER/ADMIN/REFEREE/SCORER/VOLUNTEER, `can_score_match()` gates
  the staff policies on `matches`/`games`, and matches can be assigned to a
  specific scorer and referee. Note that scoring permission comes from the
  *role*, not the assignment — any scorer can still cover any court, which is
  what actually happens at a venue; the assignment sorts and labels their own
  matches in Scorer Mode.
- **`find_or_create_player()` trusts the phone number it is given.**
  Migration 010 removed the worst half of this: it can no longer *modify* an
  existing row at all, so an anonymous caller can no longer rewrite an
  unclaimed player's name or attach their own email to it. What remains is
  that a caller who knows a phone number can attach a *registration* to that
  player. Closing that properly means phone OTP at registration, which needs
  an SMS provider and adds friction to the flow you most want people to
  finish — a product decision, not just a code change.

- **Leaked-password protection is still off.** It is a single dashboard
  toggle (Auth → Policies → enable HaveIBeenPwned) that cannot be set from
  code or from a migration. `validatePassword()` in `src/lib/validation.js` is
  the client-side floor beneath it — 8 characters minimum and a small
  blocklist — but it is not a substitute for a real breach corpus.
