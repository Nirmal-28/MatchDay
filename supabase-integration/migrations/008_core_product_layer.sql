-- MatchDay — migration 008
-- Core product layer: player accounts, user-targeted notifications (with real
-- DB triggers rather than client-side fakes), staff invites + per-match
-- official assignment, tournament branding, and the RLS fixes those need.
--
-- HOW TO RUN: Supabase dashboard -> SQL Editor -> paste this whole file -> Run.
-- Safe to re-run (idempotent).

/* ═══════════════ 1. PLAYER ACCOUNTS ═══════════════════════════════════════

   `players` already existed as a phone-keyed identity created during
   registration. This links it to a real auth user so a player can sign in and
   own their profile, and adds the profile fields the dashboard needs.

   It also closes a real leak: `players` previously had
   `select ... using (true)` granted to anon, which exposed every registrant's
   phone number and email to anyone holding the publishable key. Direct table
   access is revoked here; anonymous registration now goes through the
   SECURITY DEFINER find_or_create_player() function, and public reads go
   through the existing name-only `public_players` view.                     */

alter table public.players add column if not exists user_id uuid unique references auth.users(id) on delete set null;
alter table public.players add column if not exists photo_url text;
alter table public.players add column if not exists date_of_birth date;
alter table public.players add column if not exists sports text[] not null default array['badminton'];
alter table public.players add column if not exists skill_level text;
alter table public.players add column if not exists bio text;
alter table public.players drop constraint if exists players_skill_level_check;
alter table public.players add constraint players_skill_level_check
  check (skill_level is null or skill_level in ('BEGINNER','INTERMEDIATE','ADVANCED','PRO'));

-- A player who signs up before ever entering a tournament has no phone yet.
alter table public.players alter column phone drop not null;
create index if not exists players_user_idx on public.players (user_id);

-- The current session's player row, if they have one. SECURITY DEFINER so it
-- can be used inside RLS policies on `players` itself without recursion.
create or replace function public.my_player_id()
returns uuid language sql security definer stable set search_path = public as $fn$
  select id from public.players where user_id = (select auth.uid()) limit 1;
$fn$;

-- Entries the current session's player competes in. Same reason for DEFINER:
-- it is referenced from the RLS policy on entry_players.
create or replace function public.my_entry_ids()
returns setof uuid language sql security definer stable set search_path = public as $fn$
  select ep.entry_id from public.entry_players ep where ep.player_id = public.my_player_id();
$fn$;

-- Registration path for anonymous visitors. Replaces the old
-- "anon can select/insert/update players directly" policies.
create or replace function public.find_or_create_player(p_name text, p_phone text, p_email text)
returns uuid language plpgsql security definer set search_path = public as $fn$
declare
  key text := nullif(right(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 10), '');
  rec public.players%rowtype;
  new_id uuid;
begin
  if key is null then return null; end if;
  select * into rec from public.players where phone = key limit 1;
  if found then
    -- Never overwrite a claimed profile from a third-party registration, and
    -- never blank out a value we already hold.
    if rec.user_id is null then
      update public.players
         set name  = coalesce(nullif(p_name, ''), name),
             email = coalesce(nullif(p_email, ''), email)
       where id = rec.id;
    end if;
    return rec.id;
  end if;
  insert into public.players (phone, name, email)
  values (key, coalesce(nullif(p_name, ''), 'Unknown'), nullif(p_email, ''))
  on conflict (phone) do update set name = public.players.name
  returning id into new_id;
  return new_id;
end $fn$;
grant execute on function public.find_or_create_player(text, text, text) to anon, authenticated;

-- Claim / create the signed-in user's own player row. Claiming an existing
-- row is allowed on a Supabase-verified email match, or on a phone match when
-- that row carries no conflicting email — a phone match alone is deliberately
-- not enough to take over a row that belongs to a different email address.
create or replace function public.link_my_player(p_phone text, p_name text)
returns uuid language plpgsql security definer set search_path = public as $fn$
declare
  uid uuid := (select auth.uid());
  em  text;
  key text := nullif(right(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 10), '');
  rec public.players%rowtype;
  new_id uuid;
