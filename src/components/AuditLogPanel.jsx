import { useEffect, useState } from "react";
import { ClipboardList } from "lucide-react";
import { fmtDateTime } from "../lib/engines";
import { listScheduleAudit } from "../lib/repository";
import { Badge, Card, EmptyState, inputCls } from "./ui/primitives";

const ACTION_META = {
  GENERATED: { label: "Optimized", tone: "teal" },
  MOVED: { label: "Moved", tone: "amber" },
  LOCKED: { label: "Locked", tone: "slate" },
  UNLOCKED: { label: "Unlocked", tone: "slate" },
  PUBLISHED: { label: "Published", tone: "emerald" },
};

export default function AuditLogPanel({ tournamentId, allMatches }) {
  const [rows, setRows] = useState(null);
  const [filter, setFilter] = useState("ALL");

  useEffect(() => { listScheduleAudit(tournamentId).then(setRows); }, [tournamentId]);

  if (!rows) return <div className="py-10 text-center text-sm text-ink-2">Loading audit log…</div>;
  if (rows.length === 0) return <EmptyState icon={ClipboardList} title="No scheduling activity yet" hint="Every optimize, move, lock, and publish action on this tournament's schedule will show up here." />;

  const filtered = filter === "ALL" ? rows : rows.filter((r) => r.action === filter);
  const matchById = Object.fromEntries((allMatches || []).map((m) => [m.id, m]));

  return (
    <div className="space-y-3">
      {/* `sm:w-auto`, not a bare `w-auto` — inputCls opens with `w-full`, and a
          bare `w-auto` appended after it in the class string does not reliably
          win (equal specificity; the compiled stylesheet order decides, not
          the class-string order). Tailwind always emits responsive variants
          after their bare counterpart, so `sm:w-auto` is the fix that actually
          holds (same root cause as audit finding F2). */}
      <select className={`${inputCls} sm:w-auto`} value={filter} onChange={(e) => setFilter(e.target.value)}>
        <option value="ALL">All actions</option>
        {Object.keys(ACTION_META).map((a) => <option key={a} value={a}>{ACTION_META[a].label}</option>)}
      </select>
      <div className="space-y-1.5">
        {filtered.map((r) => {
          const meta = ACTION_META[r.action] || { label: r.action, tone: "slate" };
          const m = r.match_id ? matchById[r.match_id] : null;
          return (
            <Card key={r.id} className="p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                  {m && <span className="text-ink-2">Match #{m.match_number}</span>}
                </div>
                <span className="text-xs text-ink-3">{fmtDateTime(r.created_at)}</span>
              </div>
              {r.action === "MOVED" && (
                <div className="mt-1 text-xs text-ink-2">
                  {r.from_court || "—"} · {r.from_time ? fmtDateTime(r.from_time) : "—"}
                  <span className="mx-1.5 text-ink-3">→</span>
                  {r.to_court || "—"} · {r.to_time ? fmtDateTime(r.to_time) : "—"}
                </div>
              )}
              {r.note && <div className="mt-1 text-xs text-ink-3">{r.note}</div>}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
