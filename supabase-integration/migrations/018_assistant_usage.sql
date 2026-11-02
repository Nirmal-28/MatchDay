/* ══════════════════════════════════════════════════════════════════════════
   018 — A daily limit on the organizer chat box
   ══════════════════════════════════════════════════════════════════════════

   api/assistant.js calls Claude, and every call costs money. Signing up is
   free, so the limit has to hold against someone scripting the endpoint, and
   a serverless function keeps no memory between requests. It lives here.

   claim_assistant_request() runs as the signed-in caller, so the same call
   answers "is this a real user?" (anon has no EXECUTE, and a bad token never
   reaches it) and "are they under the limit?".

   The limit is a constant in the function, not a parameter: the function is
   reachable from any browser, so a parameter would let the caller pick their
   own limit.

   Depends on: schema.sql (auth.users). Safe to re-run.
   ══════════════════════════════════════════════════════════════════════════ */

create table if not exists public.assistant_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null default current_date,
  requests int not null default 0,
  primary key (user_id, day)
);

-- RLS on with no policies: only the SECURITY DEFINER function below touches it.
alter table public.assistant_usage enable row level security;

create or replace function public.claim_assistant_request()
returns boolean language plpgsql security definer set search_path = public as $fn$
declare
  daily_limit constant int := 40;
  uid uuid := auth.uid();
  used int;
begin
  if uid is null then
    raise exception 'Sign in to use the assistant.';
  end if;

  insert into public.assistant_usage as u (user_id, day, requests)
  values (uid, current_date, 1)
  on conflict (user_id, day) do update set requests = u.requests + 1
    where u.requests < daily_limit
  returning requests into used;

  return used is not null;
end $fn$;

revoke execute on function public.claim_assistant_request() from public, anon;
grant execute on function public.claim_assistant_request() to authenticated;
