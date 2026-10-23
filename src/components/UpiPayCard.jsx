import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Smartphone, Copy, Check, ShieldCheck, Clock } from "lucide-react";
import { inr } from "../lib/engines";
import { upiPayUrl, upiReference, isValidUtr, normaliseUtr } from "../lib/upi";
import { claimUpiPayment } from "../lib/repository";
import { Btn, inputCls } from "./ui/primitives";

function CopyValue({ label, value }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1600); }
    catch { /* clipboard blocked: the value is on screen and selectable */ }
  };
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-line bg-surface px-3 py-2">
      <div className="min-w-0">
        <div className="md-eyebrow">{label}</div>
        <div className="select-all truncate font-mono text-sm text-ink">{value}</div>
      </div>
      <button type="button" onClick={copy} aria-label={`Copy ${label}`}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line text-ink-2 hover:border-accent-teal hover:text-ink">
        {copied ? <Check size={14} className="text-accent-teal" /> : <Copy size={14} />}
      </button>
    </div>
  );
}

/* UPI Direct, player side. Pay the organizer from any UPI app, then hand
   over the 12-digit UTR. Nothing on this card says "paid": the most it can
   say is "submitted — the organizer will confirm", because only the money
   arriving in the organizer's own account proves anything. */
export default function UpiPayCard({ tournament, entry }) {
  const amount = Number(entry?.fee_inr || 0);
  const reference = upiReference(entry?.id);
  const note = `${reference} ${tournament?.name || "MatchDay"}`.slice(0, 60);
  const url = upiPayUrl({ upiId: tournament?.upi_id, payeeName: tournament?.upi_payee_name || tournament?.organizer_name, amount, note });
  const qrRef = useRef(null);
  const [utr, setUtr] = useState("");
  const [state, setState] = useState(entry?.payment_status === "PENDING" ? "submitted" : "pay");
  const [error, setError] = useState("");

  useEffect(() => {
    if (state === "pay" && qrRef.current) QRCode.toCanvas(qrRef.current, url, { width: 168, margin: 1 }).catch(() => {});
  }, [url, state]);

  if (!tournament?.upi_id || !entry || amount <= 0 || ["PAID", "REFUNDED"].includes(entry.payment_status)) return null;

  const submit = async () => {
    setError("");
    if (!isValidUtr(utr)) { setError("A UTR is 12 digits. Open the payment in your UPI app — it's listed as UTR, UPI Ref No. or Transaction ID."); return; }
    setState("sending");
    try { await claimUpiPayment(entry.id, normaliseUtr(utr)); setState("submitted"); }
    catch (e) { setError(e.message); setState("pay"); }
  };

  if (state === "submitted") {
    return (
      <div className="rounded-lg border border-accent-teal/40 bg-accent-teal/[0.07] p-3.5">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Clock size={15} className="text-accent-teal" /> Payment submitted — waiting for the organizer
        </div>
        <p className="mt-1 text-xs text-ink-2">
          They'll mark your entry paid once {inr(amount)} with reference <span className="font-mono text-ink">{reference}</span> shows
          in their account. Keep the payment in your UPI app until then.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-line bg-surface-2 p-3.5">
      <div className="mb-2.5 flex items-baseline justify-between gap-2">
        <div className="md-eyebrow">Pay the entry fee by UPI</div>
        <div className="md-score text-2xl text-ink">{inr(amount)}</div>
      </div>

      <a href={url}
        className="mb-3 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-accent-teal text-sm font-bold uppercase tracking-wide text-navy-950 hover:brightness-110 sm:hidden">
        <Smartphone size={16} /> Pay with GPay / PhonePe / Paytm
      </a>

      <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
        <div className="hidden flex-col items-center gap-1 sm:flex">
          <canvas ref={qrRef} className="rounded-md bg-white p-1" aria-label="UPI QR code" />
          <span className="text-[10px] text-ink-3">Scan with any UPI app</span>
        </div>
        <div className="min-w-0 space-y-2">
          <CopyValue label={`Pay to · ${tournament.upi_payee_name || tournament.organizer_name || "Organizer"}`} value={tournament.upi_id} />
          <CopyValue label="Put this in the note" value={reference} />
        </div>
      </div>

      <div className="mt-3 border-t border-line-soft pt-3">
        <label htmlFor={`utr-${entry.id}`} className="text-xs font-semibold text-ink">Paid? Enter the 12-digit UTR from your UPI app</label>
        <div className="mt-1.5 flex gap-2">
          <input id={`utr-${entry.id}`} inputMode="numeric" autoComplete="off" placeholder="e.g. 4123 4567 8901"
            className={`${inputCls} font-mono`} value={utr} onChange={(e) => setUtr(e.target.value)} />
          <Btn onClick={submit} disabled={state === "sending"}>{state === "sending" ? "Sending…" : "Submit"}</Btn>
        </div>
        {error && <div className="mt-2 text-xs text-red-300">{error}</div>}
        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-ink-3">
          <ShieldCheck size={12} className="mt-px shrink-0 text-accent-teal" />
          No screenshots needed. The organizer checks the UTR against their own bank app, so a fake screenshot can't mark anyone paid.
        </p>
      </div>
    </div>
  );
}
