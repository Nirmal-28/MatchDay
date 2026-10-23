/* Verifies migration 015 (the rally log behind MatchDay Pulse) against a real
 * Postgres (PGlite/WASM), applying the file AS SHIPPED.
 *
 * What must hold:
 *   - it applies cleanly on top of the helpers it depends on (013's
 *     can_score_match, schema.sql's match_is_published / is_match_owner);
 *   - a SCORER on the tournament can append rallies; a stranger cannot;
 *   - nobody can rewrite history (no UPDATE / DELETE path);
 *   - spectators can read a PUBLISHED match's log, but not a draft's;
 *   - nobody can log a rally in someone else's name.
 *
 * Run: node scripts/verify-migration-015.mjs   (also: npm run test:migrations)
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const read = (f) => readFileSync(join(ROOT, "supabase-integration/migrations", f), "utf8");

let pass = 0, fail = 0;
const ok = (m) => { console.log(`  ok   - ${m}`); pass++; };
const bad = (m, d) => { console.log(`  FAIL - ${m}${d ? `\n         ${d}` : ""}`); fail++; };

const db = new PGlite();

const OWNER = "99999999-9999-9999-9999-999999999999";
const SCORER = "11111111-1111-1111-1111-111111111111";
const STRANGER = "55555555-5555-5555-5555-555555555555";
const T = "22222222-2222-2222-2222-222222222222";
const EV = "33333333-3333-3333-3333-333333333333";
const M = "44444444-4444-4444-4444-444444444444";

await db.exec(`
create schema if not exists auth;
create table auth.users (id uuid primary key default gen_random_uuid());
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create table public.tournaments (id uuid primary key, organizer_id uuid, status text not null default 'DRAFT');
create table public.tournament_events (id uuid primary key, tournament_id uuid not null references public.tournaments(id));
create table public.matches (id uuid primary key, event_id uuid not null references public.tournament_events(id));
create table public.tournament_members (tournament_id uuid not null, user_id uuid not null, role text not null);

create or replace function public.is_tournament_owner(t_id uuid)
returns boolean language sql security invoker stable set search_path = public as $$
  select exists (select 1 from public.tournaments where id = t_id and organizer_id = (select auth.uid())) $$;
create or replace function public.has_tournament_role(t_id uuid, roles text[])
returns boolean language sql security invoker stable set search_path = public as $$
  select public.is_tournament_owner(t_id) or exists (
    select 1 from public.tournament_members
    where tournament_id = t_id and user_id = (select auth.uid()) and role = any(roles)) $$;
-- schema.sql helpers, verbatim in substance.
create or replace function public.is_match_owner(m_id uuid)
returns boolean language sql security invoker set search_path = public stable as $$
  select exists (select 1 from public.matches m
    join public.tournament_events ev on ev.id = m.event_id
    join public.tournaments t on t.id = ev.tournament_id
    where m.id = m_id and t.organizer_id = (select auth.uid())) $$;
create or replace function public.match_is_published(m_id uuid)
returns boolean language sql security invoker set search_path = public stable as $$
  select exists (select 1 from public.matches m
    join public.tournament_events ev on ev.id = m.event_id
    join public.tournaments t on t.id = ev.tournament_id
    where m.id = m_id and t.status <> 'DRAFT') $$;

do $$ begin
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nosuperuser nobypassrls; end if;
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nosuperuser nobypassrls; end if;
end $$;
create publication supabase_realtime;
`);

console.log("\nApplying 013 (dependency) and 015_match_pulse.sql");
try {
  await db.exec(read("013_fix_can_score_match_recursion.sql"));
  await db.exec(read("015_match_pulse.sql"));
  // Applying twice must be harmless — operators re-run migrations.
  await db.exec(read("015_match_pulse.sql"));
  ok("migration applies cleanly, and is idempotent");
} catch (e) {
  bad("migration failed to apply", e.message.slice(0, 300));
  await db.close();
  console.log(`\n${pass} passed, ${fail} failed.`);
  process.exit(1);
}

await db.exec(`
grant usage on schema public, auth to authenticated, anon;
grant select on all tables in schema public to authenticated, anon;
grant insert, update, delete on public.match_points to authenticated;
insert into auth.users (id) values ('${OWNER}'), ('${SCORER}'), ('${STRANGER}');
insert into public.tournaments values ('${T}', '${OWNER}', 'DRAFT');
insert into public.tournament_events values ('${EV}', '${T}');
insert into public.matches values ('${M}', '${EV}');
insert into public.tournament_members values ('${T}', '${SCORER}', 'SCORER');
`);

async function as(role, user, sql) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${user || ""}', false); set role ${role};`);
  try { return await db.query(sql); }
  finally { await db.exec("reset role;"); }
}
const rally = (by = "") => `insert into public.match_points (match_id, game_number, side, delta, score_a, score_b${by ? ", created_by" : ""})
  values ('${M}', 1, 'A', 1, 1, 0${by ? `, '${by}'` : ""})`;

console.log("\nWho can write");
try { await as("authenticated", SCORER, rally()); ok("a SCORER on the tournament can append a rally"); }
catch (e) { bad("the SCORER was refused", e.message.slice(0, 200)); }

try { await as("authenticated", STRANGER, rally()); bad("a stranger appended a rally to someone else's match"); }
catch { ok("a stranger cannot append a rally"); }

try { await as("authenticated", SCORER, rally(OWNER)); bad("a scorer logged a rally in the organizer's name"); }
catch { ok("nobody can log a rally in someone else's name"); }

try { await as("anon", null, rally()); bad("an anonymous visitor appended a rally"); }
catch { ok("an anonymous visitor cannot append a rally"); }

console.log("\nThe log is append-only");
{
  const u = await as("authenticated", SCORER, `update public.match_points set score_a = 30 returning id`).catch(() => ({ rows: [] }));
  if (u.rows.length === 0) ok("UPDATE changes nothing (no update policy)");
  else bad(`UPDATE rewrote ${u.rows.length} row(s)`);
  const d = await as("authenticated", SCORER, `delete from public.match_points returning id`).catch(() => ({ rows: [] }));
  if (d.rows.length === 0) ok("DELETE removes nothing (no delete policy)");
  else bad(`DELETE removed ${d.rows.length} row(s)`);
}

console.log("\nWho can read");
{
  const draft = await as("anon", null, `select * from public.match_points`);
  if (draft.rows.length === 0) ok("a spectator cannot read a DRAFT tournament's rallies");
  else bad(`a spectator read ${draft.rows.length} draft row(s)`);

  const staff = await as("authenticated", SCORER, `select * from public.match_points`);
  if (staff.rows.length === 1) ok("the SCORER can read the draft log");
  else bad(`expected the scorer to read 1 row, got ${staff.rows.length}`);

  await db.exec(`update public.tournaments set status = 'LIVE' where id = '${T}'`);
  const pub = await as("anon", null, `select * from public.match_points`);
  if (pub.rows.length === 1) ok("a spectator can read a PUBLISHED match's rallies");
  else bad(`expected 1 public row, got ${pub.rows.length}`);
}

console.log("\nShape checks");
try { await db.exec(`insert into public.match_points (match_id, game_number, side, delta, score_a, score_b) values ('${M}', 1, 'C', 1, 0, 0)`); bad("accepted side 'C'"); }
catch { ok("rejects a side other than A/B"); }
try { await db.exec(`insert into public.match_points (match_id, game_number, side, delta, score_a, score_b) values ('${M}', 1, 'A', 2, 0, 0)`); bad("accepted delta 2"); }
catch { ok("rejects a delta other than ±1"); }
{
  const r = await db.query(`select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='match_points'`);
  if (r.rows.length === 1) ok("match_points is in the realtime publication");
  else bad("match_points is missing from the realtime publication");
}

await db.close();
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
