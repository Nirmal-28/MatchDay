import { Clock } from "lucide-react";
import { fmtDateTime, roundLabel, entryShort, MATCH_STATUS_META } from "../lib/engines";
import { Badge, EmptyState } from "./ui/primitives";

export default function ScheduleTable({ matches, entriesById, event }) {
  const sorted = [...matches].filter((m) => !m.is_bye).sort((a, b) => (a.scheduled_at || "").localeCompare(b.scheduled_at || "") || a.round - b.round);
  if (sorted.length === 0 || !sorted[0].scheduled_at) return <EmptyState icon={Clock} title="No schedule yet" hint="Generate the schedule to assign courts and times." />;
  return (
    <div className="overflow-x-auto rounded-md border border-stone-200">
      <table className="w-full text-left text-sm">
        <thead className="bg-stone-50 text-[11px] uppercase tracking-wide text-stone-500">
          <tr>
            <th className="px-3 py-2 font-medium">Time</th>
            <th className="px-3 py-2 font-medium">Court</th>
            <th className="px-3 py-2 font-medium">Round</th>
            <th className="px-3 py-2 font-medium">Match</th>
            <th className="px-3 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {sorted.map((m) => (
            <tr key={m.id}>
              <td className="px-3 py-2 font-mono text-xs text-stone-600">{fmtDateTime(m.scheduled_at)}</td>
              <td className="px-3 py-2"><Badge tone="slate">{m.court || "—"}</Badge></td>
              <td className="px-3 py-2 text-stone-500">{roundLabel(m.round, event.total_rounds)}</td>
              <td className="px-3 py-2 text-stone-800">{entryShort(entriesById[m.entry_a])} <span className="text-stone-300">vs</span> {entryShort(entriesById[m.entry_b])}</td>
              <td className="px-3 py-2"><Badge tone={MATCH_STATUS_META[m.status].tone}>{MATCH_STATUS_META[m.status].label}</Badge></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
