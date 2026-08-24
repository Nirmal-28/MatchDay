import { useState } from "react";
import { Link } from "react-router-dom";
import { Search, UserPlus, Check, X, CreditCard, Trash2, Users, Upload, ArrowUpCircle } from "lucide-react";
import { cx, fmtDate, entryName, REG_STATUS_META, PAY_STATUS_META, CHECK_IN_META } from "../lib/engines";
import { normaliseFields } from "../lib/registrationFields";
import { Badge, Btn, EmptyState, inputCls } from "./ui/primitives";
import RegistrationModal from "./RegistrationModal";
import CsvImportModal from "./CsvImportModal";

/* Answers to the organizer's configured registration questions, shown to
   staff only (RLS on entry_details enforces that, not this component). Nothing
   renders when a tournament asks no extra questions, which is the common case. */
function EntryAnswers({ fields, answers }) {
  const shown = normaliseFields(fields).filter((f) => {
    const v = answers?.[f.key];
    return f.type === "checkbox" ? v === true : String(v ?? "").trim();
  });
  if (!shown.length) return null;

  return (
    <dl className="mt-2 grid gap-x-4 gap-y-1 border-t border-line-soft pt-2 text-[11px] sm:grid-cols-2">
      {shown.map((f) => (
        <div key={f.key} className="flex justify-between gap-2">
          <dt className="text-ink-3">{f.label}</dt>
          <dd className="truncate text-right font-medium text-ink-2">
            {f.type === "checkbox" ? "Yes" : String(answers[f.key])}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default function ParticipantsPanel({ event, entries, registrationFields = [], entryDetails = {}, isOwner = true, onApprove, onReject, onRemove, onRecordPayment, onRefund, onAddManual, onImport, onPromoteWaitlist, onToggleAutoPromote }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const waitlisted = entries.filter((e) => e.reg_status === "WAITLISTED").sort((a, b) => (a.waitlist_position || 0) - (b.waitlist_position || 0));
  const filtered = entries.filter((e) => {
    if (e.reg_status === "WAITLISTED") return false; // shown in its own section below
    if (filter !== "ALL" && e.reg_status !== filter) return false;
    if (q && !entryName(e).toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  const canEdit = event.status === "REGISTRATION_OPEN" || event.status === "REGISTRATION_CLOSED";

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
          <input className={cx(inputCls, "pl-8")} placeholder="Search participants" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {/* sm:w-auto, not a bare w-auto — see AuditLogPanel.jsx for why. */}
        <select className={cx(inputCls, "sm:w-auto")} value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="ALL">All statuses</option>
          {Object.keys(REG_STATUS_META).filter((s) => s !== "WAITLISTED").map((s) => <option key={s} value={s}>{REG_STATUS_META[s].label}</option>)}
        </select>
        {/* Adding an entry directly (as opposed to a player registering
            themselves) goes through owner_insert_entries in RLS, which has
            no staff equivalent — a non-owner ORGANIZER's "Add participant" or
            CSV import would be refused outright. Hidden rather than shown as
            a control that fails after they've filled in a form (same
            reasoning as audit finding F4). */}
        {isOwner && onImport && <Btn size="sm" variant="secondary" icon={Upload} onClick={() => setImportOpen(true)}>Import CSV</Btn>}
        {isOwner && <Btn size="sm" variant="secondary" icon={UserPlus} onClick={() => setAddOpen(true)}>Add participant</Btn>}
      </div>

      {waitlisted.length > 0 && (
        <div className="mb-4 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wide text-amber-400">Waitlist ({waitlisted.length})</div>
            <div className="flex items-center gap-3">
              {/* tournament_events UPDATE is owner_update_events only — a
                  staff toggle here would flip visually and revert on
                  reload, since the write matches 0 rows. */}
              {onToggleAutoPromote && isOwner && (
                <label className="flex items-center gap-1.5 text-xs text-ink-2">
                  <input type="checkbox" checked={!!event.auto_promote_waitlist} onChange={(e) => onToggleAutoPromote(e.target.checked)} className="accent-teal-500" />
                  Auto-promote on cancellation
                </label>
              )}
              {onPromoteWaitlist && canEdit && (
                <Btn size="sm" variant="subtle" icon={ArrowUpCircle} onClick={onPromoteWaitlist}>Promote next</Btn>
              )}
            </div>
          </div>
          <div className="space-y-1">
            {waitlisted.map((e) => (
              <div key={e.id} className="flex items-center justify-between text-sm">
                <span className="text-ink">#{e.waitlist_position} — {entryName(e)}</span>
                <span className="text-xs text-ink-3">{fmtDate(e.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState icon={Users} title="Your tournament is waiting for its first competitor" hint="Registrations for this category will appear here." />
      ) : (
        <>
        {/* Mobile: one card per entry. An organizer works the registration
            desk on a phone, so the three statuses and the actions have to be
            readable and tappable without pinching a table sideways. */}
        <div className="space-y-2 sm:hidden">
          {filtered.map((e) => (
            <div key={e.id} className="rounded-lg border border-line bg-surface p-3.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 font-semibold text-ink">
                  {(e.entry_players || []).map((p, i) => (
                    <span key={p.id ?? i}>
                      {i > 0 && <span className="text-ink-3"> / </span>}
                      {p.player_id
                        ? <Link to={`/p/${p.player_id}`} className="hover:text-accent-teal">{p.name}</Link>
                        : p.name}
                    </span>
                  ))}
                  {(e.entry_players || []).length === 0 && entryName(e)}
                </div>
                <span className="shrink-0 text-[11px] text-ink-3">{fmtDate(e.created_at)}</span>
              </div>

              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge tone={REG_STATUS_META[e.reg_status].tone}>{REG_STATUS_META[e.reg_status].label}</Badge>
                <Badge tone={PAY_STATUS_META[e.payment_status].tone}>{PAY_STATUS_META[e.payment_status].label}</Badge>
                <Badge tone={CHECK_IN_META[e.check_in_status || "NOT_CHECKED_IN"]?.tone ?? "slate"}>
                  {CHECK_IN_META[e.check_in_status || "NOT_CHECKED_IN"]?.label}
                </Badge>
              </div>

              {/* Answers to the organizer's own registration questions. Staff-
                  only by RLS — this is where the emergency contact they asked
                  for actually becomes useful on tournament day. */}
              <EntryAnswers fields={registrationFields} answers={entryDetails[e.id]} />

              <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-line-soft pt-2.5">
                {e.reg_status === "PENDING" && canEdit && (
                  <>
                    <Btn size="sm" variant="secondary" icon={Check} onClick={() => onApprove(e.id)}>Approve</Btn>
                    <Btn size="sm" variant="ghost" icon={X} onClick={() => onReject(e.id)}>Reject</Btn>
                  </>
                )}
                {e.payment_status !== "PAID" && e.payment_status !== "REFUNDED" && (
                  <Btn size="sm" variant="secondary" icon={CreditCard} onClick={() => onRecordPayment(e.id)}>Mark paid</Btn>
                )}
                {e.payment_status === "PAID" && (
                  <Btn size="sm" variant="ghost" onClick={() => onRefund(e.id)}>Refund</Btn>
                )}
                {/* DELETE on entries is owner_delete_entries only — there is
                    no staff equivalent, and an RLS DELETE that matches no row
                    succeeds silently (0 rows affected, no error), unlike an
                    RLS-refused INSERT. canEdit alone would let staff click
                    this and see nothing happen (audit finding F4 class). */}
                {canEdit && isOwner && (
                  <Btn size="sm" variant="ghost" className="ml-auto text-red-400" icon={Trash2} onClick={() => onRemove(e.id)}>Remove</Btn>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="hidden overflow-x-auto rounded-md border border-line sm:block">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-2 text-[11px] uppercase tracking-wide text-ink-2">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Registered</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Payment</th>
                <th className="px-3 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {filtered.map((e) => (
                <tr key={e.id}>
                  <td className="px-3 py-2 font-medium text-ink">
                    {(e.entry_players || []).map((p, i) => (
                      <span key={p.id ?? i}>
                        {i > 0 && <span className="text-ink-3"> / </span>}
                        {p.player_id
                          ? <Link to={`/p/${p.player_id}`} className="hover:text-accent-teal hover:underline">{p.name}</Link>
                          : p.name}
                      </span>
                    ))}
                    {(e.entry_players || []).length === 0 && entryName(e)}
                  </td>
                  <td className="px-3 py-2 text-ink-2">{fmtDate(e.created_at)}</td>
                  <td className="px-3 py-2"><Badge tone={REG_STATUS_META[e.reg_status].tone}>{REG_STATUS_META[e.reg_status].label}</Badge></td>
                  <td className="px-3 py-2"><Badge tone={PAY_STATUS_META[e.payment_status].tone}>{PAY_STATUS_META[e.payment_status].label}</Badge></td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      {e.reg_status === "PENDING" && canEdit && <>
                        <Btn size="sm" variant="ghost" onClick={() => onApprove(e.id)} title="Approve"><Check size={14} /></Btn>
                        <Btn size="sm" variant="ghost" onClick={() => onReject(e.id)} title="Reject"><X size={14} /></Btn>
                      </>}
                      {e.payment_status !== "PAID" && e.payment_status !== "REFUNDED" && (
                        <Btn size="sm" variant="ghost" icon={CreditCard} onClick={() => onRecordPayment(e.id)} title="Record a payment you received in cash or by UPI">Pay</Btn>
                      )}
                      {e.payment_status === "PAID" && (
                        <Btn size="sm" variant="ghost" onClick={() => onRefund(e.id)} title="Mark refunded">Refund</Btn>
                      )}
                      {canEdit && isOwner && <Btn size="sm" variant="ghost" onClick={() => onRemove(e.id)} title="Remove"><Trash2 size={14} className="text-red-500" /></Btn>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
      <RegistrationModal open={addOpen} onClose={() => setAddOpen(false)} event={event} onSubmit={async (eid, players) => { await onAddManual(eid, players); setAddOpen(false); }} />
      {onImport && (
        <CsvImportModal open={importOpen} onClose={() => setImportOpen(false)} event={event}
          onImport={(rows) => onImport(event.id, rows)} />
      )}
    </div>
  );
}
