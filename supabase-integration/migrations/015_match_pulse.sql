/* ══════════════════════════════════════════════════════════════════════════
   015 — MatchDay Pulse: the rally log
   ══════════════════════════════════════════════════════════════════════════

   `games` stores one row per game holding the CURRENT score, so once a game
   ends, how it got there is gone. 21-19 looks the same whether it was a
   procession or a comeback from 9-15. This table keeps every rally, in order,
   which is what powers:

     - the momentum / win-probability chart on the match page and venue TV,
     - Match Story moments ("7 points in a row", "3 match points saved"),
     - the shareable match card.

   It is an APPEND-ONLY log written by the scoring client right after each
   successful point. Corrections are logged too (delta -1) rather than
   deleting rows, so the story can tell a mis-tap from a real rally and the
   audit trail stays complete. `games` remains the source of truth for the
   score; this log is the source of truth for the story. If a row is ever
   missing (a dropped request), the story degrades — the score never does.

   The MatchDay Rating itself needs no table: it is a deterministic replay of
   completed matches (src/lib/rating.js), so it can never drift from results.

   SAFE TO APPLY ANY TIME. The client detects whether this table exists and
   skips logging until it does (see logRally in repository.js).
   ══════════════════════════════════════════════════════════════════════════ */

create table if not exists public.match_points (
  id          bigint generated always as identity primary key,
  match_id    uuid not null references public.matches(id) on delete cascade,
  game_number int  not null check (game_number between 1 and 5),
  side        text not null check (side in ('A', 'B')),
  delta       int  not null check (delta in (-1, 1)),
  score_a     int  not null check (score_a between 0 and 30),
  score_b     int  not null check (score_b between 0 and 30),
  created_by  uuid default auth.uid() references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- Every read is "this match's rallies, in order".
create index if not exists match_points_match_idx on public.match_points (match_id, id);

alter table public.match_points enable row level security;

-- Readable exactly where the match's games are: anyone for a published
-- tournament, staff for their own drafts. Nothing in this table is personal —
-- it is sides and scores, the same facts the public scoreboard shows.
drop policy if exists "select_match_points" on public.match_points;
create policy "select_match_points" on public.match_points for select to anon, authenticated
  using (public.match_is_published(match_id) or public.is_match_owner(match_id));

drop policy if exists "staff_select_match_points" on public.match_points;
create policy "staff_select_match_points" on public.match_points for select to authenticated
  using (public.can_score_match(match_id));

-- Only someone allowed to score the match may append to its log, and only as
-- themselves.
drop policy if exists "staff_insert_match_points" on public.match_points;
create policy "staff_insert_match_points" on public.match_points for insert to authenticated
  with check (public.can_score_match(match_id) and coalesce(created_by, auth.uid()) = auth.uid());

-- No update or delete policy: the log is append-only by design.

-- Realtime, so a spectator's momentum chart moves with the rally.
do $blk$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'match_points'
  ) then
    alter publication supabase_realtime add table public.match_points;
  end if;
end $blk$;

comment on table public.match_points is
  'Append-only rally log (migration 015). One row per point scored or corrected. games holds the score; this holds how the score happened — momentum, win probability and Match Story are read from it.';