begin
  if uid is null then raise exception 'Not signed in.'; end if;
  select email into em from auth.users where id = uid;

  select * into rec from public.players where user_id = uid limit 1;
  if found then return rec.id; end if;

  if em is not null then
    select * into rec from public.players
     where user_id is null and lower(email) = lower(em) limit 1;
  end if;
  if not found and key is not null then
    select * into rec from public.players
     where user_id is null and phone = key
       and (email is null or em is null or lower(email) = lower(em)) limit 1;
  end if;

  if found then
    update public.players
       set user_id = uid,
           name    = coalesce(nullif(p_name, ''), name),
           email   = coalesce(email, em),
           phone   = coalesce(phone, key)
     where id = rec.id;
    return rec.id;
  end if;

  insert into public.players (phone, name, email, user_id)
  values (key, coalesce(nullif(p_name, ''), split_part(coalesce(em, 'Player'), '@', 1)), em, uid)
  returning id into new_id;
  return new_id;
end $fn$;
grant execute on function public.link_my_player(text, text) to authenticated;

drop policy if exists "public_insert_players" on public.players;
drop policy if exists "select_players"       on public.players;
drop policy if exists "update_players"       on public.players;
drop policy if exists "owner_update_players" on public.players;
drop policy if exists "self_select_player"   on public.players;
drop policy if exists "self_update_player"   on public.players;

create policy "self_select_player" on public.players for select to authenticated
  using (user_id = (select auth.uid()));
create policy "self_update_player" on public.players for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on public.players from anon;
revoke insert, delete on public.players from authenticated;
grant select, update on public.players to authenticated;

-- Public projection gains the new display-safe fields. Still no phone/email.
create or replace view public.public_players as
  select id, name, city, club, gender, photo_url, skill_level, sports, bio
  from public.players;
revoke all on public.public_players from public;
grant select on public.public_players to anon, authenticated;
comment on view public.public_players is
  'Public projection of players. Intentionally omits phone/email/date_of_birth/user_id.';

-- A player can read the entries and co-entrants of teams they are part of.
drop policy if exists "player_select_own_entries" on public.entries;
create policy "player_select_own_entries" on public.entries for select to authenticated
  using (id in (select public.my_entry_ids()));
drop policy if exists "player_select_own_entry_players" on public.entry_players;
create policy "player_select_own_entry_players" on public.entry_players for select to authenticated
  using (entry_id in (select public.my_entry_ids()));


/* ═══════════════ 2. RBAC FIXES + STAFF INVITES + MATCH OFFICIALS ══════════

   tournament_members and has_tournament_role() existed, but nothing in the
   RLS on matches/games honoured them — a SCORER could open Scorer Mode and
   every write would silently fail, because the only UPDATE policy on matches
   was owner-only. Fixed here.                                              */

-- SECURITY DEFINER so tournament policies can call it without recursing back
-- into tournament_members' own policies.
create or replace function public.is_tournament_staff(t_id uuid)
returns boolean language sql security definer stable set search_path = public as $fn$
  select exists (
    select 1 from public.tournament_members
    where tournament_id = t_id and user_id = (select auth.uid())
  );
$fn$;

create or replace function public.has_tournament_role(t_id uuid, roles text[])
returns boolean language sql security definer stable set search_path = public as $fn$
  select exists (select 1 from public.tournaments where id = t_id and organizer_id = (select auth.uid()))
      or exists (
        select 1 from public.tournament_members
        where tournament_id = t_id and user_id = (select auth.uid()) and role = any(roles)
      );
$fn$;

-- Staff can see the tournament they are staffing even while it is a DRAFT.
drop policy if exists "staff_select_tournaments" on public.tournaments;
create policy "staff_select_tournaments" on public.tournaments for select to authenticated
  using (public.is_tournament_staff(id));

drop policy if exists "staff_select_events" on public.tournament_events;
create policy "staff_select_events" on public.tournament_events for select to authenticated
  using (public.is_tournament_staff(tournament_id));

