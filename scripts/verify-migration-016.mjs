/* Verifies migration 016 (UPI Direct) against a real Postgres (PGlite/WASM),
 * applying the file AS SHIPPED.
 *
 * What must hold:
 *   - a player (even anonymous) can submit a UTR, which moves the entry to
 *     PENDING and never to PAID;
 *   - bad input is refused: malformed UTR, a tournament without a UPI ID, a
 *     settled entry, a free entry, an inactive entry;
 *   - re-submitting replaces the open claim instead of stacking duplicates;
 *   - claims are readable only by the entry's organizer — never anon, never a
 *     stranger — and cannot be inserted directly, bypassing the checks;
 *   - an invalid UPI ID cannot be saved on a tournament.
 *
 * Run: node scripts/verify-migration-016.mjs   (also: npm run test:migrations)
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const MIGRATION = join(ROOT, "supabase-integration/migrations/016_upi_direct.sql");

let pass = 0, fail = 0;
const ok = (m) => { console.log(`  ok   - ${m}`); pass++; };
const bad = (m, d) => { console.log(`  FAIL - ${m}${d ? `\n         ${d}` : ""}`); fail++; };

const OWNER = "99999999-9999-9999-9999-999999999999";
const STRANGER = "55555555-5555-5555-5555-555555555555";
const T = "22222222-2222-2222-2222-222222222222";
const EV = "33333333-3333-3333-3333-333333333333";
const E1 = "7f3a2b11-1111-1111-1111-111111111111";
const E_PAID = "44444444-4444-4444-4444-444444444444";
const E_FREE = "66666666-6666-6666-6666-666666666666";

const db = new PGlite();
await db.exec(`
create schema if not exists auth;
create table auth.users (id uuid primary key default gen_random_uuid());
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table public.tournaments (id uuid primary key, organizer_id uuid, status text not null default 'DRAFT');
create table public.tournament_events (id uuid primary key, tournament_id uuid not null references public.tournaments(id));
create table public.entries (
  id uuid primary key, event_id uuid not null references public.tournament_events(id),
  reg_status text not null default 'PENDING', payment_status text not null default 'UNPAID',
  fee_inr numeric(10,2) not null default 0);
create or replace function public.is_entry_owner(en_id uuid)
returns boolean language sql security invoker set search_path = public stable as $$
  select exists (select 1 from public.entries e
    join public.tournament_events ev on ev.id = e.event_id
    join public.tournaments t on t.id = ev.tournament_id
    where e.id = en_id and t.organizer_id = (select auth.uid())) $$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nosuperuser nobypassrls; end if;
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nosuperuser nobypassrls; end if;
end $$;
`);

console.log("\nApplying 016_upi_direct.sql");
try {
  await db.exec(readFileSync(MIGRATION, "utf8"));
  await db.exec(readFileSync(MIGRATION, "utf8"));
  ok("migration applies cleanly, and is idempotent");
} catch (e) {
  bad("migration failed to apply", e.message.slice(0, 300));
  await db.close(); console.log(`\n${pass} passed, ${fail} failed.`); process.exit(1);
}

await db.exec(`
grant usage on schema public, auth to authenticated, anon;
grant select on all tables in schema public to authenticated, anon;
grant insert, update on public.payment_claims to authenticated, anon;
insert into auth.users (id) values ('${OWNER}'), ('${STRANGER}');
insert into public.tournaments (id, organizer_id, status) values ('${T}', '${OWNER}', 'REGISTRATION_OPEN');
insert into public.tournament_events values ('${EV}', '${T}');
insert into public.entries (id, event_id, fee_inr) values ('${E1}', '${EV}', 500), ('${E_FREE}', '${EV}', 0);
insert into public.entries (id, event_id, fee_inr, payment_status) values ('${E_PAID}', '${EV}', 500, 'PAID');
`);

async function as(role, user, sql) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${user || ""}', false); set role ${role};`);
  try { return await db.query(sql); }
  finally { await db.exec("reset role;"); }
}
const claim = (entry, utr) => `select public.claim_upi_payment('${entry}', '${utr}') as r`;
const refused = async (label, role, user, sql, pattern) => {
  try { await as(role, user, sql); bad(`${label} — was accepted`); }
  catch (e) { (pattern && !pattern.test(e.message)) ? bad(label, e.message) : ok(label); }
};

console.log("\nGuard rails before a UPI ID is set");
await refused("no UPI ID on the tournament -> refused", "anon", null, claim(E1, "412345678901"), /does not take UPI/);

await db.exec(`update public.tournaments set upi_id = 'smash.club@okhdfcbank', upi_payee_name = 'Smash Club' where id = '${T}'`);

console.log("\nA player submits a UTR");
try {
  const r = await as("anon", null, claim(E1, "4123 4567 8901"));
  const ref = r.rows[0].r.reference;
  if (ref === "MD7F3A2B") ok(`anonymous registrant can claim; reference ${ref} matches the client's`);
  else bad(`unexpected reference ${ref}`);
} catch (e) { bad("anonymous claim was refused", e.message); }
{
  const r = await db.query(`select payment_status from public.entries where id = '${E1}'`);
  if (r.rows[0].payment_status === "PENDING") ok("entry moves to PENDING — never PAID");
  else bad(`entry is ${r.rows[0].payment_status}`);
}
try {
  await as("anon", null, claim(E1, "999999999999"));
  const r = await db.query(`select utr from public.payment_claims where entry_id = '${E1}' and status = 'CLAIMED'`);
  if (r.rows.length === 1 && r.rows[0].utr === "999999999999") ok("re-submitting replaces the open claim (no duplicates)");
  else bad(`expected one open claim with the new UTR, got ${JSON.stringify(r.rows)}`);
} catch (e) { bad("re-submission failed", e.message); }

console.log("\nBad input is refused");
await refused("a UTR that is not 12 digits", "anon", null, claim(E1, "12345"), /12 digits/);
await refused("an already-paid entry", "anon", null, claim(E_PAID, "412345678901"), /already settled/);
await refused("a free entry", "anon", null, claim(E_FREE, "412345678901"), /no fee/);
await db.exec(`update public.entries set reg_status = 'CANCELLED' where id = '${E_FREE}'`);
await refused("a cancelled entry", "anon", null, claim(E_FREE, "412345678901"), /no longer active/);

console.log("\nWho can see claims");
{
  const a = await as("anon", null, `select * from public.payment_claims`);
  a.rows.length === 0 ? ok("anonymous visitors see no claims") : bad(`anon saw ${a.rows.length}`);
  const s = await as("authenticated", STRANGER, `select * from public.payment_claims`);
  s.rows.length === 0 ? ok("a stranger sees no claims") : bad(`stranger saw ${s.rows.length}`);
  const o = await as("authenticated", OWNER, `select * from public.payment_claims`);
  o.rows.length === 1 ? ok("the organizer sees their entry's claim") : bad(`owner saw ${o.rows.length}`);
}
await refused("nobody can insert a claim directly, skipping the checks", "anon", null,
  `insert into public.payment_claims (entry_id, utr, amount_inr, reference) values ('${E1}', '111111111111', 1, 'X')`);
{
  const u = await as("authenticated", STRANGER, `update public.payment_claims set status = 'VERIFIED' returning id`).catch(() => ({ rows: [] }));
  u.rows.length === 0 ? ok("a stranger cannot verify a claim") : bad("a stranger verified a claim");
  const o = await as("authenticated", OWNER, `update public.payment_claims set status = 'VERIFIED' returning id`);
  o.rows.length === 1 ? ok("the organizer can verify the claim") : bad("organizer could not verify");
}

console.log("\nTournament UPI ID is validated");
try { await db.exec(`update public.tournaments set upi_id = 'not a upi id' where id = '${T}'`); bad("an invalid UPI ID was saved"); }
catch { ok("an invalid UPI ID cannot be saved"); }

await db.close();
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
