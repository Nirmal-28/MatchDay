/* ══════════════════════════════════════════════════════════════════════════
   012 — Configurable registration fields + follow relationships
   ══════════════════════════════════════════════════════════════════════════

   Two additions, both deliberately built as thin layers over the existing
   model rather than as new parallel systems.

   ── 1. Configurable registration fields ────────────────────────────────
   Organizers need to ask for more than name/phone/email (club, skill level,
   jersey size, emergency contact, a waiver acknowledgement). The obvious
   shortcut — a `custom_fields jsonb` column on `entries` — would be a real
   PII leak: `select_entries` (schema.sql) is readable by `anon` for any
   published event, so every answer would be world-readable the moment the
   tournament went public. An emergency contact number is exactly the kind of
   data that must never be exposed that way.

   So answers live in their own table with their own RLS (staff + the entry's
   own players only), and the subset the organizer explicitly marks PUBLIC is
   exposed through a view that filters by the tournament's field definitions.
   Private answers have no public read path at all.

   ── 2. Follows ─────────────────────────────────────────────────────────
   A minimal competitive-network primitive: one row per (user, subject).
   Deliberately NOT a social graph — there is no feed, no follower list, no
   mutual/friend concept. A user reads only their own follow rows; aggregate
   counts come from a SECURITY DEFINER function so that "how many people
   follow this tournament" never requires exposing WHO follows it.
   ══════════════════════════════════════════════════════════════════════════ */

/* ── 1. FIELD DEFINITIONS (on the tournament) ──────────────────────────────
   Shape of each element of registration_fields:
     {
       "key":        "jersey_size",        -- stable identifier, snake_case
       "label":      "Jersey size",
       "type":       "text|number|select|checkbox|tel|email|date",
       "required":   true|false,
       "visibility": "PUBLIC"|"PRIVATE",   -- PRIVATE is the default and the
                                           -- safe choice; PUBLIC opts a field
                                           -- into the public view below
       "options":    ["S","M","L"],        -- select only
       "help":       "optional hint text"
     }
   Kept as jsonb rather than a table because these are configuration, not
   entities: they are always read as a whole set, always with their tournament,
   and never queried across tournaments.                                     */
alter table public.tournaments
  add column if not exists registration_fields jsonb not null default '[]'::jsonb;

comment on column public.tournaments.registration_fields is
  'Organizer-defined extra registration questions. Array of {key,label,type,required,visibility,options,help}. Answers live in entry_details, never on entries (which is anon-readable).';

-- Guard rails so a malformed write cannot produce fields the UI must guess at.
alter table public.tournaments drop constraint if exists tournaments_registration_fields_shape;
alter table public.tournaments add constraint tournaments_registration_fields_shape
  check (jsonb_typeof(registration_fields) = 'array' and jsonb_array_length(registration_fields) <= 25);


