import { useState } from "react";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { Badge, Btn, Card, inputCls } from "./ui/primitives";

export default function CourtsPanel({ courts, onAdd, onUpdate, onRemove }) {
  const [name, setName] = useState("");
  return (
    <div>
      <div className="mb-3 flex gap-2">
        <input className={inputCls} placeholder="New court name (e.g. Court 4)" value={name} onChange={(e) => setName(e.target.value)} />
        <Btn size="sm" icon={Plus} onClick={() => { if (name.trim()) { onAdd(name.trim()); setName(""); } }}>Add court</Btn>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {courts.map((c) => (
          <Card key={c.id} className="flex items-center justify-between px-3 py-2.5">
            <div>
              <div className="text-sm font-medium text-stone-800">{c.name}</div>
              <Badge tone={c.status === "AVAILABLE" ? "emerald" : "slate"}>{c.status === "AVAILABLE" ? "Available" : "Unavailable"}</Badge>
            </div>
            <div className="flex gap-1">
              <button className="rounded p-1 text-stone-400 hover:bg-stone-100" onClick={() => onUpdate(c.id, { status: c.status === "AVAILABLE" ? "UNAVAILABLE" : "AVAILABLE" })} title="Toggle availability"><RotateCcw size={14} /></button>
              <button className="rounded p-1 text-stone-400 hover:bg-red-50 hover:text-red-500" onClick={() => onRemove(c.id)} title="Remove court"><Trash2 size={14} /></button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
