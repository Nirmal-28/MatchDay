import { useState } from "react";
import { Search, UserPlus, Check, X, CreditCard, Trash2, Users } from "lucide-react";
import { cx, fmtDate, entryName, REG_STATUS_META, PAY_STATUS_META } from "../lib/engines";
import { Badge, Btn, EmptyState, inputCls } from "./ui/primitives";
import RegistrationModal from "./RegistrationModal";

export default function ParticipantsPanel({ event, entries, onApprove, onReject, onRemove, onSimPay, onRefund, onAddManual }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [addOpen, setAddOpen] = useState(false);

  const filtered = entries.filter((e) => {
    if (filter !== "ALL" && e.reg_status !== filter) return false;
    if (q && !entryName(e).toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  const canEdit = event.status === "REGISTRATION_OPEN" || event.status === "REGISTRATION_CLOSED";

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400" />
          <input className={cx(inputCls, "pl-8")} placeholder="Search participants" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className={cx(inputCls, "w-auto")} value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="ALL">All statuses</option>
          {Object.keys(REG_STATUS_META).map((s) => <option key={s} value={s}>{REG_STATUS_META[s].label}</option>)}
        </select>
        <Btn size="sm" variant="secondary" icon={UserPlus} onClick={() => setAddOpen(true)}>Add participant</Btn>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Users} title="No participants yet" hint="Registrations for this category will appear here." />
      ) : (
        <div className="overflow-x-auto rounded-md border border-stone-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-stone-50 text-[11px] uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Registered</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Payment</th>
                <th className="px-3 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {filtered.map((e) => (
                <tr key={e.id}>
                  <td className="px-3 py-2 font-medium text-stone-800">{entryName(e)}</td>
                  <td className="px-3 py-2 text-stone-500">{fmtDate(e.created_at)}</td>
                  <td className="px-3 py-2"><Badge tone={REG_STATUS_META[e.reg_status].tone}>{REG_STATUS_META[e.reg_status].label}</Badge></td>
                  <td className="px-3 py-2"><Badge tone={PAY_STATUS_META[e.payment_status].tone}>{PAY_STATUS_META[e.payment_status].label}</Badge></td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      {e.reg_status === "PENDING" && canEdit && <>
                        <Btn size="sm" variant="ghost" onClick={() => onApprove(e.id)} title="Approve"><Check size={14} /></Btn>
                        <Btn size="sm" variant="ghost" onClick={() => onReject(e.id)} title="Reject"><X size={14} /></Btn>
                      </>}
                      {e.payment_status !== "PAID" && e.payment_status !== "REFUNDED" && (
                        <Btn size="sm" variant="ghost" icon={CreditCard} onClick={() => onSimPay(e.id)} title="Simulate payment success">Pay</Btn>
                      )}
                      {e.payment_status === "PAID" && (
                        <Btn size="sm" variant="ghost" onClick={() => onRefund(e.id)} title="Mark refunded">Refund</Btn>
                      )}
                      {canEdit && <Btn size="sm" variant="ghost" onClick={() => onRemove(e.id)} title="Remove"><Trash2 size={14} className="text-red-500" /></Btn>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <RegistrationModal open={addOpen} onClose={() => setAddOpen(false)} event={event} onSubmit={async (eid, players) => { await onAddManual(eid, players); setAddOpen(false); }} />
    </div>
  );
}
