-- MatchDay — migration 004
-- Smart Scheduling + Conflict Detection engine: data model additions.
--
-- HOW TO RUN: Supabase dashboard -> SQL Editor -> paste this whole file -> Run.
-- Safe to re-run (idempotent).

-- ── 1. Court availability windows ────────────────────────────────────────
alter table public.courts add column if not exists available_start time not null default '09:00';
alter table public.courts add column if not exists available_end time not null default '18:00';

-- ── 2. Tournament-level scheduling flags ─────────────────────────────────
-- Scheduling constraints (matchDurationMins, bufferMins, minRestMins,
-- startTime, endTime) already live in tournaments.settings jsonb — no new
-- columns needed there, just new keys the UI reads/writes.
alter table public.tournaments add column if not exists schedule_published boolean not null default false;

-- ── 3. Scheduling fields on matches ──────────────────────────────────────
alter table public.matches add column if not exists scheduled_end timestamptz;
alter table public.matches add column if not exists court_id uuid references public.courts(id) on delete set null;
alter table public.matches add column if not exists locked boolean not null default false;
alter table public.matches add column if not exists priority text not null default 'NORMAL';
alter table public.matches drop constraint if exists matches_priority_check;
alter table public.matches add constraint matches_priority_check
  check (priority in ('NORMAL','HIGH','CRITICAL'));
create index if not exists matches_court_idx on public.matches (court_id);

-- ── 4. Schedule audit trail ───────────────────────────────────────────────
create table if not exists public.schedule_audit_log (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  match_id uuid references public.matches(id) on delete set null,
  action text not null, -- GENERATED | MOVED | LOCKED | UNLOCKED | PUBLISHED
  from_court text,
  to_court text,
  from_time timestamptz,
  to_time timestamptz,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists schedule_audit_tournament_idx on public.schedule_audit_log (tournament_id, created_at desc);

alter table public.schedule_audit_log enable row level security;
create policy "owner_select_audit" on public.schedule_audit_log for select to authenticated
  using (public.is_tournament_owner(tournament_id));
create policy "owner_insert_audit" on public.schedule_audit_log for insert to authenticated
  with check (public.is_tournament_owner(tournament_id));

alter publication supabase_realtime add table public.schedule_audit_log;
