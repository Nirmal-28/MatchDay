-- MatchDay — migration 002
-- Tournament engine (formats, divisions, seeding) + persistent player identity.
--
-- HOW TO RUN: Supabase dashboard -> SQL Editor -> paste this whole file -> Run.
-- Safe to re-run (idempotent).

-- ── 1. Formats: round robin + group->knockout ────────────────────────────
alter table public.tournament_events drop constraint if exists tournament_events_format_check;
alter table public.tournament_events add constraint tournament_events_format_check
  check (format in ('SINGLE_ELIM','ROUND_ROBIN','GROUP_KO'));

alter table public.tournament_events add column if not exists group_count int;
alter table public.tournament_events add column if not exists advance_per_group int default 2;

-- ── 2. Age groups + skill grades ─────────────────────────────────────────
-- Indian tournaments almost always split a category by age and/or grade,
-- so MS/U15/A and MS/Open/B must be able to coexist in one tournament.
alter table public.tournament_events add column if not exists age_group text
  not null default 'OPEN';
alter table public.tournament_events drop constraint if exists tournament_events_age_group_check;
alter table public.tournament_events add constraint tournament_events_age_group_check
  check (age_group in ('OPEN','U11','U13','U15','U17','U19','35+','40+','45+','50+','55+'));

alter table public.tournament_events add column if not exists skill_grade text;
alter table public.tournament_events drop constraint if exists tournament_events_skill_grade_check;
alter table public.tournament_events add constraint tournament_events_skill_grade_check
  check (skill_grade is null or skill_grade in ('A','B','C'));

-- the old "one row per category" uniqueness no longer holds
alter table public.tournament_events drop constraint if exists tournament_events_tournament_id_category_key;
create unique index if not exists tournament_events_unique_division
  on public.tournament_events (tournament_id, category, age_group, coalesce(skill_grade, ''));

-- ── 3. Round-robin / group support on matches ────────────────────────────
alter table public.matches add column if not exists group_label text;
create index if not exists matches_group_idx on public.matches (event_id, group_label);

-- Round-robin matches have no next_match_id, so a match with both entries
-- set is immediately playable. Nothing to change structurally.

-- ── 4. Persistent player identity ────────────────────────────────────────
-- Phone is the practical identity key in the Indian market. This is what
-- turns one-off entries into a profile with career stats across tournaments.
create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  phone text unique not null,
  name text not null,
  email text,
  city text,
  club text,
  gender text check (gender in ('M','F','O')),
  year_of_birth int,
  created_at timestamptz not null default now()
);
create index if not exists players_name_idx on public.players (lower(name));

alter table public.entry_players add column if not exists player_id uuid
  references public.players(id) on delete set null;
create index if not exists entry_players_player_idx on public.entry_players (player_id);

alter table public.players enable row level security;

drop policy if exists "public_insert_players" on public.players;
drop policy if exists "select_players" on public.players;
drop policy if exists "owner_update_players" on public.players;
drop policy if exists "update_players" on public.players;

-- Registration is open to anon (same posture as entry_players), so anon must
-- be able to create/lookup its own player row. Sensitive columns are kept out
-- of the public projection below rather than by blocking the table read.
create policy "public_insert_players" on public.players
  for insert to anon, authenticated with check (true);
create policy "select_players" on public.players
  for select to anon, authenticated using (true);
create policy "update_players" on public.players
  for update to anon, authenticated using (true) with check (true);

grant select, insert, update on public.players to anon, authenticated;

-- Name-only public projection, mirroring public_entry_names: phone/email
-- must never be surfaced on public pages.
create or replace view public.public_players as
  select id, name, city, club, gender from public.players;
revoke all on public.public_players from public;
grant select on public.public_players to anon, authenticated;
comment on view public.public_players is
  'Public projection of players. Intentionally omits phone/email/year_of_birth.';
