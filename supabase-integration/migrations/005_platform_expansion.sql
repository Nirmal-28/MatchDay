-- MatchDay — migration 005
-- Platform expansion: RBAC, multi-day scheduling, waitlist, check-in,
-- disputes/corrections, payment ledger.
--
-- HOW TO RUN: Supabase dashboard -> SQL Editor -> paste this whole file -> Run.
-- Safe to re-run (idempotent).

-- ── 1. RBAC: staff roles per tournament ──────────────────────────────────
-- tournaments.organizer_id remains the OWNER. This table adds additional
-- staff (co-organizers, referees, scorers, volunteers) scoped to one
-- tournament each, without touching the existing owner model.
create table if not exists public.tournament_members (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('ORGANIZER','ADMIN','REFEREE','SCORER','VOLUNTEER')),
  invited_email text,
  created_at timestamptz not null default now(),
  unique (tournament_id, user_id)
);
create index if not exists tournament_members_tournament_idx on public.tournament_members (tournament_id);
create index if not exists tournament_members_user_idx on public.tournament_members (user_id);

create or replace function public.has_tournament_role(t_id uuid, roles text[])
returns boolean language sql security invoker set search_path = public stable as $$
  select public.is_tournament_owner(t_id) or exists (
    select 1 from public.tournament_members
    where tournament_id = t_id and user_id = (select auth.uid()) and role = any(roles)
  );
$$;

-- A user can score/referee a match if they own the tournament or hold a
-- SCORER/REFEREE/ADMIN/ORGANIZER role on it.
create or replace function public.can_score_match(m_id uuid)
returns boolean language sql security invoker set search_path = public stable as $$
  select public.has_tournament_role(
    (select ev.tournament_id from public.matches m join public.tournament_events ev on ev.id = m.event_id where m.id = m_id),
    array['ORGANIZER','ADMIN','REFEREE','SCORER']
  );
$$;

alter table public.tournament_members enable row level security;
drop policy if exists "owner_manage_members" on public.tournament_members;
create policy "owner_manage_members" on public.tournament_members for all to authenticated
  using (public.is_tournament_owner(tournament_id)) with check (public.is_tournament_owner(tournament_id));
drop policy if exists "self_select_membership" on public.tournament_members;
create policy "self_select_membership" on public.tournament_members for select to authenticated
  using (user_id = (select auth.uid()) or public.is_tournament_owner(tournament_id));

-- ── 2. Multi-day scheduling ───────────────────────────────────────────────
-- Per-court, per-date availability overrides. Falls back to
-- courts.available_start/available_end when no row exists for a date.
create table if not exists public.court_availability (
  id uuid primary key default gen_random_uuid(),
  court_id uuid not null references public.courts(id) on delete cascade,
  date date not null,
  start_time time not null default '09:00',
  end_time time not null default '18:00',
  unique (court_id, date)
);
create index if not exists court_availability_court_idx on public.court_availability (court_id, date);

alter table public.court_availability enable row level security;
drop policy if exists "select_court_availability" on public.court_availability;
create policy "select_court_availability" on public.court_availability for select to anon, authenticated
  using (exists (select 1 from public.courts c where c.id = court_id and (public.tournament_is_published(c.tournament_id) or public.is_tournament_owner(c.tournament_id))));
drop policy if exists "owner_write_court_availability" on public.court_availability;
create policy "owner_write_court_availability" on public.court_availability for all to authenticated
  using (exists (select 1 from public.courts c where c.id = court_id and public.is_tournament_owner(c.tournament_id)))
  with check (exists (select 1 from public.courts c where c.id = court_id and public.is_tournament_owner(c.tournament_id)));

-- ── 3. Waitlist ────────────────────────────────────────────────────────────
alter table public.entries drop constraint if exists entries_reg_status_check;
alter table public.entries add constraint entries_reg_status_check
  check (reg_status in ('PENDING','CONFIRMED','REJECTED','CANCELLED','WAITLISTED'));
alter table public.entries add column if not exists waitlist_position int;
alter table public.tournament_events add column if not exists auto_promote_waitlist boolean not null default false;

-- Capacity enforcement now waitlists instead of hard-rejecting a full
-- category, and stamps a waitlist position instead of raising an exception.
create or replace function public.enforce_event_capacity()
returns trigger language plpgsql set search_path = public as $$
declare
  active_count int;
  max_allowed int;
  next_pos int;
begin
  select max_entries into max_allowed from public.tournament_events where id = new.event_id;
  if max_allowed is null then
    return new;
  end if;
  select count(*) into active_count from public.entries
  where event_id = new.event_id and reg_status in ('PENDING','CONFIRMED');
  if active_count >= max_allowed then
    select coalesce(max(waitlist_position), 0) + 1 into next_pos
    from public.entries where event_id = new.event_id and reg_status = 'WAITLISTED';
    new.reg_status := 'WAITLISTED';
    new.waitlist_position := next_pos;
  end if;
  return new;
