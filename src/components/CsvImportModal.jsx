import { useState } from "react";
import { Upload, CheckCircle2, AlertCircle } from "lucide-react";
import { parseCsv } from "../lib/csv";
import { CATEGORY_META } from "../lib/engines";
import { Modal, Btn, Badge, inputCls } from "./ui/primitives";

const FIELD_OPTIONS = [
  { key: "", label: "— Don't import —" },
  { key: "name", label: "Name" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "partnerName", label: "Partner name" },
  { key: "partnerPhone", label: "Partner phone" },
  { key: "partnerEmail", label: "Partner email" },
  { key: "seed", label: "Seed" },
  { key: "paymentStatus", label: "Payment status (PAID = auto-confirm)" },
];

// Best-effort auto-mapping so most spreadsheets need zero manual mapping.
function guessMapping(headers) {
  const map = {};
  headers.forEach((h) => {
    const norm = h.toLowerCase().replace(/[^a-z]/g, "");
    if (["name", "playername", "fullname"].includes(norm)) map[h] = "name";
    else if (["phone", "mobile", "phonenumber", "contact"].includes(norm)) map[h] = "phone";
    else if (["email", "emailaddress"].includes(norm)) map[h] = "email";
    else if (["partner", "partnername"].includes(norm)) map[h] = "partnerName";
    else if (["partnerphone", "partnermobile"].includes(norm)) map[h] = "partnerPhone";
    else if (["partneremail"].includes(norm)) map[h] = "partnerEmail";
    else if (["seed"].includes(norm)) map[h] = "seed";
    else if (["payment", "paymentstatus", "paid"].includes(norm)) map[h] = "paymentStatus";
  });
  return map;
}

function validateRow(row, isDoubles) {
  const errors = [];
  if (!row.name) errors.push("Missing name");
  if (!row.phone) errors.push("Missing phone");
  else if (!/^\d{7,15}$/.test(row.phone.replace(/[^\d]/g, ""))) errors.push("Phone looks invalid");
  if (isDoubles) {
    if (!row.partnerName) errors.push("Missing partner name");
    if (!row.partnerPhone) errors.push("Missing partner phone");
  }
  return errors;
}

export default function CsvImportModal({ open, onClose, event, onImport }) {
  const [stage, setStage] = useState("upload"); // upload | map | preview | done
  const [parsed, setParsed] = useState(null);
  const [mapping, setMapping] = useState({});
  const [result, setResult] = useState(null);
  const [importing, setImporting] = useState(false);

  const isDoubles = event ? CATEGORY_META[event.category].kind === "DOUBLES" : false;

  const reset = () => { setStage("upload"); setParsed(null); setMapping({}); setResult(null); };
  const handleClose = () => { reset(); onClose(); };

  const handleFile = (file) => {
    const reader = new FileReader();
    reader.onload = () => {
      const { headers, rows } = parseCsv(String(reader.result));
      setParsed({ headers, rows });
      setMapping(guessMapping(headers));
      setStage("map");
    };
    reader.readAsText(file);
  };

  const mappedRows = () => {
    if (!parsed) return [];
    const fieldByHeader = mapping;
    return parsed.rows.map((r) => {
      const obj = {};
      parsed.headers.forEach((h, i) => { const f = fieldByHeader[h]; if (f) obj[f] = r[i]; });
      const errors = validateRow(obj, isDoubles);
      return { ...obj, _errors: errors };
    });
  };

  const rows = stage === "preview" || stage === "done" ? mappedRows() : [];
  const valid = rows.filter((r) => r._errors.length === 0);
  const invalid = rows.filter((r) => r._errors.length > 0);

  const runImport = async () => {
    setImporting(true);
    try {
      const res = await onImport(valid);
      setResult(res);
      setStage("done");
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal open={open} onClose={handleClose} title={`Import participants — ${event ? CATEGORY_META[event.category].label : ""}`} width="max-w-2xl">
      {stage === "upload" && (
        <div className="space-y-3">
          <p className="text-sm text-ink-2">
            Upload a CSV with columns for name, phone, email{isDoubles ? ", partner name/phone/email" : ""}, seed, and payment status. The first row must be headers.
          </p>
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-line px-6 py-10 text-center hover:border-accent-teal/50">
            <Upload size={24} className="text-ink-3" />
            <span className="text-sm font-medium text-ink">Click to choose a .csv file</span>
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files[0] && handleFile(e.target.files[0])} />
          </label>
        </div>
      )}

      {stage === "map" && parsed && (
        <div className="space-y-3">
          <p className="text-sm text-ink-2">{parsed.rows.length} rows detected. Map each column to a field (or leave unmapped to ignore it).</p>
          <div className="max-h-72 space-y-2 overflow-y-auto">
            {parsed.headers.map((h) => (
              <div key={h} className="flex items-center gap-2">
                <span className="w-40 shrink-0 truncate text-sm text-ink">{h}</span>
                <select className={inputCls} value={mapping[h] || ""} onChange={(e) => setMapping((m) => ({ ...m, [h]: e.target.value }))}>
                  {FIELD_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                </select>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Btn variant="secondary" size="sm" onClick={() => setStage("upload")}>Back</Btn>
            <Btn size="sm" onClick={() => setStage("preview")}>Preview</Btn>
          </div>
        </div>
      )}

      {stage === "preview" && (
        <div className="space-y-3">
          <div className="rounded-md border border-line bg-surface-2 px-3 py-2.5 text-sm text-ink">
            <span className="font-semibold">{rows.length} rows detected, {valid.length} valid, {invalid.length} error{invalid.length === 1 ? "" : "s"}.</span>
          </div>
          <div className="max-h-72 overflow-y-auto rounded-md border border-line">
            <table className="w-full text-left text-xs">
              <thead className="bg-surface-2 text-ink-2"><tr><th className="px-2 py-1.5">Name</th><th className="px-2 py-1.5">Phone</th><th className="px-2 py-1.5">Status</th></tr></thead>
              <tbody className="divide-y divide-line-soft">
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td className="px-2 py-1.5 text-ink">{r.name || "—"}</td>
                    <td className="px-2 py-1.5 text-ink-2">{r.phone || "—"}</td>
                    <td className="px-2 py-1.5">
                      {r._errors.length === 0
                        ? <Badge tone="emerald"><CheckCircle2 size={10} /> Valid</Badge>
                        : <span className="flex items-center gap-1 text-red-400"><AlertCircle size={11} />{r._errors.join(", ")}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-2">
            <Btn variant="secondary" size="sm" onClick={() => setStage("map")}>Back</Btn>
            <Btn size="sm" disabled={valid.length === 0 || importing} onClick={runImport}>
              {importing ? "Importing…" : `Import ${valid.length} valid row${valid.length === 1 ? "" : "s"}`}
            </Btn>
          </div>
        </div>
      )}

      {stage === "done" && result && (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <CheckCircle2 className="text-emerald-500" size={32} />
          <div className="font-semibold text-ink">{result.imported} participant{result.imported === 1 ? "" : "s"} imported</div>
          {result.failed.length > 0 && <div className="text-sm text-amber-400">{result.failed.length} row(s) failed on the server (e.g. category full) and were skipped.</div>}
          <Btn size="sm" variant="secondary" className="mt-2" onClick={handleClose}>Close</Btn>
        </div>
      )}
    </Modal>
  );
}
