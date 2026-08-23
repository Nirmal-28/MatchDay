-- MatchDay — migration 009
-- Tournament lifecycle guards, registration windows, and the recurring
-- competition foundation.
--
-- Design note on lifecycle states. The brief lists DRAFT, REGISTRATION_OPEN,
-- REGISTRATION_CLOSED, DRAW_READY, SCHEDULE_PUBLISHED, LIVE, COMPLETED,
-- ARCHIVED. Three of those are NOT added as tournament statuses, because the
-- database already records them and duplicating state is how it goes wrong:
--   DRAW_READY        -> tournament_events.status = 'DRAW_READY' (per category;
--                        a tournament can have one category drawn and another not)
--   SCHEDULE_PUBLISHED-> tournaments.schedule_published boolean
-- Only ARCHIVED is genuinely new. src/lib/lifecycle.js derives the single
-- display stage from these existing columns.
--
-- HOW TO RUN: Supabase dashboard -> SQL Editor -> paste -> Run. Idempotent.

/* ── 1. Registration window ─────────────────────────────────────────────
   `registration_deadline` (a date) stays for display. These two timestamps
   are what actually gate registration, so an organizer can open entries at a
   precise moment and have them close automatically without anyone clicking. */
alter table public.tournaments add column if not exists registration_opens_at timestamptz;
alter table public.tournaments add column if not exists registration_closes_at timestamptz;

/* ── 2. ARCHIVED status ─────────────────────────────────────────────── */
alter table public.tournaments drop constraint if exists tournaments_status_check;
alter table public.tournaments add constraint tournaments_status_check
  check (status in ('DRAFT','REGISTRATION_OPEN','REGISTRATION_CLOSED','LIVE','COMPLETED','CANCELLED','ARCHIVED'));

/* ── 3. Recurring competition foundation ────────────────────────────────
   Deliberately minimal: a series is a NAME that groups existing tournaments.
   Each matchday stays a normal tournament with its own events, draws and
   schedule, so nothing about the tournament model changes and standings
   across matchdays are an aggregation over tournaments in the series rather
   than a second competition system. */
create table if not exists public.tournament_series (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  sport text not null default 'badminton',
  created_at timestamptz not null default now()
);
alter table public.tournaments add column if not exists series_id uuid
  references public.tournament_series(id) on delete set null;
alter table public.tournaments add column if not exists series_round int;
create index if not exists tournaments_series_idx on public.tournaments (series_id, series_round);

alter table public.tournament_series enable row level security;
drop policy if exists "select_series" on public.tournament_series;
-- Series rows carry only a name/description, and a tournament that references
-- one is already public, so reading them publicly leaks nothing.
create policy "select_series" on public.tournament_series for select to anon, authenticated using (true);
drop policy if exists "owner_write_series" on public.tournament_series;
create policy "owner_write_series" on public.tournament_series for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

/* ── 4. Registration window enforced in RLS ─────────────────────────────
   Previously the only gate was status = REGISTRATION_OPEN. A tournament whose
   deadline had passed still accepted public entries until someone manually
   closed it. The organizer's own insert path (owner_insert_entries, added in
   005) is untouched, so an organizer can still add a late entry deliberately. */
drop policy if exists "public_register_entries" on public.entries;
create policy "public_register_entries" on public.entries for insert to anon, authenticated
with check (
  exists (
    select 1 from public.tournament_events ev
    join public.tournaments t on t.id = ev.tournament_id
    where ev.id = event_id
      and ev.status = 'REGISTRATION_OPEN'
      and t.status = 'REGISTRATION_OPEN'
      and (t.registration_opens_at  is null or now() >= t.registration_opens_at)
      and (t.registration_closes_at is null or now() <= t.registration_closes_at)
  )
);

