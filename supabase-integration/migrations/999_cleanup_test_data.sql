-- Not a schema migration — just a one-time cleanup of tournaments created by
-- automated testing during development. Safe to run once; deletes cascade to
-- their courts/events/entries/matches/games via existing FK constraints.
delete from public.tournaments where name ilike 'E2E %' or slug ilike 'e2e-%';

-- See what's left afterward:
select id, name, slug, status, created_at from public.tournaments order by created_at desc;
