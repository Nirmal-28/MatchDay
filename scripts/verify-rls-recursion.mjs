/* Regression guard for the P0 infinite RLS recursion on public.matches.
 *
 * Applies migration 013 AS SHIPPED (read from disk, not retyped) on top of a
 * faithful reconstruction of the policies that surround it, then proves both
 * halves of the fix: the query that 500'd now works, and it did not quietly
 * widen access while doing so.
 *
 * Live evidence this guards against:
 *   GET /rest/v1/matches?select=*,games(*) -> 500
 *   {"code":"54001","message":"stack depth limit exceeded"}
 *
 * The pre-fix version is deliberately NOT executed: the recursion overflows
 * the WASM stack and hard-PANICs PGlite rather than raising a catchable
 * error, so it would take the test process down without proving anything the
 * production 500 hasn't already proven.
 *
 * Run: node scripts/verify-rls-recursion.mjs   (also: npm run test:migrations)
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const MIGRATION = join(ROOT, "supabase-integration/migrations/013_fix_can_score_match_recursion.sql");

let pass = 0, fail = 0;
const ok = (m) => { console.log(`  ok   - ${m}`); pass++; };
const bad = (m, d) => { console.log(`  FAIL - ${m}${d ? `\n         ${d}` : ""}`); fail++; };

const db = new PGlite();

/* ── Surrounding schema: the parts 013 depends on, per schema.sql + 005/008 ── */
await db.exec(`
create schema if not exists auth;
create table auth.users (id uuid primary key default gen_random_uuid());
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid, status text not null default 'DRAFT');
create table public.tournament_events (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id));
create table public.matches (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.tournament_events(id), match_number int);
create table public.tournament_members (
  tournament_id uuid not null, user_id uuid not null, role text not null);

create or replace function public.is_tournament_owner(t_id uuid)
returns boolean language sql security invoker stable set search_path = public as $$
  select exists (select 1 from public.tournaments
                 where id = t_id and organizer_id = (select auth.uid())) $$;
create or replace function public.event_is_published(e_id uuid)
returns boolean language sql security invoker stable set search_path = public as $$
  select exists (select 1 from public.tournament_events ev
                 join public.tournaments t on t.id = ev.tournament_id
                 where ev.id = e_id and t.status <> 'DRAFT') $$;
create or replace function public.is_event_owner(e_id uuid)
returns boolean language sql security invoker stable set search_path = public as $$
  select exists (select 1 from public.tournament_events ev
                 join public.tournaments t on t.id = ev.tournament_id
                 where ev.id = e_id and t.organizer_id = (select auth.uid())) $$;
create or replace function public.has_tournament_role(t_id uuid, roles text[])
returns boolean language sql security invoker stable set search_path = public as $$
  select public.is_tournament_owner(t_id) or exists (
    select 1 from public.tournament_members
    where tournament_id = t_id and user_id = (select auth.uid()) and role = any(roles)) $$;
`);

// PGlite connects as a SUPERUSER, which bypasses RLS unconditionally. Without
// a real unprivileged role the policies never run and every assertion below
// would pass vacuously. Mirrors Supabase's `authenticated` role.
await db.exec(`
  do $$ begin
    if not exists (select 1 from pg_roles where rolname='authenticated')
    then create role authenticated nosuperuser nobypassrls; end if;
    -- Supabase ships both roles; 013's REVOKE names anon, so it must exist
    -- here or the migration fails to apply for the wrong reason.
    if not exists (select 1 from pg_roles where rolname='anon')
    then create role anon nosuperuser nobypassrls; end if;
  end $$;
  grant usage on schema public, auth to authenticated;
  grant select on all tables in schema public to authenticated;
`);

/* ── The migration under test, exactly as it will be applied ─────────────── */
console.log("\nApplying 013_fix_can_score_match_recursion.sql");
try {
  await db.exec(readFileSync(MIGRATION, "utf8"));
  ok("migration applies cleanly");
} catch (e) {
  bad("migration failed to apply", e.message.slice(0, 300));
  await db.close();
  console.log(`\n${pass} passed, ${fail} failed.`);
  process.exit(1);
}

