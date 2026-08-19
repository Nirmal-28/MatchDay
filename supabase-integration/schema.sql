-- Courtside — consolidated schema reference.
-- This mirrors what has already been applied to the live project
-- (dkkpolnuywgvmlacjzto) via 6 migrations. You don't need to run this —
-- it's here so the schema is readable/versionable outside the dashboard.
-- If you ever need to rebuild from scratch on a fresh project, this file
-- is safe to run top to bottom.

create extension if not exists pgcrypto;

-- ── Core tables ─────────────────────────────────────────────────────────

create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  organizer_name text,
  venue text,
  location text,
  start_date date,
  end_date date,
  registration_deadline date,
  contact_email text,
  contact_phone text,
  slug text unique,
  status text not null default 'DRAFT'
    check (status in ('DRAFT','REGISTRATION_OPEN','REGISTRATION_CLOSED','LIVE','COMPLETED','CANCELLED')),
  settings jsonb not null default '{}'::jsonb, -- { matchDurationMins, startTime, rules }
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.courts (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  name text not null,
  status text not null default 'AVAILABLE' check (status in ('AVAILABLE','UNAVAILABLE')),
  created_at timestamptz not null default now()
);

create table public.tournament_events (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  category text not null check (category in ('MS','WS','MD','WD','XD')),
  format text not null default 'SINGLE_ELIM' check (format in ('SINGLE_ELIM')),
  max_entries int not null default 16,
  fee_inr numeric(10,2) not null default 0,
  status text not null default 'DRAFT'
    check (status in ('DRAFT','REGISTRATION_OPEN','REGISTRATION_CLOSED','DRAW_READY','SCHEDULED','LIVE','COMPLETED')),
  total_rounds int,
  champion_entry_id uuid,
  created_at timestamptz not null default now(),
  unique (tournament_id, category)
);

create table public.entries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.tournament_events(id) on delete cascade,
  type text not null check (type in ('SINGLES','DOUBLES')),
  reg_status text not null default 'PENDING' check (reg_status in ('PENDING','CONFIRMED','REJECTED','CANCELLED')),
  payment_status text not null default 'UNPAID' check (payment_status in ('UNPAID','PENDING','PAID','FAILED','REFUNDED')),
  fee_inr numeric(10,2) not null default 0,
  seed int,
  created_at timestamptz not null default now()
);

create table public.entry_players (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.entries(id) on delete cascade,
  name text not null,
  phone text,
  email text
);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.tournament_events(id) on delete cascade,
  round int not null,
  match_number int not null,
  entry_a uuid references public.entries(id) on delete set null,
  entry_b uuid references public.entries(id) on delete set null,
  is_bye boolean not null default false,
  status text not null default 'PENDING' check (status in ('PENDING','SCHEDULED','READY','LIVE','COMPLETED','WALKOVER')),
  court text,
  scheduled_at timestamptz,
  winner_entry_id uuid references public.entries(id) on delete set null,
  next_match_id uuid references public.matches(id) on delete set null,
  next_slot text check (next_slot in ('A','B')),
  retired boolean not null default false,
  started_at timestamptz,
  completed_at timestamptz
);

create table public.games (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  game_number int not null,
  score_a int not null default 0,
  score_b int not null default 0,
  unique (match_id, game_number)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  type text not null default 'info',
  message text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.organizer_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  created_at timestamptz not null default now()
);

-- ── Indexes ─────────────────────────────────────────────────────────────
create index on public.courts (tournament_id);
create index on public.tournament_events (tournament_id);
create index on public.entries (event_id);
create index on public.entry_players (entry_id);
create index on public.matches (event_id);
create index on public.matches (next_match_id);
create index on public.matches (entry_a);
create index on public.matches (entry_b);
create index on public.matches (winner_entry_id);
create index on public.games (match_id);
create index on public.notifications (tournament_id);
create index on public.tournaments (organizer_id);
-- NOTE: no separate index on tournaments.slug — the UNIQUE constraint already provides one.

-- ── updated_at trigger ──────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
create trigger trg_tournaments_updated_at
before update on public.tournaments
for each row execute function public.set_updated_at();

-- ── Capacity enforcement (race-safe) ────────────────────────────────────
create or replace function public.enforce_event_capacity()
returns trigger language plpgsql set search_path = public as $$
declare
  active_count int;
  max_allowed int;
begin
  select count(*) into active_count from public.entries
  where event_id = new.event_id and reg_status not in ('REJECTED','CANCELLED');
  select max_entries into max_allowed from public.tournament_events where id = new.event_id;
  if max_allowed is not null and active_count >= max_allowed then
    raise exception 'This category is full.';
  end if;
  return new;
