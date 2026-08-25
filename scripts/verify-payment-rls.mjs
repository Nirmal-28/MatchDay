/* Regression guard: a player must never be able to mark their own entry PAID.
 *
 * This is the single most valuable RLS property in the product. If a signed-in
 * player can write `entries.payment_status = 'PAID'`, the entry fee becomes
 * optional and the Razorpay webhook is decorative — anyone can grant
 * themselves a free entry from the browser console.
 *
 * The policies below are a faithful reconstruction of what is actually on the
 * live database (read out of pg_policy on 2026-08-25):
 *
 *   UPDATE  owner_update_entries   using/check: is_event_owner(event_id)
 *   UPDATE  staff_update_checkin   using/check: has_tournament_role(..., staff)
 *
 * Note what is NOT there: any policy granting a player UPDATE on their own
 * entry. That absence is the whole control, and absences are exactly what
 * regress silently when someone later adds "let players cancel their own
 * entry" without thinking about which columns that opens up.
 *
 * Run: node scripts/verify-payment-rls.mjs   (also: npm run test:migrations)
 */
import { PGlite } from "@electric-sql/pglite";

let pass = 0, fail = 0;
const ok = (m) => { console.log(`  ok   - ${m}`); pass++; };
const bad = (m, d) => { console.log(`  FAIL - ${m}${d ? `\n         ${d}` : ""}`); fail++; };

const db = new PGlite();

const OWNER = "11111111-1111-1111-1111-111111111111";
const PLAYER = "22222222-2222-2222-2222-222222222222";
const STAFF = "33333333-3333-3333-3333-333333333333";

// Act as a given user, the way PostgREST does: a non-superuser role plus a
// request.jwt.claims setting that auth.uid() reads.
async function asUser(uid, sql) {
  await db.exec("set role app_user;");
  // `false` = session-scoped, not transaction-scoped. With `true` the setting
  // is discarded at the end of the implicit transaction around this very
  // statement, so auth.uid() would be NULL by the time the query below runs
  // and every test would "pass" for the wrong reason.
  await db.exec(`select set_config('request.jwt.claims', '{"sub":"${uid}"}', false);`);
  try {
    return await db.query(sql);
  } finally {
    await db.exec("reset role;");
  }
}

await db.exec(`
  create role app_user nologin;

  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid
  $$;

  create table tournaments (id uuid primary key, owner_id uuid not null);
  create table tournament_events (id uuid primary key, tournament_id uuid not null references tournaments(id));
  create table tournament_members (tournament_id uuid not null, user_id uuid not null, role text not null);
  create table entries (
    id uuid primary key,
    event_id uuid not null references tournament_events(id),
    payment_status text not null default 'UNPAID',
    check_in_status text not null default 'NOT_CHECKED_IN'
  );

  create or replace function is_event_owner(ev uuid) returns boolean
    language sql stable security definer set search_path = public as $$
      select exists (
        select 1 from tournament_events e
        join tournaments t on t.id = e.tournament_id
        where e.id = ev and t.owner_id = auth.uid()
      )
    $$;

  create or replace function has_tournament_role(t_id uuid, roles text[]) returns boolean
    language sql stable security definer set search_path = public as $$
      select exists (
        select 1 from tournament_members m
        where m.tournament_id = t_id and m.user_id = auth.uid() and m.role = any(roles)
      )
    $$;

  alter table entries enable row level security;
  grant select, update on entries to app_user;

  -- Reconstructed exactly from production. There is deliberately no player
  -- UPDATE policy here, because there is none in production either.
  create policy owner_update_entries on entries for update
    using (is_event_owner(event_id)) with check (is_event_owner(event_id));

  create policy staff_update_checkin on entries for update
    using (has_tournament_role((select ev.tournament_id from tournament_events ev where ev.id = entries.event_id),
           array['ORGANIZER','ADMIN','VOLUNTEER']))
    with check (has_tournament_role((select ev.tournament_id from tournament_events ev where ev.id = entries.event_id),
           array['ORGANIZER','ADMIN','VOLUNTEER']));

  create policy read_entries on entries for select using (true);
  grant usage on schema public to app_user;
  grant select on tournaments, tournament_events, tournament_members to app_user;

  insert into tournaments values ('aaaaaaaa-0000-0000-0000-000000000001', '${OWNER}');
  insert into tournament_events values ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001');
  insert into tournament_members values ('aaaaaaaa-0000-0000-0000-000000000001', '${STAFF}', 'VOLUNTEER');
  insert into entries (id, event_id) values ('cccccccc-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001');
`);

console.log("\nA player cannot pay their own way in");

{
  const res = await asUser(PLAYER, `
    update entries set payment_status = 'PAID'
    where id = 'cccccccc-0000-0000-0000-000000000001' returning id;
  `);
  if (res.rows.length === 0) ok("a player's UPDATE to payment_status='PAID' affects zero rows")
  else bad("A PLAYER MARKED THEIR OWN ENTRY PAID — entry fees are now optional");

  const { rows } = await db.query("select payment_status from entries;");
  if (rows[0].payment_status === "UNPAID") ok("the stored value is still UNPAID")
  else bad(`stored value became ${rows[0].payment_status}`);
}

{
  // Check-in is the other column on this table a player might reach for.
  const res = await asUser(PLAYER, `
    update entries set check_in_status = 'CHECKED_IN'
    where id = 'cccccccc-0000-0000-0000-000000000001' returning id;
  `);
  if (res.rows.length === 0) ok("a player cannot check themselves in either")
  else bad("a player checked themselves in without visiting the desk");
}

console.log("\nThe people who SHOULD be able to write still can");

{
  // The organizer recording cash at the desk. This is why the rule is
  // "only the webhook OR an organizer recording an offline payment" rather
  // than "only the webhook" — recordOfflinePayment is a real, intended path.
  const res = await asUser(OWNER, `
    update entries set payment_status = 'PAID'
    where id = 'cccccccc-0000-0000-0000-000000000001' returning id;
  `);
  if (res.rows.length === 1) ok("the tournament owner can record an offline payment")
  else bad("the owner cannot record a cash payment — offline collection is broken");
}

{
  const res = await asUser(STAFF, `
    update entries set check_in_status = 'CHECKED_IN'
    where id = 'cccccccc-0000-0000-0000-000000000001' returning id;
  `);
  if (res.rows.length === 1) ok("a VOLUNTEER can still run the check-in desk")
  else bad("staff cannot check players in — the check-in desk is broken");
}

console.log(`\n${pass} passed, ${fail} failed.\n`);
await db.close();
process.exit(fail ? 1 : 0);
