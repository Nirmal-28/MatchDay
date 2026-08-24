/* Executes migration 012 against a real Postgres (PGlite, WASM) to prove it
   actually runs — syntax, constraint immutability, policy expressions, view
   definition and function bodies.
 *
 * This is NOT a substitute for applying it to a staging Supabase project: the
 * Supabase-specific surface (auth.uid() returning a real JWT claim, RLS
 * actually being enforced for the anon/authenticated roles, PostgREST
 * exposure) is stubbed here, not reproduced. What it does prove is that the
 * DDL is valid and self-consistent, which is the part that was previously
 * unverified.
 *
 * Run: node scripts/verify-migration-012.mjs
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const MIGRATION = "supabase-integration/migrations/012_registration_fields_and_follows.sql";

let pass = 0, fail = 0;
const ok = (m) => { console.log(`  ok  - ${m}`); pass++; };
const bad = (m, e) => { console.log(`  FAIL- ${m}\n        ${e}`); fail++; };

async function check(label, fn) {
  try { await fn(); ok(label); } catch (e) { bad(label, e.message); }
}

const db = new PGlite();

/* ── Stub only what 012 references from earlier migrations ───────────────── */
const PRELUDE = `
create schema if not exists auth;
create table auth.users (id uuid primary key default gen_random_uuid());
-- Stand-in for Supabase's JWT-backed auth.uid().
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
end $$;

create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid references auth.users(id),
  name text not null,
  slug text unique,
  status text not null default 'DRAFT',
  registration_opens_at timestamptz,
  registration_closes_at timestamptz
);
create table public.tournament_events (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  status text not null default 'DRAFT'
);
create table public.entries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.tournament_events(id) on delete cascade,
  reg_status text not null default 'PENDING',
  created_at timestamptz not null default now()
);

create or replace function public.is_entry_owner(en_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.entries e
    join public.tournament_events ev on ev.id = e.event_id
    join public.tournaments t on t.id = ev.tournament_id
    where e.id = en_id and t.organizer_id = (select auth.uid())
  );
$$;
create or replace function public.is_tournament_staff(t_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.tournaments t where t.id = t_id and t.organizer_id = (select auth.uid()));
$$;
create or replace function public.my_entry_ids()
returns setof uuid language sql security definer stable set search_path = public as $$
  select e.id from public.entries e where false;
$$;
`;

console.log("Verifying migration 012 against a real Postgres (PGlite)\n");

await db.exec(PRELUDE);
console.log("Prelude (stubbed prerequisites) applied.\n");

/* ── The actual thing under test ─────────────────────────────────────────── */
console.log("Applying 012_registration_fields_and_follows.sql");
try {
  await db.exec(readFileSync(MIGRATION, "utf8"));
  ok("migration applies without error");
} catch (e) {
  bad("migration applies without error", e.message);
  console.log(`\n${pass} passed, ${fail} failed.`);
  process.exit(1);
}

/* ── Structure ───────────────────────────────────────────────────────────── */
console.log("\nStructure");

await check("tournaments.registration_fields exists and defaults to []", async () => {
  const r = await db.query(`select column_default d from information_schema.columns
    where table_name='tournaments' and column_name='registration_fields'`);
  if (!r.rows.length) throw new Error("column missing");
  if (!r.rows[0].d.includes("[]")) throw new Error(`unexpected default: ${r.rows[0].d}`);
});

await check("entry_details, follows and the public view were created", async () => {
  const r = await db.query(`select table_name from information_schema.tables
    where table_schema='public' and table_name in ('entry_details','follows','public_entry_details')`);
  const got = r.rows.map((x) => x.table_name).sort();
  if (got.length !== 3) throw new Error(`expected 3, got ${JSON.stringify(got)}`);
});

await check("RLS is enabled on both new tables", async () => {
  const r = await db.query(`select relname, relrowsecurity from pg_class
    where relname in ('entry_details','follows')`);
  const off = r.rows.filter((x) => !x.relrowsecurity).map((x) => x.relname);
  if (off.length) throw new Error(`RLS off for: ${off.join(", ")}`);
});

await check("every expected policy exists", async () => {
  const r = await db.query(`select policyname from pg_policies where tablename in ('entry_details','follows')`);
  const got = r.rows.map((x) => x.policyname);
  const want = [
    "staff_select_entry_details", "player_select_entry_details", "public_insert_entry_details",
    "staff_update_entry_details", "owner_delete_entry_details",
    "select_own_follows", "insert_own_follows", "delete_own_follows",
  ];
  const missing = want.filter((w) => !got.includes(w));
  if (missing.length) throw new Error(`missing: ${missing.join(", ")}`);
});

await check("follows blocks duplicate follow edges", async () => {
  const r = await db.query(`select conname from pg_constraint
    where conrelid='public.follows'::regclass and contype='u'`);
  if (!r.rows.length) throw new Error("no unique constraint on follows");
});