drop policy if exists "staff_select_courts" on public.courts;
create policy "staff_select_courts" on public.courts for select to authenticated
  using (public.is_tournament_staff(tournament_id));

-- Per-match officials.
alter table public.matches add column if not exists scorer_id  uuid references auth.users(id) on delete set null;
alter table public.matches add column if not exists referee_id uuid references auth.users(id) on delete set null;
create index if not exists matches_scorer_idx  on public.matches (scorer_id);
create index if not exists matches_referee_idx on public.matches (referee_id);

-- Scoring staff may read and score matches. Deliberately narrower than the
-- organizer's policy: a scorer/referee gets matches + games only, never
-- tournament settings, participants' contact details, finance, or staff admin.
drop policy if exists "staff_select_matches" on public.matches;
create policy "staff_select_matches" on public.matches for select to authenticated
  using (public.can_score_match(id));
drop policy if exists "staff_update_matches" on public.matches;
create policy "staff_update_matches" on public.matches for update to authenticated
  using (public.can_score_match(id)) with check (public.can_score_match(id));

drop policy if exists "staff_select_games" on public.games;
create policy "staff_select_games" on public.games for select to authenticated
  using (public.can_score_match(match_id));
drop policy if exists "staff_insert_games" on public.games;
create policy "staff_insert_games" on public.games for insert to authenticated
  with check (public.can_score_match(match_id));
drop policy if exists "staff_update_games" on public.games;
create policy "staff_update_games" on public.games for update to authenticated
  using (public.can_score_match(match_id)) with check (public.can_score_match(match_id));
drop policy if exists "staff_delete_games" on public.games;
create policy "staff_delete_games" on public.games for delete to authenticated
  using (public.can_score_match(match_id));

