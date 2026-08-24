import { useCallback, useEffect, useState } from "react";
import { UserPlus, Shield, Trash2, Mail, Info, Gavel, ClipboardList } from "lucide-react";
import { cx, divisionLabel, matchStageLabel, entryShort, fmtDateTime } from "../lib/engines";
import {
  listStaff, listInvites, inviteStaff, revokeInvite, updateMemberRole, removeMember, assignMatchOfficials,
} from "../lib/repository";
import { Badge, Btn, Card, Field, inputCls } from "../components/ui/primitives";

// Roles, most privileged first. OWNER is not in this list because it isn't a
// tournament_members role — it's tournaments.organizer_id, exactly one person,
// and it cannot be granted or revoked from here.
export const STAFF_ROLES = [
  // ORGANIZER and ADMIN carry identical RLS grants — both can run matches,
  // check-in and disputes, but neither can touch Courts, Staff, Finance,
  // Branding or Settings, which stay owner-only. The hint used to promise
  // "full access... except ownership", which stopped being true once those
  // tabs were correctly gated to OWNER (audit finding F4).
  { key: "ORGANIZER", label: "Organizer", hint: "Runs match day — participants, draws, schedule, check-in and disputes. Courts, staff, finance and settings stay owner-only." },
  { key: "ADMIN", label: "Admin", hint: "Manage participants, draws, schedule, check-in and disputes." },
  { key: "REFEREE", label: "Referee", hint: "See assigned matches and officiate. Can score and raise disputes." },
  { key: "SCORER", label: "Scorer", hint: "Score assigned matches in Scorer Mode. No tournament settings." },
  { key: "VOLUNTEER", label: "Volunteer", hint: "Check participants in at the desk. Nothing else." },
];
const ROLE_TONE = { ORGANIZER: "teal", ADMIN: "indigo", REFEREE: "amber", SCORER: "emerald", VOLUNTEER: "slate" };

