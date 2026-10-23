import { useCallback, useEffect, useState } from "react";
import { Smartphone, CheckCircle2, XCircle, AlertTriangle, Info } from "lucide-react";
import { cx, inr, entryName, timeAgo } from "../lib/engines";
import { isValidUpiId, duplicateUtrs } from "../lib/upi";
import { updateTournament, listUpiClaims, reviewUpiClaim } from "../lib/repository";
import { Badge, Btn, Card, inputCls } from "./ui/primitives";

/* UPI Direct, organizer side.

   Setup is one field: the UPI ID players should pay. After that, claims
   arrive here as "this entry says it paid, UTR …". The organizer opens their
   own bank or UPI app, finds the credit by UTR or by the MD reference in the
   note, and taps Received. That tap is the only thing that marks an entry
   paid — a player's word, or a screenshot, never does. */
export default function UpiDirectPanel({ tournament, entries, notify, onChanged }) {
  const [upiId, setUpiId] = useState(tournament.upi_id || "");
  const [payee, setPayee] = useState(tournament.upi_payee_name || tournament.organizer_name || "");
  const [saving, setSaving] = useState(false);
  const [claims, setClaims] = useState([]);
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => setClaims(await listUpiClaims(tournament.id)), [tournament.id]);
  useEffect(() => {
    let cancelled = false;
    listUpiClaims(tournament.id).then((c) => { if (!cancelled) setClaims(c); });
    return () => { cancelled = true; };
  }, [tournament.id]);

  const entryById = Object.fromEntries((entries || []).map((e) => [e.id, e]));
  const open = claims.filter((c) => c.status === "CLAIMED");
  const dupes = duplicateUtrs(claims);
  const dirty = (upiId.trim() || null) !== (tournament.upi_id || null) || payee !== (tournament.upi_payee_name || tournament.organizer_name || "");
  const valid = !upiId.trim() || isValidUpiId(upiId);

  const save = async () => {
    setSaving(true);
    try {
      await updateTournament(tournament.id, { upi_id: upiId.trim() || null, upi_payee_name: payee.trim() || null });
      notify?.(upiId.trim() ? "UPI Direct is on. Players will see how to pay you." : "UPI Direct is off.");
      onChanged?.();
    } catch (e) {
      notify?.(/upi_id/.test(e.message) ? "UPI Direct needs migration 016 applied first." : e.message, "error");
    } finally { setSaving(false); }
  };

  const review = async (claim, accept) => {
    setBusy(claim.id);
    try {
      await reviewUpiClaim(claim, accept);
      notify?.(accept ? "Marked paid." : "Marked not received — the player can pay again.");
      await load();
      onChanged?.();
    } catch (e) { notify?.(e.message, "error"); }
    finally { setBusy(null); }
  };

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-1.5 text-base font-semibold text-ink">
            <Smartphone size={16} className="text-accent-teal" /> UPI Direct
            {tournament.upi_id ? <Badge tone="emerald">On</Badge> : <Badge tone="slate">Off</Badge>}
          </h3>
          <p className="mt-1 max-w-xl text-xs text-ink-2">
            Players pay you straight from GPay, PhonePe or Paytm — no gateway, no fee, no KYC. Each entry gets its own
            reference for the UPI note, and you confirm each payment once you see it in your own account.
          </p>
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <div>
          <label htmlFor="upi-id" className="md-eyebrow">Your UPI ID</label>
          <input id="upi-id" className={cx(inputCls, "mt-1 font-mono", !valid && "border-red-400")} placeholder="yourclub@okhdfcbank"
            value={upiId} onChange={(e) => setUpiId(e.target.value)} autoComplete="off" />
        </div>
        <div>
          <label htmlFor="upi-payee" className="md-eyebrow">Name players will see</label>
          <input id="upi-payee" className={cx(inputCls, "mt-1")} maxLength={60} placeholder="Smash Badminton Club"
            value={payee} onChange={(e) => setPayee(e.target.value)} />
        </div>
        <div className="flex items-end">
          <Btn onClick={save} disabled={saving || !dirty || !valid} className="w-full">{saving ? "Saving…" : "Save"}</Btn>
        </div>
      </div>
      {!valid && <div className="mt-1.5 text-xs text-red-300">That doesn't look like a UPI ID — it should be name@bank, like yourclub@okhdfcbank.</div>}

      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between">
          <div className="md-eyebrow">Payments to confirm</div>
          {open.length > 0 && <span className="text-xs text-ink-3">{open.length} waiting</span>}
        </div>
        {open.length === 0 ? (
          <p className="rounded-md border border-line bg-surface-2 px-3 py-3 text-sm text-ink-3">
            {tournament.upi_id ? "Nothing to confirm. Claims appear here as players submit their UTR." : "Turn on UPI Direct above to start taking UPI payments."}
          </p>
        ) : (
          <div className="space-y-2">
            {open.map((c) => {
              const entry = entryById[c.entry_id];
              return (
                <div key={c.id} className="rounded-md border border-line bg-surface-2 px-3 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-ink">{entry ? entryName(entry) : "Entry"}</div>
                      <div className="mt-0.5 flex flex-wrap gap-x-3 font-mono text-[11px] text-ink-2">
                        <span>UTR {c.utr}</span><span>Ref {c.reference}</span><span>{inr(c.amount_inr)}</span>
                        <span className="font-sans text-ink-3">{timeAgo(c.created_at)}</span>
                      </div>
                    </div>
                    <div className="flex gap-1.5">
                      <Btn size="sm" icon={CheckCircle2} disabled={busy === c.id} onClick={() => review(c, true)}>Received</Btn>
                      <Btn size="sm" variant="secondary" icon={XCircle} disabled={busy === c.id} onClick={() => review(c, false)}>Not received</Btn>
                    </div>
                  </div>
                  {dupes[c.id] && (
                    <div className="mt-2 flex items-start gap-1.5 text-[11px] text-accent-yellow">
                      <AlertTriangle size={12} className="mt-px shrink-0" />
                      This UTR was also submitted for {dupes[c.id].map((id) => (entryById[id] ? entryName(entryById[id]) : "another entry")).join(", ")}. One transfer can't pay for two entries.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <p className="mt-2.5 flex items-start gap-1.5 text-[11px] text-ink-3">
          <Info size={12} className="mt-px shrink-0" />
          Check the credit in your own bank or UPI app — search for the UTR or the MD reference. Never confirm from a screenshot.
        </p>
      </div>
    </Card>
  );
}
