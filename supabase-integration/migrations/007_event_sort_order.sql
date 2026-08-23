-- MatchDay — migration 007
-- tournament_events.sort_order — fixes a real bug where categories could
-- appear in a random tab order. All events created for one tournament in
-- the wizard are inserted in a single bulk statement, so they all get the
-- IDENTICAL created_at timestamp (now() evaluates once per statement) —
-- "order by created_at" was therefore not actually deterministic, and the
-- category tab a fresh "Add participant" click landed on could be whichever
-- one Postgres happened to return first for tied timestamps.
--
-- HOW TO RUN: Supabase dashboard -> SQL Editor -> paste this whole file -> Run.
-- Safe to re-run (idempotent).

alter table public.tournament_events add column if not exists sort_order int not null default 0;

-- Backfill existing rows with a stable order derived from category code,
-- since there's nothing better to go on for rows created before this column existed.
update public.tournament_events set sort_order = 0 where category = 'MS';
update public.tournament_events set sort_order = 1 where category = 'WS';
update public.tournament_events set sort_order = 2 where category = 'MD';
update public.tournament_events set sort_order = 3 where category = 'WD';
update public.tournament_events set sort_order = 4 where category = 'XD';