function RoleSelect({ value, onChange, disabled }) {
  return (
    <select className={cx(inputCls, "sm:w-auto py-1 text-xs")} value={value} disabled={disabled}
      onChange={(e) => onChange(e.target.value)}>
      {STAFF_ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
    </select>
  );
}

export default function StaffPanel({ tournament, events, matches, entriesById, isOwner, notify, onChanged }) {
  const [staff, setStaff] = useState([]);
  const [invites, setInvites] = useState([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("SCORER");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [s, i] = await Promise.all([listStaff(tournament.id), isOwner ? listInvites(tournament.id) : Promise.resolve([])]);
    setStaff(s);
    setInvites(i);
  }, [tournament.id, isOwner]);

  useEffect(() => { load(); }, [load]);

  const guard = async (fn, ok) => {
    setBusy(true);
    try { await fn(); await load(); if (ok) notify(ok); }
    catch (e) { notify(e.message, "error"); }
    finally { setBusy(false); }
  };

  const submitInvite = (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    guard(async () => { await inviteStaff(tournament.id, email, role); setEmail(""); }, "Invite recorded.");
  };

  // Only officiating roles can be put on a match.
  const assignable = staff.filter((s) => ["ORGANIZER", "ADMIN", "REFEREE", "SCORER"].includes(s.role));
  const officiable = matches
    .filter((m) => !m.is_bye && !["COMPLETED", "WALKOVER"].includes(m.status))
    .sort((a, b) => (a.scheduled_at || "~").localeCompare(b.scheduled_at || "~"))
    .slice(0, 40);
  const eventById = Object.fromEntries(events.map((e) => [e.id, e]));

  return (
    <div className="space-y-5">
      {/* Current staff */}
      <div>
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-2">
          <Shield size={13} /> Tournament staff
        </h3>
        <Card className="divide-y divide-line-soft">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div>
              <div className="text-sm font-semibold text-ink">{tournament.organizer_name || "You"}</div>
              <div className="text-[11px] text-ink-3">Created this tournament</div>
            </div>
            <Badge tone="teal">Owner</Badge>
          </div>
          {staff.length === 0 ? (
            <div className="px-4 py-5 text-center text-sm text-ink-3">
              No other staff yet. Invite a scorer or referee below.
            </div>
          ) : staff.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                {s.photo_url
                  ? <img src={s.photo_url} alt="" className="h-8 w-8 rounded-lg object-cover" />
                  : <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-3 text-xs font-bold text-ink-2">
                      {(s.display_name || "?").slice(0, 2).toUpperCase()}
                    </div>}
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-ink">{s.display_name}</div>
                  {s.invited_email && <div className="truncate text-[11px] text-ink-3">{s.invited_email}</div>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {isOwner ? (
                  <>
                    <RoleSelect value={s.role} disabled={busy}
                      onChange={(r) => guard(() => updateMemberRole(s.id, r), "Role updated.")} />
                    <button className="rounded p-1.5 text-ink-3 hover:bg-surface-2 hover:text-red-400"
                      onClick={() => confirm(`Remove ${s.display_name} from this tournament?`) && guard(() => removeMember(s.id), "Staff removed.")}
                      aria-label="Remove staff member">
                      <Trash2 size={14} />
                    </button>
                  </>
                ) : <Badge tone={ROLE_TONE[s.role] || "slate"}>{s.role}</Badge>}
              </div>
            </div>
          ))}
        </Card>
        <div className="mt-2 grid gap-1 text-[11px] text-ink-3 sm:grid-cols-2">
          {STAFF_ROLES.map((r) => (
            <div key={r.key}><span className="font-medium text-ink-2">{r.label}</span> — {r.hint}</div>
          ))}
        </div>
      </div>

      {/* Invites */}
      {isOwner && (
        <div>
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-2">
            <UserPlus size={13} /> Invite staff
          </h3>
          <Card className="p-4">
            <form className="flex flex-wrap items-end gap-2" onSubmit={submitInvite}>
              <div className="min-w-[14rem] flex-1">
                <Field label="Email address">
                  <input type="email" required className={inputCls} placeholder="scorer@example.com"
                    value={email} onChange={(e) => setEmail(e.target.value)} />
                </Field>
              </div>
              <Field label="Role">
                <select className={inputCls} value={role} onChange={(e) => setRole(e.target.value)}>
                  {STAFF_ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                </select>
              </Field>
              <Btn size="sm" type="submit" disabled={busy} icon={Mail}>Record invite</Btn>
            </form>

            {/* The honest version of "invite by email". */}
            <div className="mt-3 flex gap-2 rounded-md border border-line bg-surface-2 px-3 py-2.5 text-[11px] leading-relaxed text-ink-2">
              <Info size={13} className="mt-px shrink-0 text-ink-3" />
              <span>
                MatchDay does not send the invitation email itself — resolving an address to an account and
                sending mail both need Supabase&apos;s admin API with the service-role key, which must never run in a
                browser. The invite is stored here and becomes a real staff role automatically the first time that
                person signs in with this address. Send them the sign-in link yourself in the meantime.
              </span>
            </div>

            {invites.filter((i) => i.status === "PENDING").length > 0 && (
              <div className="mt-3 space-y-1.5">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">Pending invites</div>
                {invites.filter((i) => i.status === "PENDING").map((i) => (
                  <div key={i.id} className="flex items-center justify-between gap-2 rounded-md border border-line px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm text-ink">{i.email}</div>
                      <div className="text-[11px] text-ink-3">Invited as {i.role}</div>
                    </div>
                    <Btn size="sm" variant="ghost" onClick={() => guard(() => revokeInvite(i.id), "Invite revoked.")}>Revoke</Btn>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Match assignment */}
      <div>
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-2">
          <ClipboardList size={13} /> Match assignments
        </h3>
        {assignable.length === 0 ? (
          <Card className="px-4 py-6 text-center text-sm text-ink-3">
            Add a referee or scorer above before assigning matches.
          </Card>
        ) : officiable.length === 0 ? (
          <Card className="px-4 py-6 text-center text-sm text-ink-3">
            No matches waiting to be played. Generate a draw first.
          </Card>
        ) : (
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-2 text-[11px] uppercase tracking-wide text-ink-2">
                <tr>
                  <th className="px-3 py-2 font-medium">Match</th>
                  <th className="px-3 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium"><span className="flex items-center gap-1"><Gavel size={11} /> Referee</span></th>
                  <th className="px-3 py-2 font-medium"><span className="flex items-center gap-1"><ClipboardList size={11} /> Scorer</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {officiable.map((m) => {
                  const ev = eventById[m.event_id];
                  return (
                    <tr key={m.id}>
                      <td className="px-3 py-2">
                        <div className="text-ink">{entryShort(entriesById[m.entry_a])} <span className="text-ink-3">vs</span> {entryShort(entriesById[m.entry_b])}</div>
                        <div className="text-[11px] text-ink-3">{divisionLabel(ev)} · {matchStageLabel(m, ev)}</div>
                      </td>
                      <td className="px-3 py-2 text-xs text-ink-2">
                        {m.scheduled_at ? fmtDateTime(m.scheduled_at) : "TBD"}
                        <div className="text-[11px] text-ink-3">{m.court || "Court TBD"}</div>
                      </td>
                      {["referee_id", "scorer_id"].map((field) => (
                        <td key={field} className="px-3 py-2">
                          <select
                            className={cx(inputCls, "sm:w-auto min-w-[9rem] py-1 text-xs")}
                            value={m[field] || ""}
                            disabled={busy}
                            onChange={(e) => guard(() => assignMatchOfficials(m.id, { [field]: e.target.value || null }), "Assignment saved.").then(onChanged)}
                          >
                            <option value="">Unassigned</option>
                            {assignable
                              .filter((s) => field === "scorer_id"
                                ? ["SCORER", "REFEREE", "ADMIN", "ORGANIZER"].includes(s.role)
                                : ["REFEREE", "ADMIN", "ORGANIZER"].includes(s.role))
                              .map((s) => <option key={s.user_id} value={s.user_id}>{s.display_name}</option>)}
                          </select>
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-[11px] text-ink-3">
          Assigned officials appear on the match detail page and are highlighted for that person in Scorer Mode.
          Scoring permission comes from the role, not the assignment — any scorer can still cover a court in an emergency.
        </p>
      </div>
    </div>
  );
}
