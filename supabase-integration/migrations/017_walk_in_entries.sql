/* ══════════════════════════════════════════════════════════════════════════
   017 — Walk-in entries: the organizer adds players directly
   ══════════════════════════════════════════════════════════════════════════

   Small club tournaments don't use a registration form. Players text the
   organizer on WhatsApp and turn up; the organizer needs to put those names
   into the draw. Two things stood in the way:

     1. entry_players had only the PUBLIC insert policy (registration open).
        005 gave owners owner_insert_entries "regardless of registration
        status", but not the matching entry_players policy — so once
        registration closed, "Add participant" / CSV import inserted the entry
        and then failed on its names, leaving a nameless entry in the draw.

     2. Organizer-added entries came in as PENDING and had to be approved one
        by one before the draw (which takes CONFIRMED only). The walk-in path
        (addWalkInEntries in repository.js) inserts CONFIRMED directly. For
        that to be an OWNER privilege, the public path must not be able to do
        the same — and today it can: public_register_entries checks only the
        registration window, so anyone holding the publishable key could
        insert an entry already CONFIRMED and PAID, at fee 0. Section 2 closes
        that: a non-owner insert always lands PENDING / UNPAID at the
        category's real fee.

   Depends on: schema.sql (is_entry_owner, is_event_owner), 005 (waitlist,
   check-in columns). Safe to re-run.
   ══════════════════════════════════════════════════════════════════════════ */

/* ── 1. Owners can add names to their own entries at any stage ──────────── */
drop policy if exists "owner_insert_entry_players" on public.entry_players;
create policy "owner_insert_entry_players" on public.entry_players for insert to authenticated
  with check (public.is_entry_owner(entry_id));

/* ── 2. Non-owner inserts can't choose their own status, payment or fee ─── */
-- BEFORE INSERT triggers fire in name order. This one must run before
-- trg_enforce_event_capacity, so that capacity's WAITLISTED decision is the
-- one that sticks ('0' sorts before 'e').
create or replace function public.sanitize_public_entry_insert()
returns trigger language plpgsql set search_path = public as $fn$
begin
  if not public.is_event_owner(new.event_id) then
    new.reg_status        := 'PENDING';
    new.payment_status    := 'UNPAID';
    new.waitlist_position := null;
    new.seed              := null;
    new.check_in_status   := 'NOT_CHECKED_IN';
    new.checked_in_at     := null;
    new.fee_inr := coalesce((select fee_inr from public.tournament_events where id = new.event_id), 0);
  end if;
  return new;
end $fn$;

drop trigger if exists trg_0_sanitize_public_entry_insert on public.entries;
create trigger trg_0_sanitize_public_entry_insert
  before insert on public.entries
  for each row execute function public.sanitize_public_entry_insert();