/* ── 2. ANSWERS (their own table, their own RLS) ──────────────────────── */
create table if not exists public.entry_details (
  entry_id   uuid primary key references public.entries(id) on delete cascade,
  answers    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Size is checked via length(answers::text) rather than pg_column_size(),
-- which is STABLE — Postgres rejects non-IMMUTABLE functions in a CHECK.
alter table public.entry_details drop constraint if exists entry_details_answers_shape;
alter table public.entry_details add constraint entry_details_answers_shape
  check (jsonb_typeof(answers) = 'object' and length(answers::text) <= 8192);

alter table public.entry_details enable row level security;

/* Postgres evaluates RLS policy expressions as the CALLING role, and 008
   deliberately revoked EXECUTE on entry_tournament_id() from `authenticated`
   to keep it off the PostgREST RPC surface. Using it in a policy would fail
   closed. This helper is the policy-safe equivalent: SECURITY DEFINER, granted
   to authenticated, and it reports only a fact about the caller. */
create or replace function public.is_entry_tournament_staff(p_entry_id uuid)
returns boolean language sql security definer stable set search_path = public as $fn$
  select exists (
    select 1
    from public.entries e
    join public.tournament_events ev on ev.id = e.event_id
    where e.id = p_entry_id
      and public.is_tournament_staff(ev.tournament_id)
  );
$fn$;
revoke execute on function public.is_entry_tournament_staff(uuid) from public, anon;
grant  execute on function public.is_entry_tournament_staff(uuid) to authenticated;

-- Staff of the owning tournament can read every answer (they need the
-- emergency contact on tournament day). Scoped per-tournament, so access to
-- tournament A never reaches tournament B.
drop policy if exists "staff_select_entry_details" on public.entry_details;
create policy "staff_select_entry_details" on public.entry_details for select to authenticated
  using (
    public.is_entry_owner(entry_id)
    or public.is_entry_tournament_staff(entry_id)
  );

-- A player reads the answers attached to their own entries.
drop policy if exists "player_select_entry_details" on public.entry_details;
create policy "player_select_entry_details" on public.entry_details for select to authenticated
  using (entry_id in (select public.my_entry_ids()));

/* Insert mirrors the registration window enforced on `entries` in 009: an
   answer set can only be attached while that entry could itself be created.
   Anon is included because registration does not require an account.

   The `created_at` bound is load-bearing, not belt-and-braces. Entry ids are
   readable by anon for any published event (`select_entries`, schema.sql), so
   without it anyone could enumerate entry ids and write answers against
   somebody else's entry for the whole registration period — and because the
   primary key makes it first-write-wins and UPDATE is staff-only, they could
   pre-empt a real registrant's answers with junk the registrant then cannot
   correct. Binding the insert to entries created in the last 15 minutes
   narrows that to the registration transaction itself (registerEntry() writes
   the entry and its answers back to back), and makes pre-emption impossible
   because the attacker cannot write before the entry exists. */
drop policy if exists "public_insert_entry_details" on public.entry_details;
create policy "public_insert_entry_details" on public.entry_details for insert to anon, authenticated
with check (
  exists (
    select 1
    from public.entries e
    join public.tournament_events ev on ev.id = e.event_id
    join public.tournaments t on t.id = ev.tournament_id
    where e.id = entry_id
      and e.created_at > now() - interval '15 minutes'
      and ev.status = 'REGISTRATION_OPEN'
      and t.status  = 'REGISTRATION_OPEN'
      and (t.registration_opens_at  is null or now() >= t.registration_opens_at)
      and (t.registration_closes_at is null or now() <= t.registration_closes_at)
  )
);

-- Only the organizer/staff may correct an answer after the fact, and only
-- for their own tournament. Players cannot silently rewrite a waiver.
drop policy if exists "staff_update_entry_details" on public.entry_details;
create policy "staff_update_entry_details" on public.entry_details for update to authenticated
  using      (public.is_entry_owner(entry_id) or public.is_entry_tournament_staff(entry_id))
  with check (public.is_entry_owner(entry_id) or public.is_entry_tournament_staff(entry_id));

drop policy if exists "owner_delete_entry_details" on public.entry_details;
create policy "owner_delete_entry_details" on public.entry_details for delete to authenticated
  using (public.is_entry_owner(entry_id));

revoke all on public.entry_details from anon;
grant insert on public.entry_details to anon;               -- registration only
grant select, insert, update, delete on public.entry_details to authenticated;


/* ── 3. PUBLIC PROJECTION ──────────────────────────────────────────────────
   Only answers whose field definition says visibility = 'PUBLIC' are visible
   here, and only for a published event. Everything else — emergency contacts,
   dates of birth, anything the organizer did not deliberately publish — has
   no public read path.

   SECURITY INVOKER would re-apply entry_details' own RLS and return nothing
   to anon, so this is a SECURITY DEFINER view; the WHERE clause below is
   therefore the entire access control and is written to be restrictive.     */
create or replace view public.public_entry_details
with (security_invoker = false) as
  select
    d.entry_id,
    jsonb_object_agg(f.key, d.answers -> f.key) filter (where d.answers ? f.key) as answers
  from public.entry_details d
  join public.entries e            on e.id  = d.entry_id
  join public.tournament_events ev on ev.id = e.event_id
  join public.tournaments t        on t.id  = ev.tournament_id
  cross join lateral (
    select value ->> 'key' as key, value ->> 'visibility' as visibility
    from jsonb_array_elements(t.registration_fields)
  ) f
  where f.visibility = 'PUBLIC'
    and t.status in ('REGISTRATION_OPEN','REGISTRATION_CLOSED','LIVE','COMPLETED')
    and t.slug is not null
    -- A withdrawn or rejected entry is not a participant, so its answers stop
    -- being public along with it. Without this, a player who cancelled would
    -- keep their club shown on the tournament page indefinitely.
    and e.reg_status in ('PENDING','CONFIRMED','WAITLISTED')
  group by d.entry_id;

revoke all on public.public_entry_details from public;
grant select on public.public_entry_details to anon, authenticated;
comment on view public.public_entry_details is
  'Registration answers the organizer explicitly marked PUBLIC, for published tournaments only. Private answers are never selected here.';


/* ── 4. FOLLOWS ────────────────────────────────────────────────────────── */
create table if not exists public.follows (
  id           uuid primary key default gen_random_uuid(),
  follower_id  uuid not null references auth.users(id) on delete cascade,
  subject_type text not null check (subject_type in ('PLAYER','TOURNAMENT')),
  subject_id   uuid not null,
  created_at   timestamptz not null default now(),
  unique (follower_id, subject_type, subject_id)
);
create index if not exists follows_subject_idx  on public.follows (subject_type, subject_id);
create index if not exists follows_follower_idx on public.follows (follower_id);

comment on table public.follows is
  'Lightweight follow edges for the competitive network. No feed, no follower lists — a user can read only their own rows; counts come from follower_count().';

alter table public.follows enable row level security;

-- Deliberately narrow: you see only what YOU follow. Nobody can enumerate a
-- a player's followers, which keeps this from becoming a social graph and
-- avoids leaking who is watching whom.
drop policy if exists "select_own_follows" on public.follows;
create policy "select_own_follows" on public.follows for select to authenticated
  using (follower_id = (select auth.uid()));

drop policy if exists "insert_own_follows" on public.follows;
create policy "insert_own_follows" on public.follows for insert to authenticated
  with check (follower_id = (select auth.uid()));

drop policy if exists "delete_own_follows" on public.follows;
create policy "delete_own_follows" on public.follows for delete to authenticated
  using (follower_id = (select auth.uid()));

revoke all on public.follows from anon;
grant select, insert, delete on public.follows to authenticated;

-- Aggregate only. Returns a number, never an identity, so a public page can
-- show "312 following" without exposing a single follower.
create or replace function public.follower_count(p_subject_type text, p_subject_id uuid)
returns bigint language sql security definer stable set search_path = public as $fn$
  select count(*) from public.follows
  where subject_type = p_subject_type and subject_id = p_subject_id;
$fn$;
grant execute on function public.follower_count(text, uuid) to anon, authenticated;

-- Batch variant so a list of tournaments needs one round trip, not N.
create or replace function public.follower_counts(p_subject_type text, p_subject_ids uuid[])
returns table (subject_id uuid, followers bigint)
language sql security definer stable set search_path = public as $fn$
  select s.id, count(f.id)
  from unnest(p_subject_ids) as s(id)
  left join public.follows f
    on f.subject_id = s.id and f.subject_type = p_subject_type
  group by s.id;
$fn$;
grant execute on function public.follower_counts(text, uuid[]) to anon, authenticated;
