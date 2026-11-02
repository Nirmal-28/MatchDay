/* Verifies migration 018 (assistant daily limit) against a real Postgres
 * (PGlite/WASM), applying the file AS SHIPPED.
 *
 * What must hold:
 *   - a signed-in user gets exactly 40 requests a day, then is refused;
 *   - one user's count never spends another's, and a new day starts fresh;
 *   - anon cannot call it, and a signed-out authenticated call is refused;
 *   - the table cannot be read or reset directly from the browser.
 *
 * Run: node scripts/verify-migration-018.mjs   (also: npm run test:migrations)
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const MIGRATION = join(ROOT, "supabase-integration/migrations/018_assistant_usage.sql");

let pass = 0, fail = 0;
const ok = (m) => { console.log(`  ok   - ${m}`); pass++; };
const bad = (m, d) => { console.log(`  FAIL - ${m}${d ? `\n         ${d}` : ""}`); fail++; };
const check = (cond, m, d) => (cond ? ok(m) : bad(m, d));

const ALICE = "99999999-9999-9999-9999-999999999999";
const BOB = "55555555-5555-5555-5555-555555555555";

const db = new PGlite();
await db.exec(`
create schema if not exists auth;
create table auth.users (id uuid primary key default gen_random_uuid());
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create role anon nologin;
create role authenticated nologin;
grant usage on schema public to anon, authenticated;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
insert into auth.users (id) values ('${ALICE}'), ('${BOB}');
`);

await db.exec(readFileSync(MIGRATION, "utf8"));
await db.exec("grant select, insert, update, delete on public.assistant_usage to authenticated;");

async function as(role, uid, sql) {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${uid ?? ""}', false);`);
  try { return await db.query(sql); } finally { await db.exec("reset role;"); }
}
const claim = async (uid) => (await as("authenticated", uid, "select public.claim_assistant_request() as ok")).rows[0].ok;
const refused = async (fn) => { try { await fn(); return false; } catch { return true; } };

let allowed = 0;
for (let i = 0; i < 40; i++) if (await claim(ALICE)) allowed++;
check(allowed === 40, "a user gets 40 requests in a day", `got ${allowed}`);
check((await claim(ALICE)) === false, "request 41 is refused");
check((await claim(ALICE)) === false, "and stays refused");

check((await claim(BOB)) === true, "another user is unaffected");

await db.exec(`update public.assistant_usage set day = current_date - 1 where user_id = '${ALICE}'`);
check((await claim(ALICE)) === true, "a new day starts a fresh count");

check(await refused(() => as("anon", "", "select public.claim_assistant_request()")), "anon cannot call it");
check(await refused(() => as("authenticated", "", "select public.claim_assistant_request()")), "a call with no user is refused");

const seen = await as("authenticated", ALICE, "select * from public.assistant_usage");
check(seen.rows.length === 0, "the table reads as empty to a user, even with table grants");
await as("authenticated", ALICE, `delete from public.assistant_usage where user_id = '${ALICE}'`);
const left = await db.query(`select 1 from public.assistant_usage where user_id = '${ALICE}'`);
check(left.rows.length > 0, "a user cannot wipe their own count");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
