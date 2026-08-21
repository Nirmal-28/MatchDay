import { Clock } from "lucide-react";
import { fmtDateTime, matchStageLabel, entryShort, MATCH_STATUS_META } from "../lib/engines";
import { Badge, EmptyState } from "./ui/primitives";

export default function ScheduleTable({ matches, entriesById, event }) {
  const sorted = [...matches].filter((m) => !m.is_bye).sort((a, b) => (a.scheduled_at || "").localeCompare(b.scheduled_at || "") || a.round - b.round);
  if (sorted.length === 0 || !sorted[0].scheduled_at) return <EmptyState icon={Clock} title="No schedule yet" hint="Generate the schedule to assign courts and times." />;
  return (
    <div className="overflow-x-auto rounded-md border border-line">
      <table className="w-full text-left text-sm">
        <thead className="bg-surface-2 text-[11px] uppercase tracking-wide text-ink-2">
          <tr>
            <th className="px-3 py-2 font-medium">Time</th>
            <th className="px-3 py-2 font-medium">Court</th>
            <th className="px-3 py-2 font-medium">Round</th>
            <th className="px-3 py-2 font-medium">Match</th>
            <th className="px-3 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line-soft">
          {sorted.map((m) => (
            <tr key={m.id}>
              <td className="px-3 py-2 font-mono text-xs text-ink-2">{fmtDateTime(m.scheduled_at)}</td>
              <td className="px-3 py-2"><Badge tone="slate">{m.court || "—"}</Badge></td>
              <td className="px-3 py-2 text-ink-2">{matchStageLabel(m, event)}</td>
              <td className="px-3 py-2 text-ink">{entryShort(entriesById[m.entry_a])} <span className="text-ink-3">vs</span> {entryShort(entriesById[m.entry_b])}</td>
              <td className="px-3 py-2"><Badge tone={MATCH_STATUS_META[m.status].tone}>{MATCH_STATUS_META[m.status].label}</Badge></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