end;
$$;

-- ── 4. Check-in ─────────────────────────────────────────────────────────────
alter table public.entries add column if not exists check_in_status text not null default 'NOT_CHECKED_IN'
  check (check_in_status in ('NOT_CHECKED_IN','CHECKED_IN','LATE','NO_SHOW'));
alter table public.entries add column if not exists checked_in_at timestamptz;
alter table public.entries add column if not exists check_in_code text;
update public.entries set check_in_code = encode(gen_random_bytes(6), 'hex') where check_in_code is null;
alter table public.entries alter column check_in_code set default encode(gen_random_bytes(6), 'hex');
create unique index if not exists entries_check_in_code_idx on public.entries (check_in_code);

-- Staff (any tournament_members role, not just the owner) can see and check
-- in entries for tournaments they're staffing — needed for check-in duty and
-- the scorer roster, without granting them tournament-settings access.
drop policy if exists "staff_select_entries" on public.entries;
create policy "staff_select_entries" on public.entries for select to authenticated
  using (public.has_tournament_role(
    (select ev.tournament_id from public.tournament_events ev where ev.id = event_id),
    array['ORGANIZER','ADMIN','REFEREE','SCORER','VOLUNTEER']
  ));
drop policy if exists "staff_update_checkin" on public.entries;
create policy "staff_update_checkin" on public.entries for update to authenticated
  using (public.has_tournament_role(
    (select ev.tournament_id from public.tournament_events ev where ev.id = event_id),
    array['ORGANIZER','ADMIN','VOLUNTEER']
  ))
  with check (public.has_tournament_role(
    (select ev.tournament_id from public.tournament_events ev where ev.id = event_id),
    array['ORGANIZER','ADMIN','VOLUNTEER']
  ));

-- ── 5. Score disputes / corrections ──────────────────────────────────────────
create table if not exists public.match_disputes (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  raised_by uuid references auth.users(id) on delete set null,
  raised_by_role text,
  type text not null check (type in ('SCORE','WINNER','OPPONENT','OTHER')),
  description text not null,
  status text not null default 'OPEN' check (status in ('OPEN','RESOLVED','REJECTED')),
  resolution_note text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null
);
create index if not exists match_disputes_tournament_idx on public.match_disputes (tournament_id, status);
create index if not exists match_disputes_match_idx on public.match_disputes (match_id);

alter table public.match_disputes enable row level security;
drop policy if exists "owner_or_scorer_select_disputes" on public.match_disputes;
create policy "owner_or_scorer_select_disputes" on public.match_disputes for select to authenticated
  using (public.has_tournament_role(tournament_id, array['ORGANIZER','ADMIN','REFEREE','SCORER']));
drop policy if exists "scorer_insert_disputes" on public.match_disputes;
create policy "scorer_insert_disputes" on public.match_disputes for insert to authenticated
  with check (public.has_tournament_role(tournament_id, array['ORGANIZER','ADMIN','REFEREE','SCORER']));
drop policy if exists "owner_update_disputes" on public.match_disputes;
create policy "owner_update_disputes" on public.match_disputes for update to authenticated
  using (public.has_tournament_role(tournament_id, array['ORGANIZER','ADMIN']))
  with check (public.has_tournament_role(tournament_id, array['ORGANIZER','ADMIN']));

-- ── 6. Payment ledger (provider-neutral) ─────────────────────────────────────
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.entries(id) on delete cascade,
  provider text not null check (provider in ('MOCK','RAZORPAY')),
  provider_order_id text,
  provider_payment_id text,
  amount_inr numeric(10,2) not null,
  status text not null default 'PENDING' check (status in ('PENDING','PAID','FAILED','REFUNDED')),
  raw_response jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists payments_entry_idx on public.payments (entry_id);

alter table public.payments enable row level security;
drop policy if exists "owner_select_payments" on public.payments;
create policy "owner_select_payments" on public.payments for select to authenticated
  using (public.is_entry_owner(entry_id));
-- Inserts/updates to `payments` happen server-side only (mock dev endpoint or
-- the Razorpay webhook using the service_role key), never directly from the
-- browser — so there is deliberately no anon/authenticated insert policy here.

-- ── 7. Organizer can always add participants to their own event ─────────────
-- Previously entries could only be inserted through "public_register_entries",
-- gated on REGISTRATION_OPEN — which meant even the organizer's own
-- "Add participant" / CSV import silently failed once registration closed.
drop policy if exists "owner_insert_entries" on public.entries;
create policy "owner_insert_entries" on public.entries for insert to authenticated
  with check (public.is_event_owner(event_id));

-- ── 8. Realtime (idempotent — skip tables already in the publication) ───────
do $$
declare
  t text;
begin
  foreach t in array array['tournament_members','court_availability','match_disputes','payments'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
