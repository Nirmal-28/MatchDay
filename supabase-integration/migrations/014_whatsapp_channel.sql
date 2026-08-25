/* 014 — WhatsApp as a notification channel.
 *
 * Adds the per-user opt-in that `notify-dispatch` reads. The dispatch code
 * already degrades safely without this column (`prefs?.whatsapp ?? false`
 * is false when the column does not exist), so applying this migration is
 * what makes the channel *available*, not what makes the function safe.
 *
 * Default OFF, matching SMS and unlike email. Two reasons, and they are not
 * stylistic:
 *
 *   1. Outside a 24-hour window opened by the user messaging you first,
 *      WhatsApp permits only pre-approved template messages. Tournament
 *      notices are always outside that window.
 *   2. Template messages to people who did not ask for them are the fastest
 *      way to get a WhatsApp Business sender rate-limited and then banned.
 *      The quality rating is per-number and recovering it is slow.
 *
 * Nothing sends until WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID and
 * WHATSAPP_TEMPLATE_NAME are set as function secrets; until then the channel
 * reports `skipped`, never `failed`, and never claims to have sent.
 *
 * See supabase-integration/GOING-LIVE.md §4 for the account setup.
 */

alter table public.notification_preferences
  add column if not exists whatsapp boolean not null default false;

comment on column public.notification_preferences.whatsapp is
  'Opt-in for WhatsApp template messages. Default false: WhatsApp only permits '
  'pre-approved templates outside a user-initiated 24h window, and unsolicited '
  'templates damage the sender number''s quality rating.';