-- Invite-by-email. Supabase's admin API (the only way to resolve an email to
-- a user id, or to send a real invitation mail) needs the service_role key and
-- must never run in the browser — so this is a pending-invite record the
-- invitee claims themselves the first time they sign in with that address.
-- Sending the actual email is the external step; see supabase-integration/README.md.
create table if not exists public.tournament_invites (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  email text not null,
  role text not null check (role in ('ORGANIZER','ADMIN','REFEREE','SCORER','VOLUNTEER')),
  status text not null default 'PENDING' check (status in ('PENDING','ACCEPTED','REVOKED')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null
);
create unique index if not exists tournament_invites_unique
  on public.tournament_invites (tournament_id, lower(email)) where status = 'PENDING';
create index if not exists tournament_invites_email_idx on public.tournament_invites (lower(email));

alter table public.tournament_invites enable row level security;
drop policy if exists "owner_manage_invites" on public.tournament_invites;
create policy "owner_manage_invites" on public.tournament_invites for all to authenticated
  using (public.is_tournament_owner(tournament_id))
  with check (public.is_tournament_owner(tournament_id));

create or replace function public.claim_my_invites()
returns int language plpgsql security definer set search_path = public as $fn$
declare
  uid uuid := (select auth.uid());
  em text;
  n int := 0;
begin
  if uid is null then return 0; end if;
  select email into em from auth.users where id = uid;
  if em is null then return 0; end if;

  insert into public.tournament_members (tournament_id, user_id, role, invited_email)
  select i.tournament_id, uid, i.role, i.email
    from public.tournament_invites i
   where i.status = 'PENDING' and lower(i.email) = lower(em)
  on conflict (tournament_id, user_id) do update set role = excluded.role;

  update public.tournament_invites
     set status = 'ACCEPTED', accepted_at = now(), accepted_by = uid
   where status = 'PENDING' and lower(email) = lower(em);
  get diagnostics n = row_count;
  return n;
end $fn$;
grant execute on function public.claim_my_invites() to authenticated;

-- Readable staff list: joins in a display name without exposing auth.users.
-- security_invoker so the underlying tournament_members RLS still applies.
drop view if exists public.tournament_staff;
create view public.tournament_staff with (security_invoker = on) as
  select tm.id, tm.tournament_id, tm.user_id, tm.role, tm.invited_email, tm.created_at,
         coalesce(nullif(p.name, ''), nullif(op.full_name, ''), tm.invited_email, 'Staff member') as display_name,
         p.photo_url
    from public.tournament_members tm
    left join public.players p on p.user_id = tm.user_id
    left join public.organizer_profiles op on op.id = tm.user_id;
grant select on public.tournament_staff to authenticated;


/* ═══════════════ 3. NOTIFICATIONS ════════════════════════════════════════

   The existing table was tournament-scoped and organizer-only. It gains a
   target user, richer metadata, and — most importantly — database triggers,
   so notifications are produced by the same writes that change the tournament
   rather than by whichever screen happened to be open.                     */

alter table public.notifications add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.notifications add column if not exists title text;
alter table public.notifications add column if not exists entry_id uuid references public.entries(id) on delete cascade;
alter table public.notifications add column if not exists match_id uuid references public.matches(id) on delete cascade;
alter table public.notifications add column if not exists link text;
create index if not exists notifications_user_idx on public.notifications (user_id, read, created_at desc);

drop policy if exists "owner_select_notifications" on public.notifications;
drop policy if exists "owner_insert_notifications" on public.notifications;
drop policy if exists "owner_update_notifications" on public.notifications;
drop policy if exists "owner_delete_notifications" on public.notifications;
drop policy if exists "select_own_notifications"   on public.notifications;
drop policy if exists "update_own_notifications"   on public.notifications;
drop policy if exists "insert_notifications"       on public.notifications;
drop policy if exists "delete_own_notifications"   on public.notifications;

-- user_id null means "tournament-level", visible to the organizer/admins.
create policy "select_own_notifications" on public.notifications for select to authenticated
  using (
    user_id = (select auth.uid())
    or (user_id is null and public.has_tournament_role(tournament_id, array['ORGANIZER','ADMIN']))
  );
create policy "update_own_notifications" on public.notifications for update to authenticated
  using (
    user_id = (select auth.uid())
    or (user_id is null and public.has_tournament_role(tournament_id, array['ORGANIZER','ADMIN']))
  )
  with check (
    user_id = (select auth.uid())
    or (user_id is null and public.has_tournament_role(tournament_id, array['ORGANIZER','ADMIN']))
  );
create policy "insert_notifications" on public.notifications for insert to authenticated
  with check (public.has_tournament_role(tournament_id, array['ORGANIZER','ADMIN']));
create policy "delete_own_notifications" on public.notifications for delete to authenticated
  using (user_id = (select auth.uid()) or public.is_tournament_owner(tournament_id));

-- ── Emitters ─────────────────────────────────────────────────────────────
create or replace function public.notify_users(
  p_user_ids uuid[], p_tournament_id uuid, p_type text, p_title text,
  p_message text, p_link text default null, p_entry_id uuid default null, p_match_id uuid default null
) returns void language sql security definer set search_path = public as $fn$
  insert into public.notifications (user_id, tournament_id, type, title, message, link, entry_id, match_id)
  select u, p_tournament_id, p_type, p_title, p_message, p_link, p_entry_id, p_match_id
  from unnest(p_user_ids) u where u is not null;
$fn$;

-- Signed-in users behind one entry (both partners of a doubles pair).
create or replace function public.entry_user_ids(p_entry_id uuid)
returns uuid[] language sql security definer stable set search_path = public as $fn$
  select coalesce(array_agg(distinct pl.user_id), '{}')
  from public.entry_players ep
  join public.players pl on pl.id = ep.player_id
  where ep.entry_id = p_entry_id and pl.user_id is not null;
$fn$;

create or replace function public.entry_tournament_id(p_entry_id uuid)
returns uuid language sql security definer stable set search_path = public as $fn$
  select ev.tournament_id from public.entries e
  join public.tournament_events ev on ev.id = e.event_id where e.id = p_entry_id;
$fn$;

-- Registration / payment / check-in / waitlist events.
create or replace function public.trg_notify_entry()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  t_id uuid := public.entry_tournament_id(new.id);
  users uuid[] := public.entry_user_ids(new.id);
  t_name text;
  link text := '/me';
begin
  if t_id is null or array_length(users, 1) is null then return new; end if;
  select name into t_name from public.tournaments where id = t_id;

  if new.reg_status is distinct from old.reg_status then
    if new.reg_status = 'CONFIRMED' then
      perform public.notify_users(users, t_id, 'REGISTRATION_CONFIRMED', 'Registration confirmed',
        'Your entry for ' || coalesce(t_name, 'the tournament') || ' is confirmed.', link, new.id);
    elsif new.reg_status = 'REJECTED' then
      perform public.notify_users(users, t_id, 'REGISTRATION_REJECTED', 'Registration rejected',
        'Your entry for ' || coalesce(t_name, 'the tournament') || ' was not accepted.', link, new.id);
    elsif new.reg_status = 'WAITLISTED' then
      perform public.notify_users(users, t_id, 'WAITLISTED', 'You are on the waitlist',
        'The category was full — you have been waitlisted for ' || coalesce(t_name, 'this tournament') || '.', link, new.id);
    elsif old.reg_status = 'WAITLISTED' and new.reg_status in ('PENDING','CONFIRMED') then
      perform public.notify_users(users, t_id, 'WAITLIST_PROMOTED', 'A spot opened up',
        'You have been promoted off the waitlist for ' || coalesce(t_name, 'this tournament') || '.', link, new.id);
    end if;
  end if;

  if new.payment_status is distinct from old.payment_status then
    perform public.notify_users(users, t_id, 'PAYMENT_' || new.payment_status, 'Payment ' || lower(new.payment_status),
      'Your entry fee for ' || coalesce(t_name, 'the tournament') || ' is now marked ' || lower(new.payment_status) || '.', link, new.id);
  end if;

  if new.check_in_status is distinct from old.check_in_status and new.check_in_status = 'CHECKED_IN' then
    perform public.notify_users(users, t_id, 'CHECKED_IN', 'Checked in',
      'You are checked in at ' || coalesce(t_name, 'the venue') || '. Good luck!', link, new.id);
  end if;

  return new;
end $fn$;
drop trigger if exists trg_notify_entry on public.entries;
create trigger trg_notify_entry after update on public.entries
for each row execute function public.trg_notify_entry();

-- Scheduling / court / status changes on a match.
create or replace function public.trg_notify_match()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  t_id uuid;
  users uuid[];
  link text := '/m/' || new.id::text;
  court_name text;
  when_text text;
begin
  select ev.tournament_id into t_id from public.tournament_events ev where ev.id = new.event_id;
  if t_id is null then return new; end if;
  users := public.entry_user_ids(new.entry_a) || public.entry_user_ids(new.entry_b);
  if array_length(users, 1) is null then return new; end if;

  court_name := coalesce(new.court, (select c.name from public.courts c where c.id = new.court_id), 'TBD');
  when_text := coalesce(to_char(new.scheduled_at at time zone 'Asia/Kolkata', 'DD Mon, HH12:MI AM'), 'a time to be confirmed');

  if old.scheduled_at is null and new.scheduled_at is not null then
    perform public.notify_users(users, t_id, 'MATCH_SCHEDULED', 'Match scheduled',
      'Your match is scheduled for ' || when_text || ' on ' || court_name || '.', link, null, new.id);
  elsif new.scheduled_at is distinct from old.scheduled_at and new.scheduled_at is not null then
    perform public.notify_users(users, t_id, 'MATCH_TIME_CHANGED', 'Match time changed',
      'Your match has moved to ' || when_text || ' on ' || court_name || '.', link, null, new.id);
  end if;

  if new.court_id is distinct from old.court_id and old.court_id is not null then
    perform public.notify_users(users, t_id, 'COURT_CHANGED', 'Court changed',
      'Your match has moved to ' || court_name || '.', link, null, new.id);
  end if;

  if (new.entry_a is distinct from old.entry_a and old.entry_a is not null)
     or (new.entry_b is distinct from old.entry_b and old.entry_b is not null) then
    perform public.notify_users(users, t_id, 'OPPONENT_CHANGED', 'Opponent changed',
      'The line-up for your match has changed.', link, null, new.id);
  end if;

  if new.status is distinct from old.status then
    if new.status = 'LIVE' then
      perform public.notify_users(users, t_id, 'MATCH_STARTED', 'Match started',
        'Your match on ' || court_name || ' has started.', link, null, new.id);
    elsif new.status in ('COMPLETED','WALKOVER') then
      perform public.notify_users(users, t_id, 'MATCH_COMPLETED', 'Match completed',
        'Your match result has been published.', link, null, new.id);
    elsif new.status = 'READY' then
      perform public.notify_users(users, t_id, 'MATCH_APPROACHING', 'Report to court',
        'Your match on ' || court_name || ' is ready to start — please report to court.', link, null, new.id);
    end if;
  end if;

  return new;
end $fn$;
drop trigger if exists trg_notify_match on public.matches;
create trigger trg_notify_match after update on public.matches
for each row execute function public.trg_notify_match();

-- Tournament completed → everyone with an entry in it.
create or replace function public.trg_notify_tournament()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare users uuid[];
begin
  if new.status is distinct from old.status and new.status = 'COMPLETED' then
    select coalesce(array_agg(distinct pl.user_id), '{}') into users
      from public.entry_players ep
      join public.players pl on pl.id = ep.player_id
      join public.entries e on e.id = ep.entry_id
      join public.tournament_events ev on ev.id = e.event_id
     where ev.tournament_id = new.id and pl.user_id is not null;
    perform public.notify_users(users, new.id, 'TOURNAMENT_COMPLETED', 'Tournament completed',
      new.name || ' has finished. Final results are published.',
      case when new.slug is null then null else '/t/' || new.slug end);
  end if;
  return new;
end $fn$;
drop trigger if exists trg_notify_tournament on public.tournaments;
create trigger trg_notify_tournament after update on public.tournaments
for each row execute function public.trg_notify_tournament();

-- Dispute resolved → the person who raised it.
create or replace function public.trg_notify_dispute()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if new.status is distinct from old.status and new.status in ('RESOLVED','REJECTED') and new.raised_by is not null then
    perform public.notify_users(array[new.raised_by], new.tournament_id, 'DISPUTE_' || new.status,
      'Dispute ' || lower(new.status),
      coalesce(nullif(new.resolution_note, ''), 'Your reported issue has been ' || lower(new.status) || '.'),
      '/m/' || new.match_id::text, null, new.match_id);
  end if;
  return new;
end $fn$;
drop trigger if exists trg_notify_dispute on public.match_disputes;
create trigger trg_notify_dispute after update on public.match_disputes
for each row execute function public.trg_notify_dispute();


/* ═══════════════ 4. TOURNAMENT BRANDING ══════════════════════════════════ */

alter table public.tournaments add column if not exists logo_url text;
alter table public.tournaments add column if not exists cover_image_url text;
alter table public.tournaments add column if not exists accent_color text;
alter table public.tournaments add column if not exists sponsors jsonb not null default '[]'::jsonb;
alter table public.tournaments add column if not exists announcement text;
alter table public.tournaments drop constraint if exists tournaments_accent_color_check;
-- Hex only, so an organizer's value can never inject CSS into the public page.
alter table public.tournaments add constraint tournaments_accent_color_check
  check (accent_color is null or accent_color ~ '^#[0-9a-fA-F]{6}$');


/* ═══════════════ 5. STORAGE (profile photos, logos, sponsor art) ═════════ */

insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('tournament-media', 'tournament-media', true)
  on conflict (id) do nothing;

drop policy if exists "avatars_public_read"   on storage.objects;
drop policy if exists "avatars_own_write"     on storage.objects;
drop policy if exists "avatars_own_update"    on storage.objects;
drop policy if exists "avatars_own_delete"    on storage.objects;
drop policy if exists "tmedia_public_read"    on storage.objects;
drop policy if exists "tmedia_own_write"      on storage.objects;
drop policy if exists "tmedia_own_update"     on storage.objects;
drop policy if exists "tmedia_own_delete"     on storage.objects;

create policy "avatars_public_read" on storage.objects for select to anon, authenticated
  using (bucket_id = 'avatars');
create policy "avatars_own_write" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatars_own_update" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatars_own_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Tournament media lives under <tournament_id>/… and is writable by that
-- tournament's owner only.
create policy "tmedia_public_read" on storage.objects for select to anon, authenticated
  using (bucket_id = 'tournament-media');
create policy "tmedia_own_write" on storage.objects for insert to authenticated
  with check (bucket_id = 'tournament-media'
    and public.is_tournament_owner(nullif((storage.foldername(name))[1], '')::uuid));
create policy "tmedia_own_update" on storage.objects for update to authenticated
  using (bucket_id = 'tournament-media'
    and public.is_tournament_owner(nullif((storage.foldername(name))[1], '')::uuid));
create policy "tmedia_own_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'tournament-media'
    and public.is_tournament_owner(nullif((storage.foldername(name))[1], '')::uuid));