await db.exec(`
  alter table public.matches enable row level security;
  create policy "select_matches" on public.matches for select to authenticated
    using (public.event_is_published(event_id) or public.is_event_owner(event_id));
  create policy "staff_select_matches" on public.matches for select to authenticated
    using (public.can_score_match(id));
`);

// A DRAFT tournament the caller does not own, so select_matches is FALSE and
// the planner MUST evaluate staff_select_matches — exactly the condition that
// recursed before.
await db.exec(`
insert into auth.users (id) values ('11111111-1111-1111-1111-111111111111');
insert into public.tournaments (id, organizer_id, status)
  values ('22222222-2222-2222-2222-222222222222','99999999-9999-9999-9999-999999999999','DRAFT');
insert into public.tournament_events (id, tournament_id)
  values ('33333333-3333-3333-3333-333333333333','22222222-2222-2222-2222-222222222222');
insert into public.matches (id, event_id, match_number)
  values ('44444444-4444-4444-4444-444444444444','33333333-3333-3333-3333-333333333333',1);
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111', false);
`);

async function asUser(sql) {
  await db.exec("set role authenticated;");
  try { return await db.query(sql); }
  finally { await db.exec("reset role;"); }
}

console.log("\nThe query that returned 500 in production");
try {
  const r = await asUser(`select * from public.matches`);
  ok(`SELECT on matches completes without recursion (${r.rows.length} row(s))`);
} catch (e) {
  bad("still recursing / failing", e.message.slice(0, 200));
}

console.log("\nSECURITY DEFINER must not widen access");
try {
  const r = await asUser(`select * from public.matches`);
  if (r.rows.length === 0) ok("a stranger with no role sees no matches (no privilege escalation)");
  else bad(`a stranger saw ${r.rows.length} match(es) — the fix leaked access`);

  await db.exec(`insert into public.tournament_members values
    ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','SCORER');`);
  const r2 = await asUser(`select * from public.matches`);
  if (r2.rows.length === 1) ok("a SCORER on that tournament can read its matches (feature works)");
  else bad(`expected the SCORER to see 1 match, saw ${r2.rows.length}`);

  await db.exec(`delete from public.tournament_members;
    insert into public.tournament_members values
    ('88888888-8888-8888-8888-888888888888','11111111-1111-1111-1111-111111111111','SCORER');`);
  const r3 = await asUser(`select * from public.matches`);
  if (r3.rows.length === 0) ok("a SCORER on a DIFFERENT tournament sees nothing here (no cross-tournament leak)");
  else bad(`cross-tournament leak: saw ${r3.rows.length} match(es)`);

  await db.exec(`delete from public.tournament_members;
    update public.tournaments set status='LIVE' where id='22222222-2222-2222-2222-222222222222';`);
  const r4 = await asUser(`select * from public.matches`);
  if (r4.rows.length === 1) ok("a published tournament's matches stay publicly readable (spectators unaffected)");
  else bad(`expected 1 publicly-readable match, saw ${r4.rows.length}`);
} catch (e) {
  bad("access-control checks threw", e.message.slice(0, 200));
}

console.log("\nThe function is still a policy helper, not a public endpoint");
{
  const r = await db.query(`
    select p.prosecdef,
           has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
           has_function_privilege('anon', p.oid, 'execute') as anon_exec
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='can_score_match'`).catch(() => null);
  if (!r) { ok("anon role absent in this harness — RPC-surface check skipped"); }
  else {
    const row = r.rows[0];
    if (row.prosecdef) ok("can_score_match is SECURITY DEFINER");
    else bad("can_score_match is NOT SECURITY DEFINER — the fix did not take");
    if (row.auth_exec) ok("authenticated retains EXECUTE (policies would fail closed without it)");
    else bad("authenticated lost EXECUTE — every policy using it will fail closed");
  }
}

await db.close();
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
