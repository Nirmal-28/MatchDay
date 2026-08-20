-- MatchDay — migration 003
-- Make player profiles publicly viewable.
--
-- entry_players is organizer-only by design (it holds phone/email), which
-- meant a shared profile link showed zero matches to anyone but the organizer.
-- public_entry_names already exposes a name-only projection for published
-- tournaments; adding player_id lets anyone resolve "which entries is this
-- player?" without ever exposing contact details.
--
-- HOW TO RUN: Supabase dashboard -> SQL Editor -> paste this whole file -> Run.
-- Safe to re-run.

create or replace view public.public_entry_names as
  select ep.id, ep.entry_id, ep.name, ep.player_id
  from public.entry_players ep
  join public.entries e on e.id = ep.entry_id
  where public.entry_is_published(e.id);

revoke all on public.public_entry_names from public;
grant select on public.public_entry_names to anon, authenticated;
comment on view public.public_entry_names is
  'Read-only, name-only projection of entry_players for published tournaments. Intentionally omits phone/email.';
