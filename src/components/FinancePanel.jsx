import { useCallback, useEffect, useMemo, useState } from "react";
import { IndianRupee, Download, AlertCircle, Info } from "lucide-react";
import { cx, inr, divisionLabel, entryName, fmtDate, PAY_STATUS_META } from "../lib/engines";
import { financeStats } from "../lib/analytics";
import { listPayments } from "../lib/repository";
import { downloadCsv, exportFilename } from "../lib/exports";
import { Badge, Btn, Card } from "../components/ui/primitives";

// Organizer finance. Reads the entries ledger (what each entry owes and
// whether it is settled) and cross-checks it against the provider-neutral
// `payments` table. It never initiates a charge and never writes payment
// state — that stays with the provider adapters and, for real money, with a
// server-side webhook.

function Money({ label, value, sub, tone }) {
  return (
    <Card className="p-3.5">
      <div className="text-[10px] uppercase tracking-wide text-ink-3">{label}</div>
      <div className={cx("font-display text-2xl font-bold",
        tone === "teal" ? "text-accent-teal" : tone === "red" ? "text-red-300" : "text-ink")}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-ink-3">{sub}</div>}
    </Card>
  );
}

export default function FinancePanel({ tournament, events, entries, notify }) {
  const [payments, setPayments] = useState([]);
  const [loadError, setLoadError] = useState(null);

  const load = useCallback(async () => {
    try { setPayments(await listPayments(tournament.id)); }
    catch (e) { setLoadError(e.message); }
  }, [tournament.id]);
  useEffect(() => { load(); }, [load]);

  const f = useMemo(() => financeStats(entries, events, payments), [entries, events, payments]);
  const eventById = Object.fromEntries(events.map((e) => [e.id, e]));

  const exportLedger = () => {
    const headers = ["Division", "Entry", "Fee (INR)", "Registration status", "Payment status", "Registered"];
    const rows = entries
      .filter((e) => !["REJECTED", "CANCELLED"].includes(e.reg_status))
      .map((e) => [
        divisionLabel(eventById[e.event_id]), entryName(e), Number(e.fee_inr || 0),
        e.reg_status, e.payment_status, e.created_at ? fmtDate(e.created_at) : "",
      ]);
    downloadCsv(exportFilename(tournament, "finance"), headers, rows);
    notify?.("Finance CSV downloaded.");
  };

  const unpaidEntries = entries.filter(
    (e) => !["REJECTED", "CANCELLED"].includes(e.reg_status) &&
      Number(e.fee_inr || 0) > 0 && !["PAID", "REFUNDED"].includes(e.payment_status)
  );

  return (
    <div className="space-y-5">
      {/* Money */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Money label="Expected revenue" value={inr(f.expected)} sub={`${f.registrations} billable entries`} />
        <Money label="Collected" value={inr(f.collected)} tone="teal" sub={`${f.collectionPct}% of expected`} />
        <Money label="Outstanding" value={inr(f.outstanding)} tone={f.outstanding ? "red" : undefined}
          sub={`${f.unpaidCount} unpaid · ${f.pendingCount} pending`} />
        <Money label="Refunded" value={inr(f.refunded)} sub={`${f.refundedCount} refunds`} />
      </div>

      {/* Counts */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {[
          ["Registrations", f.registrations, "slate"],
          ["Paid", f.paidCount, "emerald"],
          ["Unpaid", f.unpaidCount, "slate"],
          ["Pending", f.pendingCount, "amber"],
          ["Failed", f.failedCount, "red"],
        ].map(([label, value, tone]) => (
          <Card key={label} className="px-3 py-2.5 text-center">
            <div className="font-display text-xl font-bold text-ink">{value}</div>
            <Badge tone={tone} className="mt-0.5">{label}</Badge>
          </Card>
        ))}
      </div>

      {/* By category */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-2">
            <IndianRupee size={13} /> Revenue by category
          </h3>
          <Btn size="sm" variant="secondary" icon={Download} onClick={exportLedger}>Export CSV</Btn>
        </div>
        {f.byEvent.length === 0 ? (
          <Card className="px-4 py-6 text-center text-sm text-ink-3">No billable registrations yet.</Card>
        ) : (
          <>
          {/* Mobile: collection progress per category as cards. */}
          <div className="space-y-2 sm:hidden">
            {f.byEvent.map((r) => {
              const pct = r.expected ? Math.round((r.collected / r.expected) * 100) : 0;
              return (
                <Card key={r.event.id} className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 text-sm font-medium text-ink">{divisionLabel(r.event)}</div>
                    <div className="shrink-0 text-right text-sm font-semibold text-ink">{inr(r.collected)}</div>
                  </div>
                  <div className="mt-0.5 text-[11px] text-ink-3">
                    {r.paid} of {r.registrations} paid · {inr(r.expected)} expected
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                      <div className="h-full rounded-full bg-accent-teal" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-[11px] tabular-nums text-ink-3">{pct}%</span>
                  </div>
                </Card>
              );
            })}
          </div>

          <div className="hidden overflow-x-auto rounded-md border border-line sm:block">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-2 text-[11px] uppercase tracking-wide text-ink-2">
                <tr>
                  <th className="px-3 py-2 font-medium">Category</th>
                  <th className="px-3 py-2 text-right font-medium">Entries</th>
                  <th className="px-3 py-2 text-right font-medium">Paid</th>
                  <th className="px-3 py-2 text-right font-medium">Expected</th>
                  <th className="px-3 py-2 text-right font-medium">Collected</th>
                  <th className="px-3 py-2 font-medium">Collection</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {f.byEvent.map((r) => {
                  const pct = r.expected ? Math.round((r.collected / r.expected) * 100) : 0;
                  return (
                    <tr key={r.event.id}>
                      <td className="px-3 py-2 text-ink">{divisionLabel(r.event)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink-2">{r.registrations}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink-2">{r.paid}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink-2">{inr(r.expected)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink">{inr(r.collected)}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-3">
                            <div className="h-full rounded-full bg-accent-teal" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-[11px] tabular-nums text-ink-3">{pct}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>

      {/* Who still owes */}
      {unpaidEntries.length > 0 && (
        <div>
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-2">
            <AlertCircle size={13} className="text-amber-400" /> Outstanding entries
          </h3>
          {/* Mobile: who owes what, as a list an organizer can work through
              at the desk. Desktop keeps the table. */}
          <div className="space-y-2 sm:hidden">
            {unpaidEntries.map((e) => (
              <Card key={e.id} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <div className="truncate font-medium text-ink">{entryName(e)}</div>
                  <div className="truncate text-[11px] text-ink-3">{divisionLabel(eventById[e.event_id])}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-semibold tabular-nums text-ink">{inr(e.fee_inr)}</div>
                  <Badge tone={PAY_STATUS_META[e.payment_status]?.tone ?? "slate"} className="mt-0.5">
                    {PAY_STATUS_META[e.payment_status]?.label ?? e.payment_status}
                  </Badge>
                </div>
              </Card>
            ))}
          </div>

          <div className="hidden overflow-x-auto rounded-md border border-line sm:block">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-2 text-[11px] uppercase tracking-wide text-ink-2">
                <tr>
                  <th className="px-3 py-2 font-medium">Entry</th>
                  <th className="px-3 py-2 font-medium">Category</th>
                  <th className="px-3 py-2 text-right font-medium">Owed</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {unpaidEntries.map((e) => (
                  <tr key={e.id}>
                    <td className="px-3 py-2 text-ink">{entryName(e)}</td>
                    <td className="px-3 py-2 text-xs text-ink-2">{divisionLabel(eventById[e.event_id])}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-2">{inr(e.fee_inr)}</td>
                    <td className="px-3 py-2">
                      <Badge tone={PAY_STATUS_META[e.payment_status]?.tone ?? "slate"}>
                        {PAY_STATUS_META[e.payment_status]?.label ?? e.payment_status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1.5 text-[11px] text-ink-3">Mark an entry paid or refunded from the Participants tab.</p>
        </div>
      )}

      {/* Payment ledger + provider honesty */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-2">Payment ledger</h3>
        {loadError ? (
          <Card className="px-4 py-4 text-sm text-ink-3">Could not load the payment ledger: {loadError}</Card>
        ) : f.ledger.length === 0 ? (
          <Card className="px-4 py-6 text-center text-sm text-ink-3">
            No gateway transactions recorded. Entries marked paid by the organizer settle outside MatchDay
            (cash or direct transfer) and appear in the totals above without a ledger row.
          </Card>
        ) : (
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full min-w-[34rem] text-left text-sm">
              <thead className="bg-surface-2 text-[11px] uppercase tracking-wide text-ink-2">
                <tr>
                  <th className="px-3 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">Provider</th>
                  <th className="px-3 py-2 font-medium">Reference</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {f.ledger.map((p) => (
                  <tr key={p.id}>
                    <td className="px-3 py-2 text-xs text-ink-2">{fmtDate(p.created_at)}</td>
                    <td className="px-3 py-2"><Badge tone={p.provider === "MOCK" ? "amber" : "indigo"}>{p.provider}</Badge></td>
                    <td className="px-3 py-2 font-mono text-[11px] text-ink-3">{p.provider_payment_id || p.provider_order_id || p.id.slice(0, 8)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink">{inr(p.amount_inr)}</td>
                    <td className="px-3 py-2">
                      <Badge tone={PAY_STATUS_META[p.status]?.tone ?? "slate"}>{PAY_STATUS_META[p.status]?.label ?? p.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-2 flex gap-2 rounded-md border border-amber-400/30 bg-amber-400/[0.07] px-3 py-2.5 text-[11px] leading-relaxed text-amber-200">
          <Info size={13} className="mt-px shrink-0" />
          <span>
            No live payment gateway is connected. Amounts here are what the organizer has recorded, plus any
            <span className="font-medium"> MOCK</span> transactions from the built-in simulator — no real money has moved.
            Going live means deploying the <code className="font-mono">razorpay-create-order</code> and
            <code className="font-mono"> razorpay-webhook</code> Edge Functions with the account keys held as Supabase
            secrets; <span className="font-medium">payment_status</span> may only ever be set to PAID by that webhook,
            never by this browser.
          </span>
        </div>
      </div>
    </div>
  );
}
