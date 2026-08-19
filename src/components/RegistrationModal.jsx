import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { inr, CATEGORY_META } from "../lib/engines";
import { Modal, Field, Btn, inputCls } from "./ui/primitives";

export default function RegistrationModal({ open, onClose, event, onSubmit }) {
  const kind = event ? CATEGORY_META[event.category].kind : "SINGLES";
  const [p1, setP1] = useState({ name: "", phone: "", email: "" });
  const [p2, setP2] = useState({ name: "", phone: "", email: "" });
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) { setP1({ name: "", phone: "", email: "" }); setP2({ name: "", phone: "", email: "" }); setError(""); setDone(false); } }, [open, event]);

  if (!open || !event) return null;

  const submit = async () => {
    setError("");
    if (!p1.name || !p1.phone) { setError("Enter the player's name and phone number."); return; }
    if (kind === "DOUBLES" && (!p2.name || !p2.phone)) { setError("Enter your partner's name and phone number."); return; }
    setSaving(true);
    try {
      const players = kind === "DOUBLES" ? [p1, p2] : [p1];
      await onSubmit(event.id, players);
      setDone(true);
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Register — ${CATEGORY_META[event.category].label}`}>
      {done ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <CheckCircle2 className="text-emerald-600" size={32} />
          <div className="font-semibold text-stone-900">Registration received</div>
          <p className="max-w-sm text-sm text-stone-500">You're on the list as <span className="font-medium text-stone-700">Pending</span> until payment is completed. This tournament uses a simulated payment flow — no real charge will be made.</p>
          <Btn size="sm" variant="secondary" className="mt-2" onClick={onClose}>Close</Btn>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-500">Entry fee <span className="font-semibold text-stone-700">{inr(event.fee_inr)}</span> · {kind === "DOUBLES" ? "Team of 2" : "Individual"}</div>
          <Field label={kind === "DOUBLES" ? "Player 1 name" : "Full name"} required><input className={inputCls} value={p1.name} onChange={(e) => setP1({ ...p1, name: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Phone" required><input className={inputCls} value={p1.phone} onChange={(e) => setP1({ ...p1, phone: e.target.value })} /></Field>
            <Field label="Email"><input className={inputCls} value={p1.email} onChange={(e) => setP1({ ...p1, email: e.target.value })} /></Field>
          </div>
          {kind === "DOUBLES" && (
            <>
              <div className="pt-1 text-xs font-semibold uppercase tracking-wide text-stone-500">Partner</div>
              <Field label="Player 2 name" required><input className={inputCls} value={p2.name} onChange={(e) => setP2({ ...p2, name: e.target.value })} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Phone" required><input className={inputCls} value={p2.phone} onChange={(e) => setP2({ ...p2, phone: e.target.value })} /></Field>
                <Field label="Email"><input className={inputCls} value={p2.email} onChange={(e) => setP2({ ...p2, email: e.target.value })} /></Field>
              </div>
            </>
          )}
          {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
          <Btn className="w-full" disabled={saving} onClick={submit}>Submit registration</Btn>
        </div>
      )}
    </Modal>
  );
}
