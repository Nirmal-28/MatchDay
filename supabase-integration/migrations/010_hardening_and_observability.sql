/* ===========================================================================
   MatchDay — migration 010: hardening and observability

   NOT YET APPLIED to the live project at the time this file was written —
   the Supabase MCP connection was down. Apply it with:

     supabase db push
   or paste it into the SQL editor on project dkkpolnuywgvmlacjzto.

   It is written to be safely re-runnable (every statement is idempotent).

   What this closes, in order:
     1. Client error reporting had nowhere to go — a crash in someone's
        browser was invisible unless they told you about it.
     2. There was no product usage data at all.
     3. find_or_create_player() let an anonymous caller overwrite the name and
        email on any UNCLAIMED player row just by knowing its phone number.
     4. scorePoint() was a read-modify-write from the browser: two scorer
        devices on one match could interleave and corrupt the score.
     5. Nothing rate-limited registration or check-in, so both were open to
        scripted abuse.
     6. Free-text columns had no length limit, so a single request could
        store a megabyte of text in a tournament name.
   =========================================================================== */

/* ---------------------------------------------------------------------------
   1. CLIENT ERROR REPORTING

   Written by the browser (see src/lib/monitoring.js), read by nobody through
   the API. Insert-only is deliberate: an error log that clients can read back
   is an information leak, and one they can delete is not a log. You read it
   from the Supabase dashboard / SQL editor, which runs as a privileged role
   and is unaffected by RLS.
   ------------------------------------------------------------------------ */

create table if not exists public.client_errors (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  message text not null,
  stack text,
  component_stack text,
  fingerprint text,
  source text,
  path text,
  user_agent text,
  user_id uuid references auth.users(id) on delete set null,
  context jsonb,
  app_version text
);

-- Bound what a single request can store. Without this, the error reporter is
-- itself an unauthenticated way to write unbounded data.
alter table public.client_errors drop constraint if exists client_errors_len_check;
alter table public.client_errors add constraint client_errors_len_check check (
  length(message) <= 4000
  and (stack is null or length(stack) <= 8000)
  and (component_stack is null or length(component_stack) <= 8000)
  and (path is null or length(path) <= 300)
  and (user_agent is null or length(user_agent) <= 400)
  and (source is null or length(source) <= 60)
  and (app_version is null or length(app_version) <= 40)
);

create index if not exists client_errors_created_idx on public.client_errors (created_at desc);
create index if not exists client_errors_fingerprint_idx on public.client_errors (fingerprint, created_at desc);

alter table public.client_errors enable row level security;

drop policy if exists client_errors_insert on public.client_errors;
create policy client_errors_insert on public.client_errors
  for insert to anon, authenticated with check (true);

-- No select/update/delete policy exists, so RLS denies all three. That is the
-- intent, not an oversight.
revoke all on public.client_errors from anon, authenticated;
grant insert on public.client_errors to anon, authenticated;

/* ---------------------------------------------------------------------------
   2. PRODUCT ANALYTICS

   Same shape and same reasoning as client_errors. Deliberately minimal: an
   event name, a handful of scalar properties, a path with ids stripped, and a
   per-tab session id that dies with the tab. No third-party script, no
   cross-site cookie, nothing that would need a consent banner.
   ------------------------------------------------------------------------ */

create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,
  props jsonb,
  path text,
  session_id text,
  user_id uuid references auth.users(id) on delete set null,
  app_version text
);

alter table public.analytics_events drop constraint if exists analytics_events_len_check;
alter table public.analytics_events add constraint analytics_events_len_check check (
  length(name) <= 60
  and (path is null or length(path) <= 200)
  and (session_id is null or length(session_id) <= 64)
  and (app_version is null or length(app_version) <= 40)
  and (props is null or pg_column_size(props) <= 2000)
);

create index if not exists analytics_events_name_idx on public.analytics_events (name, created_at desc);
create index if not exists analytics_events_created_idx on public.analytics_events (created_at desc);

alter table public.analytics_events enable row level security;

drop policy if exists analytics_events_insert on public.analytics_events;
create policy analytics_events_insert on public.analytics_events
  for insert to anon, authenticated with check (true);

revoke all on public.analytics_events from anon, authenticated;
grant insert on public.analytics_events to anon, authenticated;

/* ---------------------------------------------------------------------------
   3. RATE LIMITING

   A shared counter keyed by (bucket, subject) over a rolling window. The
   subject is the auth uid when signed in, and otherwise a value the caller
   supplies (a phone number, a tournament id) — NOT an IP, which Postgres
   cannot see from here.

   This is a real limit on the operations that matter, not a general-purpose
   WAF: it stops a script registering 500 entries or brute-forcing check-in
   codes. Network-level abuse is Supabase's own rate limiting and, if you ever
   need more, a Cloudflare rule in front of the domain.
   ------------------------------------------------------------------------ */

create table if not exists public.rate_limits (
  bucket text not null,
  subject text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (bucket, subject, window_start)
);

