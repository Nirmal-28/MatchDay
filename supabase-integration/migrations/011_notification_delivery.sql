/* ===========================================================================
   MatchDay — migration 011: notification delivery

   NOT YET APPLIED (Supabase MCP was down when this was written). Apply with
   `supabase db push` or the SQL editor. Idempotent, safe to re-run.

   Migration 008 made in-app notifications real: triggers write a
   `notifications` row on the same statement that changes a tournament. What
   was missing is everything needed to deliver that row anywhere ELSE — which
   matters because a player who is not looking at the app never learns their
   match was called.

   This adds the storage that supabase-integration/edge-functions/
   notify-dispatch needs:
     - what each person wants to be contacted through
     - which devices have granted push permission
     - what actually happened to each notification

   Delivery still requires provider secrets (Resend / MSG91 / VAPID). Until
   those are set, the dispatcher records every channel as "skipped" — nothing
   claims to have sent anything.
   =========================================================================== */

/* ---------------------------------------------------------------------------
   1. PER-USER PREFERENCES

   Absence of a row means the defaults below, so nobody has to be migrated
   into a preference they never expressed. In-app is not listed because it is
   not optional — it is the notification itself, not a delivery of it.
   ------------------------------------------------------------------------ */

create table if not exists public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email boolean not null default true,   -- on: a missed match is worth an email
  sms boolean not null default false,    -- off: costs money and DLT templates
  push boolean not null default false,   -- off until a device grants permission
  updated_at timestamptz not null default now()
);

alter table public.notification_preferences enable row level security;

drop policy if exists notif_prefs_select_own on public.notification_preferences;
create policy notif_prefs_select_own on public.notification_preferences
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists notif_prefs_upsert_own on public.notification_preferences;
create policy notif_prefs_upsert_own on public.notification_preferences
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists notif_prefs_update_own on public.notification_preferences;
create policy notif_prefs_update_own on public.notification_preferences
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update on public.notification_preferences to authenticated;

/* ---------------------------------------------------------------------------
   2. PUSH SUBSCRIPTIONS

   One row per browser/device that has granted permission. The endpoint is
   issued by the browser vendor's push service and is what the server posts to;
   p256dh and auth are the keys the payload is encrypted with.

   A user may only ever see or touch their own. Nothing here is public: an
   endpoint is a capability — anyone holding it can push to that device.
   ------------------------------------------------------------------------ */

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists push_subs_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists push_subs_select_own on public.push_subscriptions;
create policy push_subs_select_own on public.push_subscriptions
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists push_subs_insert_own on public.push_subscriptions;
create policy push_subs_insert_own on public.push_subscriptions
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists push_subs_update_own on public.push_subscriptions;
create policy push_subs_update_own on public.push_subscriptions
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists push_subs_delete_own on public.push_subscriptions;
create policy push_subs_delete_own on public.push_subscriptions
  for delete to authenticated using (user_id = (select auth.uid()));

grant select, insert, update, delete on public.push_subscriptions to authenticated;

/* ---------------------------------------------------------------------------
   3. DELIVERY RECORD

   `delivery` holds the per-channel outcome the dispatcher returns, e.g.
   [{"channel":"email","status":"sent"},{"channel":"sms","status":"skipped",
     "detail":"MSG91_AUTH_KEY not set"}]

   This is the difference between "we notified them" and "we believe we
   notified them". Without it there is no way to answer a player who says they
   were never told their match moved.
   ------------------------------------------------------------------------ */

alter table public.notifications add column if not exists delivery jsonb;
alter table public.notifications add column if not exists dispatched_at timestamptz;

/* ---------------------------------------------------------------------------
   4. THE TRIGGER THAT CALLS THE DISPATCHER

   Commented out on purpose — it cannot work until the Edge Function is
   deployed, and a trigger that fails would roll back the tournament change
   that produced the notification. Uncomment and fill in the project ref after
   `supabase functions deploy notify-dispatch`.

   Note the pg_net call is fire-and-forget: it queues an HTTP request and
   returns immediately, so a slow or failing provider can never block or undo
   the database write that triggered it.

     create extension if not exists pg_net;

     -- The key lives in database settings, not in a table and never in a client:
     --   alter database postgres set app.service_role_key = '<SERVICE_ROLE_KEY>';

     create or replace function public.trg_dispatch_notification()
     returns trigger language plpgsql security definer set search_path = public as $fn$
     begin
       perform net.http_post(
         url     := 'https://dkkpolnuywgvmlacjzto.supabase.co/functions/v1/notify-dispatch',
         headers := jsonb_build_object(
           'Content-Type', 'application/json',
           'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
         ),
         body    := jsonb_build_object('notification_id', new.id)
       );
       return new;
     end $fn$;

     drop trigger if exists trg_notify_dispatch on public.notifications;
     create trigger trg_notify_dispatch
       after insert on public.notifications
       for each row execute function public.trg_dispatch_notification();
   ------------------------------------------------------------------------ */
