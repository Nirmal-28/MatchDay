import { useState } from "react";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { Badge, Btn, Card, inputCls } from "./ui/primitives";

export default function CourtsPanel({ courts, onAdd, onUpdate, onRemove, onUpdateAvailability }) {
  const [name, setName] = useState("");
  return (
    <div>
      <div className="mb-3 flex gap-2">
        <input className={inputCls} placeholder="New court name (e.g. Court 4)" value={name} onChange={(e) => setName(e.target.value)} />
        <Btn size="sm" icon={Plus} onClick={() => { if (name.trim()) { onAdd(name.trim()); setName(""); } }}>Add court</Btn>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {courts.map((c) => (
          <Card key={c.id} className="p-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-ink">{c.name}</div>
                <Badge tone={c.status === "AVAILABLE" ? "emerald" : "slate"}>{c.status === "AVAILABLE" ? "Active" : "Inactive"}</Badge>
              </div>
              <div className="flex gap-1">
                <button className="rounded p-1 text-ink-3 hover:bg-surface-2" onClick={() => onUpdate(c.id, { status: c.status === "AVAILABLE" ? "UNAVAILABLE" : "AVAILABLE" })} title="Toggle active"><RotateCcw size={14} /></button>
                <button className="rounded p-1 text-ink-3 hover:bg-red-500/10 hover:text-red-400" onClick={() => onRemove(c.id)} title="Remove court"><Trash2 size={14} /></button>
              </div>
            </div>
            {onUpdateAvailability && (
              <div className="mt-2 flex items-center gap-1.5 text-xs text-ink-2">
                <span className="text-ink-3">Available</span>
                <input type="time" defaultValue={(c.available_start || "09:00").slice(0, 5)}
                  className="rounded border border-line bg-surface-2 px-1.5 py-1 text-ink"
                  onBlur={(e) => onUpdateAvailability(c.id, { availableStart: e.target.value, availableEnd: (c.available_end || "18:00").slice(0, 5) })} />
                <span className="text-ink-3">→</span>
                <input type="time" defaultValue={(c.available_end || "18:00").slice(0, 5)}
                  className="rounded border border-line bg-surface-2 px-1.5 py-1 text-ink"
                  onBlur={(e) => onUpdateAvailability(c.id, { availableStart: (c.available_start || "09:00").slice(0, 5), availableEnd: e.target.value })} />
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
