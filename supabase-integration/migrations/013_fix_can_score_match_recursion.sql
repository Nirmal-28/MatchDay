/* ══════════════════════════════════════════════════════════════════════════
   013 — Fix infinite RLS recursion on public.matches
   ══════════════════════════════════════════════════════════════════════════

   SEVERITY: P0. Before this migration, ANY authenticated user reading matches
   from a tournament that has a draw got:

     GET /rest/v1/matches?select=*,games(*)  ->  500
     {"code":"54001","message":"stack depth limit exceeded"}

   That is every match-dependent surface at once — draw, bracket, schedule,
   live scoring, Scorer Mode, results, Match Center, next-match on the player
   dashboard, and Tournament Health. Anonymous spectators were unaffected
   (the failing policy is `to authenticated`), which is why public tournament
   pages kept working and hid the problem.

   ── Root cause ─────────────────────────────────────────────────────────
   can_score_match() (migration 005) is SECURITY INVOKER *and* reads
   public.matches, while itself being the USING clause of the
   staff_select_matches policy ON public.matches (migration 008):

     SELECT on matches
       -> evaluate staff_select_matches
         -> can_score_match()
           -> SELECT on matches      <-- RLS applies again, invoker rights
             -> evaluate staff_select_matches
               -> ... until the stack is exhausted

   Migration 008 already documents this exact hazard for is_tournament_staff:
     "SECURITY DEFINER so tournament policies can call it without recursing
      back into tournament_members' own policies."
   can_score_match() predates that lesson and never got the same treatment.

   This also fixes a transitive case: reading `games` evaluates
   is_match_owner()/match_is_published() (schema.sql), which read `matches`,
   which re-entered the same cycle. Those two stay SECURITY INVOKER — they
   are cross-table calls and are no longer recursive once the cycle below is
   broken, so this migration deliberately changes as little as possible.

   ── Why SECURITY DEFINER is safe here ──────────────────────────────────
   The elevated read is ONLY used to resolve a match id to its tournament id.
   The authorisation decision itself is still has_tournament_role(), which is
   evaluated against auth.uid() exactly as before. The function returns a
   boolean and never returns row data, so it cannot leak match contents.
   Verified in scripts/verify-rls-recursion.mjs: a stranger still sees no
   matches, a SCORER sees only their own tournament's, and published
   tournaments stay publicly readable.
   ══════════════════════════════════════════════════════════════════════════ */

create or replace function public.can_score_match(m_id uuid)
returns boolean
language sql
security definer            -- was: security invoker  <-- the fix
stable
set search_path = public
as $fn$
  select public.has_tournament_role(
    (
      -- Runs as the function owner, so this read does NOT re-enter the
      -- policy on public.matches that called us. This line is the whole bug.
      select ev.tournament_id
      from public.matches m
      join public.tournament_events ev on ev.id = m.event_id
      where m.id = m_id
    ),
    array['ORGANIZER','ADMIN','REFEREE','SCORER']
  );
$fn$;

/* Keep the RPC surface as it was: this is a policy helper, not an endpoint.
   It reports a fact about the caller, so `authenticated` must retain EXECUTE
   or every policy that uses it fails closed (see the note in 008 — revoking
   from PUBLIC also strips what authenticated inherits, so it is granted back
   explicitly rather than left implicit). */
revoke execute on function public.can_score_match(uuid) from public, anon;
grant  execute on function public.can_score_match(uuid) to authenticated;

comment on function public.can_score_match(uuid) is
  'True when the caller owns the tournament this match belongs to, or holds ORGANIZER/ADMIN/REFEREE/SCORER on it. SECURITY DEFINER is required: it reads public.matches, and is used by policies ON public.matches, so invoker rights recurse infinitely (migration 013).';