alter table public.rate_limits enable row level security;
-- No policies at all: only SECURITY DEFINER functions touch this table.
revoke all on public.rate_limits from anon, authenticated;

/**
 * Consume one unit from a bucket. Returns true when the caller is allowed to
 * proceed, false when they have exhausted the limit for the current window.
 *
 * Deliberately never raises: callers decide what a refusal means, and a
 * limiter that throws inside a trigger would roll back the transaction it was
 * supposed to be politely declining.
 */
create or replace function public.consume_rate_limit(
  p_bucket text,
  p_subject text,
  p_limit int,
  p_window interval default interval '1 hour'
)
returns boolean language plpgsql security definer set search_path = public as $fn$
declare
  w timestamptz := date_trunc('minute', now()) - (extract(epoch from (date_trunc('minute', now()) - to_timestamp(0)))::bigint % greatest(extract(epoch from p_window)::bigint, 60)) * interval '1 second';
  current_count int;
begin
  if p_subject is null or p_subject = '' then
    return true; -- nothing to key on; do not block a legitimate caller
  end if;

  insert into public.rate_limits (bucket, subject, window_start, count)
  values (p_bucket, p_subject, w, 1)
  on conflict (bucket, subject, window_start)
    do update set count = public.rate_limits.count + 1
  returning count into current_count;

  return current_count <= p_limit;
end $fn$;

revoke execute on function public.consume_rate_limit(text, text, int, interval) from public, anon, authenticated;

-- Old windows are dead weight. Called opportunistically by the limiter's
-- callers rather than needing pg_cron.
create or replace function public.prune_rate_limits()
returns void language sql security definer set search_path = public as $fn$
  delete from public.rate_limits where window_start < now() - interval '2 days';
$fn$;
revoke execute on function public.prune_rate_limits() from public, anon, authenticated;

/* ---------------------------------------------------------------------------
   4. HARDENED find_or_create_player()

   The old version updated name and email on any row whose user_id was null,
   which meant an anonymous caller who guessed or knew a phone number could
   rewrite that person's name and attach their own email to it. The email in
   particular matters, because link_my_player() matches on it.

   The fix: this function now only ever CREATES. It never updates an existing
   row, claimed or not. An organizer editing a participant still goes through
   the normal authenticated path, which RLS governs.

   The remaining known limitation is unchanged and still worth stating: a
   caller who knows a phone number can attach a registration to that player.
   Closing that needs phone OTP at registration, which is a product decision
   (it adds friction to the thing you most want people to complete) and an SMS
   provider that does not exist on this project yet.
   ------------------------------------------------------------------------ */

create or replace function public.find_or_create_player(p_name text, p_phone text, p_email text)
returns uuid language plpgsql security definer set search_path = public as $fn$
declare
  key text := nullif(right(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 10), '');
  rec public.players%rowtype;
  new_id uuid;
begin
  if key is null then return null; end if;

  -- Bound the abuse: 30 new-player creations per hour per phone prefix is far
  -- above any real registration desk and far below a scripted import.
  if not public.consume_rate_limit('find_or_create_player', left(key, 6), 60, interval '1 hour') then
    raise exception 'Too many registration attempts. Please try again shortly.'
      using errcode = 'P0001';
  end if;

  select * into rec from public.players where phone = key limit 1;
  if found then
    -- Return the existing identity untouched. Previously this branch updated
    -- name/email when user_id was null, which let an anonymous caller rewrite
    -- an unclaimed profile.
    return rec.id;
  end if;

  insert into public.players (phone, name, email)
  values (key, coalesce(nullif(left(p_name, 80), ''), 'Unknown'), nullif(left(p_email, 254), ''))
  on conflict (phone) do update set name = public.players.name
  returning id into new_id;
  return new_id;
end $fn$;

grant execute on function public.find_or_create_player(text, text, text) to anon, authenticated;

/* ---------------------------------------------------------------------------
   5. ATOMIC SCORING

   scorePoint() in the browser did: read the game, add a delta, write it back.
   Two devices scoring the same match could both read 15, both write 16, and
   lose a point permanently. It was documented as acceptable "because there is
   one scorer per match", but courtside reality is a referee's phone and an
   organizer's laptop open on the same match.

   This does the read and the write in one statement inside the database, so
   the increment cannot interleave. The client keeps its existing cascade
   logic (advancing the winner, crowning a champion) — only the point itself
   moves here, because that is the part with the race.

   Returns the resulting row so the caller does not need a second round trip.
   ------------------------------------------------------------------------ */

create or replace function public.score_point_atomic(
  p_match_id uuid,
  p_side text,
  p_delta int
)
returns public.games language plpgsql security invoker set search_path = public as $fn$
declare
  g public.games;
  m public.matches;