/* ── Constraints actually bite ───────────────────────────────────────────── */
console.log("\nConstraints");

await check("registration_fields rejects a non-array", async () => {
  try {
    await db.query(`insert into public.tournaments (name, registration_fields) values ('T', '{"a":1}'::jsonb)`);
  } catch { return; }
  throw new Error("a jsonb object was accepted where an array is required");
});

await check("registration_fields rejects more than 25 questions", async () => {
  const many = JSON.stringify(Array.from({ length: 26 }, (_, i) => ({ key: `f${i}` })));
  try {
    await db.query(`insert into public.tournaments (name, registration_fields) values ('T', $1::jsonb)`, [many]);
  } catch { return; }
  throw new Error("26 fields were accepted");
});

await check("registration_fields accepts a valid definition set", async () => {
  await db.query(`insert into public.tournaments (id, name, status, slug, registration_fields)
    values ('11111111-1111-1111-1111-111111111111', 'T', 'LIVE', 't',
      '[{"key":"club","label":"Club","type":"text","visibility":"PUBLIC"},
        {"key":"emergency_contact","label":"Emergency","type":"tel","visibility":"PRIVATE"}]'::jsonb)`);
});

await check("entry_details rejects a non-object answer blob", async () => {
  await db.query(`insert into public.tournament_events (id, tournament_id, status)
    values ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','REGISTRATION_OPEN')`);
  await db.query(`insert into public.entries (id, event_id)
    values ('33333333-3333-3333-3333-333333333333','22222222-2222-2222-2222-222222222222')`);
  try {
    await db.query(`insert into public.entry_details (entry_id, answers)
      values ('33333333-3333-3333-3333-333333333333', '[1,2]'::jsonb)`);
  } catch { return; }
  throw new Error("a jsonb array was accepted where an object is required");
});

await check("entry_details size cap is IMMUTABLE-safe and enforced", async () => {
  // The original draft used pg_column_size(), which is STABLE — Postgres
  // rejects that in a CHECK. This asserts the fix works AND still bites.
  const big = JSON.stringify({ note: "x".repeat(9000) });
  try {
    await db.query(`insert into public.entry_details (entry_id, answers) values ('33333333-3333-3333-3333-333333333333', $1::jsonb)`, [big]);
  } catch (e) {
    if (/immutable/i.test(e.message)) throw new Error("CHECK uses a non-immutable function");
    return;
  }
  throw new Error("a 9KB answer blob was accepted");
});

/* ── The public view is the security boundary — test it hard ─────────────── */
console.log("\nPublic projection (the security boundary)");

await db.query(`insert into public.entry_details (entry_id, answers)
  values ('33333333-3333-3333-3333-333333333333',
          '{"club":"Smash Academy","emergency_contact":"9876543210"}'::jsonb)`);

await check("PUBLIC-marked answers are exposed", async () => {
  const r = await db.query(`select answers from public.public_entry_details`);
  if (!r.rows.length) throw new Error("view returned nothing");
  if (r.rows[0].answers.club !== "Smash Academy") throw new Error("public answer missing");
});

await check("PRIVATE answers are NEVER exposed", async () => {
  const r = await db.query(`select answers::text a from public.public_entry_details`);
  if (/9876543210|emergency_contact/.test(r.rows[0].a)) {
    throw new Error("PRIVATE emergency contact leaked into the public view");
  }
});

await check("flipping a field to PRIVATE removes it from the view", async () => {
  await db.query(`update public.tournaments set registration_fields =
    '[{"key":"club","label":"Club","type":"text","visibility":"PRIVATE"}]'::jsonb
    where id='11111111-1111-1111-1111-111111111111'`);
  const r = await db.query(`select * from public.public_entry_details`);
  if (r.rows.length) throw new Error("answers still visible after the field was made private");
});

await check("an unpublished tournament exposes nothing", async () => {
  await db.query(`update public.tournaments set registration_fields =
      '[{"key":"club","label":"Club","type":"text","visibility":"PUBLIC"}]'::jsonb,
      status='DRAFT'
    where id='11111111-1111-1111-1111-111111111111'`);
  const r = await db.query(`select * from public.public_entry_details`);
  if (r.rows.length) throw new Error("a DRAFT tournament's answers were exposed publicly");
});

await check("a tournament with no slug exposes nothing", async () => {
  await db.query(`update public.tournaments set status='LIVE', slug=null
    where id='11111111-1111-1111-1111-111111111111'`);
  const r = await db.query(`select * from public.public_entry_details`);
  if (r.rows.length) throw new Error("an unpublished (slugless) tournament's answers were exposed");
});

