-- MatchDay — migration 006
-- Sport field on tournaments, so the sport-agnostic engine has something to
-- key sport-specific rules/icons off of. Badminton is the only sport with a
-- real rules engine today; this just stops the schema from hardcoding that.
--
-- HOW TO RUN: Supabase dashboard -> SQL Editor -> paste this whole file -> Run.
-- Safe to re-run (idempotent).

alter table public.tournaments add column if not exists sport text not null default 'badminton';
alter table public.tournaments drop constraint if exists tournaments_sport_check;
alter table public.tournaments add constraint tournaments_sport_check
  check (sport in ('badminton','tennis','tableTennis','volleyball','basketball','football','cricket','pickleball'));