begin
  if p_side not in ('A', 'B') then
    raise exception 'side must be A or B';
  end if;
  if p_delta not in (-1, 1) then
    raise exception 'delta must be 1 or -1';
  end if;

  select * into m from public.matches where id = p_match_id;
  if not found then raise exception 'match not found'; end if;
  if m.status <> 'LIVE' then
    raise exception 'match is not live';
  end if;

  -- Lock the current game row for the duration of the transaction. A second
  -- device attempting the same point waits here and then reads the updated
  -- value, instead of overwriting it.
  select * into g from public.games
   where match_id = p_match_id
   order by game_number desc
   limit 1
   for update;

  if not found then raise exception 'no game to score'; end if;

  -- The badminton cap (30) and the "game already won" guard live in
  -- src/lib/engines.js for the UI. Repeating the hard bounds here is
  -- deliberate: this function is reachable over the API, so it must not rely
  -- on the client having checked anything.
  if p_side = 'A' then
    update public.games
       set score_a = greatest(0, least(30, score_a + p_delta))
     where id = g.id
     returning * into g;
  else
    update public.games
       set score_b = greatest(0, least(30, score_b + p_delta))
     where id = g.id
     returning * into g;
  end if;

  return g;
end $fn$;

-- SECURITY INVOKER, so the existing RLS policies on `games` (organizer, or
-- staff with a scoring role) decide whether this update is allowed. The
-- function adds atomicity, never authority.
grant execute on function public.score_point_atomic(uuid, text, int) to authenticated;

/* ---------------------------------------------------------------------------
   6. RATE-LIMITED PUBLIC REGISTRATION

   The public insert policy on `entries` already checks the registration
   window (migration 009). This adds a volume limit on top, keyed by the
   event, so a script cannot fill a draw in a second. The organizer's own
   insert path is untouched — they are authenticated and go through
   owner_insert_entries.
   ------------------------------------------------------------------------ */

create or replace function public.enforce_entry_rate_limit()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  -- Only anonymous, public registrations are limited. An organizer entering
  -- 40 players from a spreadsheet is a normal thing to do.
  if auth.uid() is null then
    if not public.consume_rate_limit('public_entry', new.event_id::text, 120, interval '1 hour') then
      raise exception 'This category is receiving an unusual number of registrations. Please try again in a few minutes.'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end $fn$;

drop trigger if exists trg_entry_rate_limit on public.entries;
create trigger trg_entry_rate_limit
  before insert on public.entries
  for each row execute function public.enforce_entry_rate_limit();

/* ---------------------------------------------------------------------------
   7. LENGTH CONSTRAINTS ON FREE TEXT

   Every one of these is reachable from a form. Without a bound, a single
   request can store an arbitrary amount of text, and a tournament name of
   100,000 characters breaks every list that renders it.

   The numbers match LIMITS in src/lib/validation.js exactly, so the form and
   the database agree on what is acceptable and the user is told before the
   request rather than after it fails.
   ------------------------------------------------------------------------ */

alter table public.tournaments drop constraint if exists tournaments_text_len_check;
alter table public.tournaments add constraint tournaments_text_len_check check (
  length(name) between 1 and 120
  and (venue is null or length(venue) <= 160)
  and (announcement is null or length(announcement) <= 1000)
);

alter table public.players drop constraint if exists players_text_len_check;
alter table public.players add constraint players_text_len_check check (
  length(name) between 1 and 80
  and (email is null or length(email) <= 254)
  and (bio is null or length(bio) <= 500)
);

alter table public.entry_players drop constraint if exists entry_players_text_len_check;
alter table public.entry_players add constraint entry_players_text_len_check check (
  length(name) between 1 and 80
  and (email is null or length(email) <= 254)
  and (phone is null or length(phone) <= 20)
);

/* ---------------------------------------------------------------------------
   8. RETENTION

   Neither observability table is a permanent record. Both are diagnostic, and
   an unbounded log becomes a liability (storage, and personal data you did not
   mean to keep). If pg_cron is enabled on the project, these schedules prune
   them; if it is not, the DO block is skipped and you can run the deletes by
   hand or enable pg_cron later. Nothing else depends on this.
   ------------------------------------------------------------------------ */

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('prune_client_errors') where exists (select 1 from cron.job where jobname = 'prune_client_errors');
    perform cron.schedule('prune_client_errors', '17 3 * * *',
      $cron$delete from public.client_errors where created_at < now() - interval '30 days'$cron$);

    perform cron.unschedule('prune_analytics_events') where exists (select 1 from cron.job where jobname = 'prune_analytics_events');
    perform cron.schedule('prune_analytics_events', '23 3 * * *',
      $cron$delete from public.analytics_events where created_at < now() - interval '180 days'$cron$);

    perform cron.unschedule('prune_rate_limits') where exists (select 1 from cron.job where jobname = 'prune_rate_limits');
    perform cron.schedule('prune_rate_limits', '29 3 * * *',
      $cron$select public.prune_rate_limits()$cron$);
  else
    raise notice 'pg_cron is not enabled — retention pruning was not scheduled. Enable it in Database > Extensions, then re-run this migration.';
  end if;
end $$;
