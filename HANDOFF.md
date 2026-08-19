# Courtside — handoff to Claude Code

Read this file first. It's the full context for continuing this project
in a real dev environment.

## What this project is

**Courtside** — a badminton tournament operations platform (create
tournament → register players → generate draw → schedule matches → live
score → results), built for an Indian organizer market. Full brief and
product spec was worked through in a prior chat session; this file
summarizes where things stand.

## What already exists in this folder

- `courtside_reference_artifact.jsx` — a **working, single-file reference
  implementation** of the entire UI and business logic (badminton scoring
  engine, single-elimination draw generator with bye handling, round-based
  scheduling engine, organizer dashboard, public tournament pages, live
  scoring, etc). It currently runs standalone in a sandboxed preview using
  an in-memory `useReducer` + a non-standard `window.storage` API for
  persistence — **neither of those exist in a real browser/Vite app**, so
  this file is a *reference for logic and UI*, not something to import
  as-is. Read it to understand the intended architecture and copy/adapt
  the JSX/components and the pure functions (scoring engine, draw
  generator, scheduling engine) — those are portable as-is.

- `supabase-integration/` — the **real, working backend integration**:
  - `schema.sql` — full schema already applied to the live Supabase
    project (see below). Documentation copy, not something to re-run.
  - `supabaseClient.js` + `repository.js` — real `@supabase/supabase-js`
    calls (createTournament, generateDraw, scorePoint, startTournament,
    realtime subscriptions, etc.) that replace the reference artifact's
    reducer actions one-to-one. These are meant to be dropped into a real
    project directly.
  - `.env.example` — pre-filled with the real project's URL and
    publishable (anon) key.
  - `README.md` — setup steps and an honest list of known gaps (payments
    are still a client-side stub, scoring has a small concurrency edge
    case, schedule writes are row-by-row not bulk).

## Live infrastructure already set up (nothing to redo)

- Supabase project: **"Tournament app 1"**, ref `dkkpolnuywgvmlacjzto`,
  region `ap-south-1` (Mumbai). Reachable via the Supabase MCP connector if
  available in this environment, or via the URL/key in `.env.example`.
- 9 tables, all with Row Level Security enabled and policies written
  (organizer-owns-their-tournament model, public read for published
  tournaments only, player PII never exposed publicly).
- Realtime enabled on the tables that need live updates.
- Security + performance advisors run and cleared (one documented
  exception, see `schema.sql` comments on `public_entry_names`).

## What's NOT done yet (the actual next steps)

1. **Scaffold a real Vite + React project** and wire the reference
   artifact's UI to `repository.js` instead of the in-memory reducer.
   This is mostly mechanical (split one big file into components, swap
   `dispatch({type:...})` calls for `await someRepositoryFunction(...)`)
   but real work — loading states, error handling, and realtime
   subscriptions need to be added since network calls aren't instant like
   the in-memory version.
2. **Organizer auth UI** — `signUp`/`signIn`/`signOut` functions already
   exist in `repository.js`; there's no login form yet.
3. **Razorpay payments** — not started. Needs a Supabase Edge Function
   (server-side) to create orders and verify webhooks with the
   `service_role` key; the client must never set `payment_status` directly
   in production (a `devSimulatePayment()` stub exists for now).
4. **Deployment** — no hosting/domain set up yet. Vercel is a natural fit
   for the Vite frontend.
5. **Legal basics** (Terms, Privacy Policy, refund policy) — not started,
   flagged as needed before taking real registrations/money.

## Suggested order of work

Scaffold the Vite project → wire up auth → replace the reference
artifact's persistence with `repository.js` end-to-end (test the full
create → register → draw → schedule → score → results flow against the
real database) → then payments → then deployment.
