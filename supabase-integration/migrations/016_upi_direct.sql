/* ══════════════════════════════════════════════════════════════════════════
   016 — UPI Direct: players pay the organizer from any UPI app
   ══════════════════════════════════════════════════════════════════════════

   How Indian club tournaments already collect fees: "send ₹500 to my GPay,
   post the screenshot in the group". It costs nothing (UPI to a person or a
   small merchant has no MDR), needs no gateway KYC, and every player knows
   it. Its two failures are what this fixes:

     1. The organizer cannot tell which transfer is whose. -> every entry gets
        a reference (MD + 6 chars of the entry id) that goes in the UPI note.
     2. A screenshot proves nothing; fake "Payment Successful" screens are a
        common scam. -> the player submits the 12-digit UTR, and only the
        ORGANIZER, after seeing the credit in their own bank/UPI app, marks
        the entry paid. Nothing here can set PAID.

   Pieces:
     - tournaments.upi_id / upi_payee_name — where to pay. Public by nature:
       it is shown to everyone who registers, exactly like a QR at the desk.
     - payment_claims — "I paid, here is my UTR". Organizer-only reads,
       because entries are anon-readable and a UTR is payment information.
     - claim_upi_payment(entry, utr) — the ONLY write path for players.
       SECURITY DEFINER so an anonymous registrant can use it, narrowly
       validated, and it can move an entry to PENDING at most.

   The organizer's verify / reject goes through ordinary RLS-checked writes
   (see reviewUpiClaim in repository.js): verifying reuses the existing
   offline-payment path that 005 already restricts to the entry's owner.

   Depends on: schema.sql (is_entry_owner). Safe to re-run.
   ══════════════════════════════════════════════════════════════════════════ */

alter table public.tournaments add column if not exists upi_id text;
alter table public.tournaments add column if not exists upi_payee_name text;

alter table public.tournaments drop constraint if exists tournaments_upi_id_check;
alter table public.tournaments add constraint tournaments_upi_id_check
  check (upi_id is null or upi_id ~ '^[a-zA-Z0-9._-]{2,255}@[a-zA-Z][a-zA-Z0-9]{1,63}$');
alter table public.tournaments drop constraint if exists tournaments_upi_payee_len_check;
alter table public.tournaments add constraint tournaments_upi_payee_len_check
  check (upi_payee_name is null or char_length(upi_payee_name) <= 60);

create table if not exists public.payment_claims (
  id          uuid primary key default gen_random_uuid(),
  entry_id    uuid not null references public.entries(id) on delete cascade,
  utr         text not null check (utr ~ '^[0-9]{12}$'),
  amount_inr  numeric(10,2) not null check (amount_inr >= 0),
  reference   text not null check (char_length(reference) <= 16),
  status      text not null default 'CLAIMED' check (status in ('CLAIMED', 'VERIFIED', 'REJECTED')),
  created_at  timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null
);

-- One open claim per entry: re-submitting (a typo in the UTR) replaces it.
create unique index if not exists payment_claims_one_open
  on public.payment_claims (entry_id) where status = 'CLAIMED';
create index if not exists payment_claims_utr_idx on public.payment_claims (utr);

alter table public.payment_claims enable row level security;

-- Only the entry's organizer sees claims, and only they can review them.
-- No insert policy: the RPC below is the single way in.
drop policy if exists "owner_select_payment_claims" on public.payment_claims;
create policy "owner_select_payment_claims" on public.payment_claims for select to authenticated
  using (public.is_entry_owner(entry_id));
drop policy if exists "owner_update_payment_claims" on public.payment_claims;
create policy "owner_update_payment_claims" on public.payment_claims for update to authenticated
  using (public.is_entry_owner(entry_id)) with check (public.is_entry_owner(entry_id));

create or replace function public.claim_upi_payment(p_entry_id uuid, p_utr text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_utr text := regexp_replace(coalesce(p_utr, ''), '\D', '', 'g');
  e public.entries;
  t public.tournaments;
  v_ref text;
begin
  if v_utr !~ '^[0-9]{12}$' then
    raise exception 'A UPI reference (UTR) is 12 digits — check the payment details in your UPI app.' using errcode = 'P0001';
  end if;

  select * into e from public.entries where id = p_entry_id;
  if not found then raise exception 'Entry not found.' using errcode = 'P0001'; end if;

  select t2.* into t from public.tournaments t2
    join public.tournament_events ev on ev.tournament_id = t2.id
   where ev.id = e.event_id;

  if t.upi_id is null then
    raise exception 'This tournament does not take UPI payments through MatchDay.' using errcode = 'P0001';
  end if;
  if t.status in ('DRAFT', 'CANCELLED', 'ARCHIVED') then
    raise exception 'This tournament is not taking payments.' using errcode = 'P0001';
  end if;
  if e.reg_status in ('REJECTED', 'CANCELLED') then
    raise exception 'This entry is no longer active.' using errcode = 'P0001';
  end if;
  if coalesce(e.fee_inr, 0) <= 0 then
    raise exception 'This entry has no fee to pay.' using errcode = 'P0001';
  end if;
  if e.payment_status in ('PAID', 'REFUNDED') then
    raise exception 'This entry is already settled.' using errcode = 'P0001';
  end if;

  v_ref := 'MD' || upper(substr(replace(e.id::text, '-', ''), 1, 6));

  -- Replace an open claim for this entry rather than stacking duplicates.
  update public.payment_claims
     set utr = v_utr, amount_inr = e.fee_inr, created_at = now()
   where entry_id = e.id and status = 'CLAIMED';
  if not found then
    insert into public.payment_claims (entry_id, utr, amount_inr, reference)
    values (e.id, v_utr, e.fee_inr, v_ref);
  end if;

  -- PENDING at most. PAID is the organizer's call, never the payer's.
  update public.entries set payment_status = 'PENDING'
   where id = e.id and payment_status in ('UNPAID', 'FAILED');

  return jsonb_build_object('status', 'CLAIMED', 'reference', v_ref);
end $fn$;

revoke execute on function public.claim_upi_payment(uuid, text) from public;
grant execute on function public.claim_upi_payment(uuid, text) to anon, authenticated;

comment on table public.payment_claims is
  'UPI Direct (migration 016): a player''s "I paid, here is my UTR". Organizer-only. A claim never marks an entry PAID — the organizer verifies against their own bank app.';
