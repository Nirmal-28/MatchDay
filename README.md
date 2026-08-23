# Matchday

Tournament management for racket sports. One account plays, organizes and
officiates — those are capabilities attached to tournaments, never separate
account types.

Vite + React 19 + Supabase (Postgres, RLS, Realtime, Storage).
Live project: `dkkpolnuywgvmlacjzto` (ap-south-1).

## Running it

```bash
npm install
cp supabase-integration/.env.example .env   # fill in the two VITE_SUPABASE_ values
npm run dev
```

## Checks

```bash
npm run lint          # oxlint
npm test              # vitest — validation, monitoring, offline queue
npm run test:scheduling   # scheduling engine (standalone Node script)
npm run test:series       # series standings (standalone Node script)
npm run test:all          # all of the above
npm run build
```

CI (`.github/workflows/ci.yml`) runs all of these on every push and pull
request, so a lint error or a failing test is caught before Vercel deploys.

## How it fits together

| Layer | Where | Notes |
|---|---|---|
| Data access | `src/lib/repository.js` | Every Supabase call. Components never touch the client directly. |
| Rules engines | `src/lib/engines.js`, `schedulingEngine.js`, `ranking.js`, `seriesStandings.js`, `lifecycle.js` | Pure functions, no Supabase or browser dependency — which is why they can be unit tested directly. |
| Validation | `src/lib/validation.js` | One definition per rule, shared by the form and the database CHECK constraints in migration 010. |
| Provider boundaries | `src/lib/payments/`, `src/lib/notifications/` | An unconnected provider *refuses* rather than silently succeeding. |
| Observability | `src/lib/monitoring.js`, `productAnalytics.js` | Writes to your own Supabase tables. No third-party script in the bundle. |
| Courtside resilience | `src/lib/offlineQueue.js`, `useOnline.js`, `components/ConnectionBanner.jsx` | Scoring survives venue wifi dropping; the banner says what has not been saved. |

Database schema, migrations and the honest list of what is and is not
connected live in [`supabase-integration/README.md`](supabase-integration/README.md).
Read that before deploying anything.

## Things that are deliberately not what they look like

- **Payments are simulated.** `MockPaymentProvider` writes `PAID` from the
  browser. It exists so the UI can be clicked through. `RazorpayProvider` and
  the two Edge Functions are complete but have no account behind them — see
  the integrations table in the Supabase README.
- **Notifications are in-app only** until the `notify-dispatch` Edge Function
  is deployed with provider secrets. Every other channel reports itself as not
  connected instead of pretending.
- **Migrations 010 and 011 are written but not applied.** Everything else in
  `supabase-integration/migrations/` is live.
- **`src/lib/analytics.js` is tournament statistics**, not product analytics.
  Product analytics is `src/lib/productAnalytics.js`. The names are close
  together and mean different things.