/* ── 5. Check-in is only meaningful once entries are locked ───────────── */
create or replace function public.enforce_checkin_stage()
returns trigger language plpgsql set search_path = public as $fn$
declare st text;
begin
  if new.check_in_status is distinct from old.check_in_status
     and new.check_in_status in ('CHECKED_IN','LATE','NO_SHOW') then
    select t.status into st
      from public.tournament_events ev
      join public.tournaments t on t.id = ev.tournament_id
     where ev.id = new.event_id;
    if st not in ('REGISTRATION_CLOSED','LIVE') then
      raise exception 'Check-in is not open yet — the tournament is still %.', lower(coalesce(st,'unknown'));
    end if;
  end if;
  return new;
end $fn$;
drop trigger if exists trg_enforce_checkin_stage on public.entries;
create trigger trg_enforce_checkin_stage before update on public.entries
for each row execute function public.enforce_checkin_stage();

/* ── 6. Finished results are not silently rewritable ────────────────────
   A scorer may score a live match. Once it is COMPLETED/WALKOVER the score
   becomes a published result, and changing it is a correction that belongs to
   the organizer/admin (the dispute flow) — not something a scorer device can
   do by reopening a screen. */
create or replace function public.enforce_completed_score_edit()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare m record;
begin
  select mm.status, ev.tournament_id into m
    from public.matches mm
    join public.tournament_events ev on ev.id = mm.event_id
   where mm.id = coalesce(new.match_id, old.match_id);
  if m.status in ('COMPLETED','WALKOVER')
     and not public.has_tournament_role(m.tournament_id, array['ORGANIZER','ADMIN']) then
    raise exception 'This match is already complete. Raise a dispute so an organizer can correct the score.';
  end if;
  return coalesce(new, old);
end $fn$;
drop trigger if exists trg_enforce_completed_score_edit on public.games;
create trigger trg_enforce_completed_score_edit
before insert or update or delete on public.games
for each row execute function public.enforce_completed_score_edit();

/* ── 7. A finished tournament does not quietly reopen ─────────────────── */
create or replace function public.enforce_tournament_status_flow()
returns trigger language plpgsql set search_path = public as $fn$
begin
  if old.status in ('COMPLETED','CANCELLED','ARCHIVED')
     and new.status not in ('COMPLETED','CANCELLED','ARCHIVED') then
    raise exception 'A % tournament cannot be moved back to %.', lower(old.status), lower(new.status);
  end if;
  return new;
end $fn$;
drop trigger if exists trg_enforce_tournament_status_flow on public.tournaments;
create trigger trg_enforce_tournament_status_flow before update on public.tournaments
for each row execute function public.enforce_tournament_status_flow();

/* ── 8. A played draw is not deletable ──────────────────────────────────
   generateDraw() clears existing matches before rebuilding. That is correct
   before anyone has played, and destructive afterwards — this makes the
   database refuse rather than relying on the UI to hide the button. */
create or replace function public.enforce_draw_immutable()
returns trigger language plpgsql set search_path = public as $fn$
begin
  -- Only block REGENERATING a draw, never deleting the tournament that owns
  -- it. A cascade (tournament -> events -> matches) removes the parent event
  -- row first, so its absence marks this as a teardown rather than a rebuild.
  if not exists (select 1 from public.tournament_events where id = old.event_id) then
    return old;
  end if;
  if exists (
    select 1 from public.matches m
    where m.event_id = old.event_id and m.status in ('LIVE','COMPLETED','WALKOVER')
  ) then
    raise exception 'This draw has matches already played and cannot be regenerated.';
  end if;
  return old;
end $fn$;
drop trigger if exists trg_enforce_draw_immutable on public.matches;
create trigger trg_enforce_draw_immutable before delete on public.matches
for each row execute function public.enforce_draw_immutable();

revoke execute on function public.enforce_checkin_stage() from public, anon, authenticated;
revoke execute on function public.enforce_completed_score_edit() from public, anon, authenticated;
revoke execute on function public.enforce_tournament_status_flow() from public, anon, authenticated;
revoke execute on function public.enforce_draw_immutable() from public, anon, authenticated;