end;
$$;
create trigger trg_enforce_event_capacity
before insert on public.entries
for each row execute function public.enforce_event_capacity();

-- ── Auto-create organizer profile on signup ─────────────────────────────
create or replace function public.handle_new_organizer()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.organizer_profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_organizer();
revoke execute on function public.handle_new_organizer() from public, anon, authenticated;

-- ── Ownership / visibility helper functions (SECURITY INVOKER — they rely ──
-- on the RLS already present on tournaments/tournament_events, so they see
-- exactly what the calling role is allowed to see; no privilege escalation).
create or replace function public.is_tournament_owner(t_id uuid)
returns boolean language sql security invoker set search_path = public stable as $$
  select exists (select 1 from public.tournaments where id = t_id and organizer_id = (select auth.uid()));
$$;
create or replace function public.tournament_is_published(t_id uuid)
returns boolean language sql security invoker set search_path = public stable as $$
  select exists (select 1 from public.tournaments where id = t_id and status <> 'DRAFT');
$$;
create or replace function public.is_event_owner(e_id uuid)
returns boolean language sql security invoker set search_path = public stable as $$
  select exists (
    select 1 from public.tournament_events ev join public.tournaments t on t.id = ev.tournament_id
    where ev.id = e_id and t.organizer_id = (select auth.uid())
  );
$$;
create or replace function public.event_is_published(e_id uuid)
returns boolean language sql security invoker set search_path = public stable as $$
  select exists (
    select 1 from public.tournament_events ev join public.tournaments t on t.id = ev.tournament_id
    where ev.id = e_id and t.status <> 'DRAFT'
  );
$$;
create or replace function public.is_match_owner(m_id uuid)
returns boolean language sql security invoker set search_path = public stable as $$
  select exists (
    select 1 from public.matches m
    join public.tournament_events ev on ev.id = m.event_id
    join public.tournaments t on t.id = ev.tournament_id
    where m.id = m_id and t.organizer_id = (select auth.uid())
  );
$$;
create or replace function public.match_is_published(m_id uuid)
returns boolean language sql security invoker set search_path = public stable as $$
  select exists (
    select 1 from public.matches m
    join public.tournament_events ev on ev.id = m.event_id
    join public.tournaments t on t.id = ev.tournament_id
    where m.id = m_id and t.status <> 'DRAFT'
  );
$$;
create or replace function public.is_entry_owner(en_id uuid)
returns boolean language sql security invoker set search_path = public stable as $$
  select exists (
    select 1 from public.entries e
    join public.tournament_events ev on ev.id = e.event_id
    join public.tournaments t on t.id = ev.tournament_id
    where e.id = en_id and t.organizer_id = (select auth.uid())
  );
$$;
create or replace function public.entry_is_published(en_id uuid)
returns boolean language sql security invoker set search_path = public stable as $$
  select exists (
    select 1 from public.entries e
    join public.tournament_events ev on ev.id = e.event_id
    join public.tournaments t on t.id = ev.tournament_id
    where e.id = en_id and t.status <> 'DRAFT'
  );
$$;

-- ── RLS ──────────────────────────────────────────────────────────────────
alter table public.tournaments enable row level security;
create policy "select_tournaments" on public.tournaments for select to anon, authenticated
  using (status <> 'DRAFT' or organizer_id = (select auth.uid()));
create policy "owner_insert_tournaments" on public.tournaments for insert to authenticated
  with check (organizer_id = (select auth.uid()));
create policy "owner_update_tournaments" on public.tournaments for update to authenticated
  using (organizer_id = (select auth.uid())) with check (organizer_id = (select auth.uid()));
create policy "owner_delete_tournaments" on public.tournaments for delete to authenticated
  using (organizer_id = (select auth.uid()));

alter table public.courts enable row level security;
create policy "select_courts" on public.courts for select to anon, authenticated
  using (public.tournament_is_published(tournament_id) or public.is_tournament_owner(tournament_id));
create policy "owner_insert_courts" on public.courts for insert to authenticated with check (public.is_tournament_owner(tournament_id));
create policy "owner_update_courts" on public.courts for update to authenticated using (public.is_tournament_owner(tournament_id)) with check (public.is_tournament_owner(tournament_id));
create policy "owner_delete_courts" on public.courts for delete to authenticated using (public.is_tournament_owner(tournament_id));

