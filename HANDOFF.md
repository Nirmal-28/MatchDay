# MatchDay — orientation

> **Historical note.** Earlier versions of this file described a project that
> had not been scaffolded yet, whose "next steps" were *scaffold a Vite app*,
> *build auth UI*, and *wire the reference artifact to the repository layer*.
> All three were done long ago. That version of this file actively misled
> anyone who read it first, as it invited, so it has been replaced with an
> accurate map. `README.md` and `supabase-integration/README.md` are the
> authoritative documents; this one just points at them.

## What this is

**MatchDay** — a tournament operating system for sports, badminton-first,
built for the Indian organizer market. A real React 19 + Vite + Supabase
application, deployed, with a live database.

One account, many capabilities: the same person can be a **player**, an
**organizer**, a **scorer** and a **referee**. Roles are scoped per tournament
via `tournament_members` — organizing tournament A never grants any access to
tournament B, and that boundary is enforced in RLS, not in the UI.

## Where things live

| Path | What it is |
|---|---|
| `src/pages/` | Route-level screens (player dashboard, control center, public tournament page, scorer mode, venue display). |
| `src/components/` | Feature panels composed by those pages. |
| `src/lib/repository.js` | **The only** module that talks to Supabase. Everything else goes through it. |
| `src/lib/*.js` (engines) | Pure, dependency-free rule engines: `engines.js` (scoring, draws, standings), `schedulingEngine.js`, `intelligence.js`, `ranking.js`, `seriesStandings.js`, `lifecycle.js`. No Supabase, no React — unit-testable, and tested. |
| `supabase-integration/migrations/` | Ordered SQL migrations, 002 → 012. |
| `supabase-integration/README.md` | Migration-by-migration changelog, RLS reasoning, and an honest gaps list. **Read this before touching the schema.** |

`courtside_reference_artifact.jsx` at the repo root is the original
single-file prototype. It is kept for reference only; nothing imports it.

## The rules this codebase holds itself to

These are worth knowing before changing anything, because a lot of the code
is shaped by them:

1. **Never fabricate a number.** Analytics and intelligence return
   `{ available: false, reason }` rather than a plausible-looking zero. A
   projected finish time that is really a guess is worse than no projection,
   because an organizer will tell 60 players to arrive at it.
2. **Never claim an integration works when it doesn't.** No payment gateway,
   email, SMS, WhatsApp or push provider is connected. Each boundary exists,
   each reports `isConnected() === false`, and each refuses rather than
   silently swallowing a call.
3. **PII never reaches a public read path.** `entries` and `entry_players` are
   anon-readable for published tournaments, so anything sensitive goes in a
   separate table with its own RLS (see `entry_details`, migration 012) or a
   name-only view (`public_players`, `public_entry_names`).
4. **RLS is the security control; hiding UI is a usability choice.**

## Current state

Working end to end: auth, tournament creation, registration + waitlists,
configurable registration fields, draws (knockout / round robin / groups →
knockout), seeding, scheduling with conflict detection, check-in, badminton
live scoring with an offline queue, disputes, staff/RBAC, notifications
(in-app), rankings, series, finance, analytics, exports, branding, public
tournament pages, discovery, venue display, and tournament intelligence.

**Not connected, by design, pending credentials:** Razorpay, email, SMS,
WhatsApp, push. See the *External integrations still required* table in
`supabase-integration/README.md` for exactly what each one needs.

**MatchDay Pulse** (the differentiator — see `/pulse` in the app) is built on
three pure, tested engines: `rating.js` (MatchDay Rating, a verified Elo-style
skill rating replayed from officiated matches), `winProbability.js` (exact
Markov model of rally-point badminton) and `matchStory.js` (moments read from
the rally log). It surfaces on the match page, venue display, player profile,
leaderboard (Skill view) and seeding panel (Fair Draw). Its momentum features
need **migration 015**; ratings and win probability work without it.

**UPI Direct** (migration 016, `src/lib/upi.js`) lets players pay the organizer
from any UPI app; organizers confirm in the Finance tab. **Court queue**
(`src/lib/courtQueue.js`, `CourtEta`) shows players when their match will
really start, from live on-court pace — no migration needed.

**Migrations 010, 011, 012, 015 and 016 are written but not yet applied** to the live
project. Until 010 is applied, concurrent-scorer protection
(`score_point_atomic`), rate limiting and client-error logging are inactive.
Apply them in order via the Supabase SQL editor.

## Suggested order of work

Apply migrations 010 → 011 → 012, then final QA and a security audit, then
connect Razorpay and the notification providers.
