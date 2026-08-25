import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { Search, QrCode, X, UserCheck, Clock3, UserX } from "lucide-react";
import { entryName } from "../lib/engines";
import { Badge, Btn, Card, EmptyState, inputCls } from "./ui/primitives";

const STATUS_META = {
  NOT_CHECKED_IN: { label: "Not checked in", tone: "slate" },
  CHECKED_IN: { label: "Checked in", tone: "emerald" },
  LATE: { label: "Late", tone: "amber" },
  NO_SHOW: { label: "No-show", tone: "red" },
};

export default function CheckInPanel({ entries, onSetStatus, onCheckInByCode }) {
  const [q, setQ] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [qrEntry, setQrEntry] = useState(null);
  const [error, setError] = useState("");

  const filtered = useMemo(
    () => entries.filter((e) => !q || entryName(e).toLowerCase().includes(q.toLowerCase())),
    [entries, q]
  );
  const checkedIn = entries.filter((e) => e.check_in_status === "CHECKED_IN" || e.check_in_status === "LATE").length;

  const submitCode = async (e) => {
    e.preventDefault();
    setError("");
    try {
      const entry = await onCheckInByCode(codeInput.trim());
      setError(`✓ Checked in: ${entryName(entry)}`);
      setCodeInput("");
    } catch (err) {
      setError(err.message);
    }
  };

  if (entries.length === 0) return <EmptyState icon={UserCheck} title="No confirmed participants yet" hint="Check-in opens once participants are approved." />;

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="md-eyebrow">Check-in progress</div>
            <div className="font-display text-3xl font-bold text-ink">{checkedIn} / {entries.length}</div>
          </div>
          <form onSubmit={submitCode} className="flex items-center gap-2">
            <input className={inputCls} placeholder="Scan or enter check-in code" value={codeInput} onChange={(e) => setCodeInput(e.target.value)} />
            <Btn size="sm" type="submit" icon={QrCode}>Check in</Btn>
          </form>
        </div>
        {error && <div className={`mt-2 text-xs ${error.startsWith("✓") ? "text-emerald-400" : "text-red-400"}`}>{error}</div>}
      </Card>

      <div className="relative">
        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
        <input className={`${inputCls} pl-8`} placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="overflow-x-auto rounded-md border border-line">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface-2 text-[11px] uppercase tracking-wide text-ink-2">
            <tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Actions</th></tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {filtered.map((e) => (
              <tr key={e.id}>
                <td className="px-3 py-2 font-medium text-ink">{entryName(e)}</td>
                <td className="px-3 py-2"><Badge tone={STATUS_META[e.check_in_status || "NOT_CHECKED_IN"].tone}>{STATUS_META[e.check_in_status || "NOT_CHECKED_IN"].label}</Badge></td>
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-1">
                    <Btn size="sm" variant="ghost" title="Show QR" onClick={() => setQrEntry(e)}><QrCode size={14} /></Btn>
                    <Btn size="sm" variant="ghost" title="Mark checked in" onClick={() => onSetStatus(e.id, "CHECKED_IN")}><UserCheck size={14} className="text-emerald-500" /></Btn>
                    <Btn size="sm" variant="ghost" title="Mark late" onClick={() => onSetStatus(e.id, "LATE")}><Clock3 size={14} className="text-amber-500" /></Btn>
                    <Btn size="sm" variant="ghost" title="Mark no-show" onClick={() => onSetStatus(e.id, "NO_SHOW")}><UserX size={14} className="text-red-500" /></Btn>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {qrEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setQrEntry(null)}>
          <div className="flex flex-col items-center gap-3 rounded-lg border border-line bg-surface p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex w-full items-center justify-between">
              <div className="text-sm font-semibold text-ink">{entryName(qrEntry)}</div>
              <button onClick={() => setQrEntry(null)}><X size={16} className="text-ink-3" /></button>
            </div>
            <QrCanvasLarge code={qrEntry.check_in_code} />
            <div className="font-mono text-xs text-ink-3">{qrEntry.check_in_code}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function QrCanvasLarge({ code }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current && code) QRCode.toCanvas(ref.current, code, { width: 220, margin: 1 }).catch(() => {});
  }, [code]);
  return <canvas ref={ref} className="rounded bg-white p-2" />;
}