alter table public.tournament_events enable row level security;
create policy "select_events" on public.tournament_events for select to anon, authenticated
  using (public.tournament_is_published(tournament_id) or public.is_tournament_owner(tournament_id));
create policy "owner_insert_events" on public.tournament_events for insert to authenticated with check (public.is_tournament_owner(tournament_id));
create policy "owner_update_events" on public.tournament_events for update to authenticated using (public.is_tournament_owner(tournament_id)) with check (public.is_tournament_owner(tournament_id));
create policy "owner_delete_events" on public.tournament_events for delete to authenticated using (public.is_tournament_owner(tournament_id));

alter table public.entries enable row level security;
create policy "select_entries" on public.entries for select to anon, authenticated
  using (public.event_is_published(event_id) or public.is_event_owner(event_id));
create policy "public_register_entries" on public.entries for insert to anon, authenticated with check (
  exists (select 1 from public.tournament_events ev join public.tournaments t on t.id = ev.tournament_id
          where ev.id = event_id and ev.status = 'REGISTRATION_OPEN' and t.status = 'REGISTRATION_OPEN')
);
create policy "owner_update_entries" on public.entries for update to authenticated using (public.is_event_owner(event_id)) with check (public.is_event_owner(event_id));
create policy "owner_delete_entries" on public.entries for delete to authenticated using (public.is_event_owner(event_id));

alter table public.entry_players enable row level security;
create policy "owner_select_entry_players" on public.entry_players for select to authenticated using (public.is_entry_owner(entry_id));
create policy "public_insert_entry_players" on public.entry_players for insert to anon, authenticated with check (
  exists (select 1 from public.entries e join public.tournament_events ev on ev.id = e.event_id join public.tournaments t on t.id = ev.tournament_id
          where e.id = entry_id and ev.status = 'REGISTRATION_OPEN' and t.status = 'REGISTRATION_OPEN')
);
create policy "owner_update_entry_players" on public.entry_players for update to authenticated using (public.is_entry_owner(entry_id)) with check (public.is_entry_owner(entry_id));
create policy "owner_delete_entry_players" on public.entry_players for delete to authenticated using (public.is_entry_owner(entry_id));

create view public.public_entry_names as
  select ep.id, ep.entry_id, ep.name
  from public.entry_players ep join public.entries e on e.id = ep.entry_id
  where public.entry_is_published(e.id);
revoke all on public.public_entry_names from public;
grant select on public.public_entry_names to anon, authenticated;
comment on view public.public_entry_names is
  'Read-only, name-only projection of entry_players for published tournaments. Intentionally omits phone/email.';

alter table public.matches enable row level security;
create policy "select_matches" on public.matches for select to anon, authenticated
  using (public.event_is_published(event_id) or public.is_event_owner(event_id));
create policy "owner_insert_matches" on public.matches for insert to authenticated with check (public.is_event_owner(event_id));
create policy "owner_update_matches" on public.matches for update to authenticated using (public.is_event_owner(event_id)) with check (public.is_event_owner(event_id));
create policy "owner_delete_matches" on public.matches for delete to authenticated using (public.is_event_owner(event_id));

alter table public.games enable row level security;
create policy "select_games" on public.games for select to anon, authenticated
  using (public.match_is_published(match_id) or public.is_match_owner(match_id));
create policy "owner_insert_games" on public.games for insert to authenticated with check (public.is_match_owner(match_id));
create policy "owner_update_games" on public.games for update to authenticated using (public.is_match_owner(match_id)) with check (public.is_match_owner(match_id));
create policy "owner_delete_games" on public.games for delete to authenticated using (public.is_match_owner(match_id));

alter table public.notifications enable row level security;
create policy "owner_select_notifications" on public.notifications for select to authenticated using (public.is_tournament_owner(tournament_id));
create policy "owner_insert_notifications" on public.notifications for insert to authenticated with check (public.is_tournament_owner(tournament_id));
create policy "owner_update_notifications" on public.notifications for update to authenticated using (public.is_tournament_owner(tournament_id)) with check (public.is_tournament_owner(tournament_id));
create policy "owner_delete_notifications" on public.notifications for delete to authenticated using (public.is_tournament_owner(tournament_id));

alter table public.organizer_profiles enable row level security;
create policy "self_manage_profile" on public.organizer_profiles for all to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- ── Realtime ────────────────────────────────────────────────────────────
alter publication supabase_realtime add table
  public.tournaments, public.tournament_events, public.matches,
  public.games, public.entries, public.courts, public.notifications;
