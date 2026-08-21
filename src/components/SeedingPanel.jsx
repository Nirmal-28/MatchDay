import { useState } from "react";
import { Trophy, Info } from "lucide-react";
import { entryName } from "../lib/engines";
import { Btn, Card, inputCls } from "./ui/primitives";

// Lets the organizer assign real seeds before generating a draw. Without this
// the draw falls back to registration order, which would hand the top seed
// (and a first-round bye) to whoever signed up first.
export default function SeedingPanel({ entries, onSave, disabled }) {
  const confirmed = entries.filter((e) => e.reg_status === "CONFIRMED");
  const [seeds, setSeeds] = useState(() =>
    Object.fromEntries(confirmed.map((e) => [e.id, e.seed ?? ""]))
  );
  const [saving, setSaving] = useState(false);

  if (confirmed.length === 0) {
    return <p className="text-sm text-ink-2">Confirm some entries first — only confirmed entries can be seeded.</p>;
  }

  const used = Object.values(seeds).filter((v) => v !== "" && v != null).map(Number);
  const dupes = used.filter((v, i) => used.indexOf(v) !== i);

  const save = async () => {
    setSaving(true);
    try {
      const map = Object.fromEntries(
        Object.entries(seeds).map(([id, v]) => [id, v === "" || v == null ? null : Number(v)])
      );
      await onSave(map);
    } finally { setSaving(false); }
  };

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-start gap-2 rounded-md bg-surface-2 px-3 py-2 text-xs text-ink-2">
        <Info size={14} className="mt-0.5 shrink-0 text-ink-3" />
        <span>
          Seeds decide bracket placement. Seed 1 and 2 land in opposite halves, and any
          byes go to the top seeds. Leave blank to place an entry by registration order.
        </span>
      </div>

      <div className="space-y-1.5">
        {confirmed.map((e) => (
          <div key={e.id} className="flex items-center gap-3 rounded-md border border-line px-3 py-2">
            <Trophy size={13} className="shrink-0 text-ink-3" />
            <span className="min-w-0 flex-1 truncate text-sm text-ink">{entryName(e)}</span>
            <input
              type="number" min={1} max={confirmed.length} placeholder="—"
              className={`${inputCls} w-20 text-center`}
              value={seeds[e.id] ?? ""}
              onChange={(ev) => setSeeds((s) => ({ ...s, [e.id]: ev.target.value }))}
            />
          </div>
        ))}
      </div>

      {dupes.length > 0 && (
        <div className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          Duplicate seed{dupes.length > 1 ? "s" : ""}: {[...new Set(dupes)].join(", ")}. Each seed must be unique.
        </div>
      )}

      <div className="mt-4 flex justify-end">
        <Btn size="sm" disabled={saving || disabled || dupes.length > 0} onClick={save}>Save seeds</Btn>
      </div>
    </Card>
  );
}