/* ═══════════════ 6. FUNCTION PERMISSIONS ═════════════════════════════════

   Postgres grants EXECUTE on new functions to PUBLIC by default, and Supabase
   exposes every public-schema function over PostgREST as /rest/v1/rpc/<name>.
   Left alone that would mean anyone holding the publishable key could call
   notify_users() to write a notification into any user's inbox, or
   entry_user_ids() to enumerate auth user ids from an entry id. Both are
   internal helpers, only ever called from inside the SECURITY DEFINER trigger
   functions (which run as the function owner), so revoking costs nothing.

   Trigger functions do not need EXECUTE granted to the writing role -- the
   privilege is checked at CREATE TRIGGER time, not on each fire -- so they are
   revoked too, which takes them off the RPC surface. Verified against the live
   database: registration, payment and check-in notifications all still fire
   for a normal authenticated write after these revokes.                     */

revoke execute on function public.notify_users(uuid[], uuid, text, text, text, text, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.entry_user_ids(uuid) from public, anon, authenticated;
revoke execute on function public.entry_tournament_id(uuid) from public, anon, authenticated;
revoke execute on function public.trg_notify_entry() from public, anon, authenticated;
revoke execute on function public.trg_notify_match() from public, anon, authenticated;
revoke execute on function public.trg_notify_tournament() from public, anon, authenticated;
revoke execute on function public.trg_notify_dispute() from public, anon, authenticated;
revoke execute on function public.link_my_player(text, text) from public, anon;

-- These four appear inside RLS policy expressions, which Postgres evaluates as
-- the CALLING role. `authenticated` must therefore keep EXECUTE or every policy
-- that uses them fails closed (the player dashboard returns nothing, staff lose
-- access to tournaments they are on). Safe to expose: each only reports facts
-- about the caller. Note that `revoke ... from public` also strips the grant
-- authenticated inherits through PUBLIC, so it has to be granted back
-- explicitly -- revoking without this line is a silent outage.
revoke execute on function public.my_player_id() from public, anon;
revoke execute on function public.my_entry_ids() from public, anon;
revoke execute on function public.is_tournament_staff(uuid) from public, anon;
revoke execute on function public.has_tournament_role(uuid, text[]) from public, anon;
grant execute on function public.my_player_id() to authenticated;
grant execute on function public.my_entry_ids() to authenticated;
grant execute on function public.is_tournament_staff(uuid) to authenticated;
grant execute on function public.has_tournament_role(uuid, text[]) to authenticated;


/* ═══════════════ 7. REALTIME ═════════════════════════════════════════════ */
do $blk$
declare t text;
begin
  foreach t in array array['tournament_invites'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $blk$;