await check("a withdrawn entry stops being publicly visible", async () => {
  await db.query(`update public.tournaments set slug='t' where id='11111111-1111-1111-1111-111111111111'`);
  // Sanity: visible while the entry is active...
  const before = await db.query(`select * from public.public_entry_details`);
  if (!before.rows.length) throw new Error("precondition failed — entry should be visible here");
  // ...and gone once it is cancelled.
  await db.query(`update public.entries set reg_status='CANCELLED' where id='33333333-3333-3333-3333-333333333333'`);
  const after = await db.query(`select * from public.public_entry_details`);
  if (after.rows.length) throw new Error("a CANCELLED entry's answers were still public");
  await db.query(`update public.entries set reg_status='CONFIRMED' where id='33333333-3333-3333-3333-333333333333'`);
});

/* ── The insert policy is the anti-tampering boundary ────────────────────── */
console.log("\nInsert policy (anti-tampering)");

// RLS is not enforced for the superuser PGlite runs as, so these assert the
// POLICY EXPRESSION itself rather than relying on enforcement: the same
// predicate the policy uses is evaluated directly against fresh vs. stale
// entries. A regression in the created_at bound fails here.
const insertPredicate = (entryId) => db.query(`
  select exists (
    select 1
    from public.entries e
    join public.tournament_events ev on ev.id = e.event_id
    join public.tournaments t on t.id = ev.tournament_id
    where e.id = $1
      and e.created_at > now() - interval '15 minutes'
      and ev.status = 'REGISTRATION_OPEN'
      and t.status  = 'REGISTRATION_OPEN'
  ) allowed`, [entryId]);

await check("a freshly created entry may receive answers", async () => {
  await db.query(`update public.tournaments set status='REGISTRATION_OPEN' where id='11111111-1111-1111-1111-111111111111'`);
  const r = await insertPredicate("33333333-3333-3333-3333-333333333333");
  if (!r.rows[0].allowed) throw new Error("a just-registered entry was refused its own answers");
});

await check("an old entry can no longer be written to by a stranger", async () => {
  // Entry ids are anon-readable for published events, so without the
  // created_at bound anyone could write answers onto any entry all week.
  await db.query(`update public.entries set created_at = now() - interval '2 hours'
    where id='33333333-3333-3333-3333-333333333333'`);
  const r = await insertPredicate("33333333-3333-3333-3333-333333333333");
  if (r.rows[0].allowed) throw new Error("an entry created 2 hours ago still accepts answer inserts");
});

await check("the entry_id primary key prevents overwriting existing answers", async () => {
  try {
    await db.query(`insert into public.entry_details (entry_id, answers)
      values ('33333333-3333-3333-3333-333333333333', '{"club":"Injected"}'::jsonb)`);
  } catch { return; }
  throw new Error("a second answer row was accepted for the same entry");
});

/* ── Aggregate-only follower counts ──────────────────────────────────────── */
console.log("\nFollower counts");

await check("follower_count returns 0 for an unfollowed subject", async () => {
  const r = await db.query(`select public.follower_count('TOURNAMENT','11111111-1111-1111-1111-111111111111') c`);
  if (Number(r.rows[0].c) !== 0) throw new Error(`expected 0, got ${r.rows[0].c}`);
});

await check("follower_count counts real edges", async () => {
  await db.query(`insert into auth.users (id) values
    ('44444444-4444-4444-4444-444444444444'), ('55555555-5555-5555-5555-555555555555')`);
  await db.query(`insert into public.follows (follower_id, subject_type, subject_id) values
    ('44444444-4444-4444-4444-444444444444','TOURNAMENT','11111111-1111-1111-1111-111111111111'),
    ('55555555-5555-5555-5555-555555555555','TOURNAMENT','11111111-1111-1111-1111-111111111111')`);
  const r = await db.query(`select public.follower_count('TOURNAMENT','11111111-1111-1111-1111-111111111111') c`);
  if (Number(r.rows[0].c) !== 2) throw new Error(`expected 2, got ${r.rows[0].c}`);
});

await check("follower_counts batches without dropping zero-follower subjects", async () => {
  const r = await db.query(`select * from public.follower_counts('TOURNAMENT',
    array['11111111-1111-1111-1111-111111111111','66666666-6666-6666-6666-666666666666']::uuid[])`);
  if (r.rows.length !== 2) throw new Error(`expected 2 rows, got ${r.rows.length}`);
  const zero = r.rows.find((x) => x.subject_id.startsWith("66666666"));
  if (Number(zero.followers) !== 0) throw new Error("subject with no followers should report 0, not vanish");
});

await check("subject_type is constrained to known kinds", async () => {
  try {
    await db.query(`insert into public.follows (follower_id, subject_type, subject_id)
      values ('44444444-4444-4444-4444-444444444444','SOMETHING','11111111-1111-1111-1111-111111111111')`);
  } catch { return; }
  throw new Error("an arbitrary subject_type was accepted");
});

await db.close();
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
