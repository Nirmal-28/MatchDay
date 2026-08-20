import { ListOrdered } from "lucide-react";
import { cx, entryShort, computeStandings } from "../lib/engines";
import { EmptyState, Badge } from "./ui/primitives";

// Standings for a round robin ("RR") or for each group of a group stage.
export default function StandingsPanel({ event, matches, entriesById, advancePerGroup }) {
  const grouped = matches.filter((m) => m.group_label);
  if (grouped.length === 0) {
    return <EmptyState icon={ListOrdered} title="No standings yet" hint="Standings appear once a round robin or group stage is generated." />;
  }

  const labels = [...new Set(grouped.map((m) => m.group_label))].sort();
  const advance = event?.format === "GROUP_KO" ? (advancePerGroup ?? event?.advance_per_group ?? 2) : 0;

  return (
    <div className="space-y-5">
      {labels.map((label) => {
        const gm = grouped.filter((m) => m.group_label === label);
        const ids = [...new Set(gm.flatMap((m) => [m.entry_a, m.entry_b]).filter(Boolean))];
        const rows = computeStandings(ids, gm);
        const remaining = gm.filter((m) => m.status !== "COMPLETED" && m.status !== "WALKOVER").length;

        return (
          <div key={label}>
            <div className="mb-2 flex items-center gap-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                {label === "RR" ? "Standings" : `Group ${label}`}
              </div>
              {remaining > 0
                ? <Badge tone="amber">{remaining} to play</Badge>
                : <Badge tone="emerald">Complete</Badge>}
            </div>
            <div className="overflow-x-auto rounded-md border border-stone-200">
              <table className="w-full text-left text-sm">
                <thead className="bg-stone-50 text-[11px] uppercase tracking-wide text-stone-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">#</th>
                    <th className="px-3 py-2 font-medium">Player</th>
                    <th className="px-3 py-2 font-medium text-center">P</th>
                    <th className="px-3 py-2 font-medium text-center">W</th>
                    <th className="px-3 py-2 font-medium text-center">L</th>
                    <th className="px-3 py-2 font-medium text-center">Games</th>
                    <th className="px-3 py-2 font-medium text-center">Pts</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {rows.map((r, i) => {
                    const qualifies = advance > 0 && i < advance;
                    return (
                      <tr key={r.entryId} className={cx(qualifies && "bg-teal-50/50")}>
                        <td className="px-3 py-2">
                          <span className={cx(
                            "inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold",
                            qualifies ? "bg-accent-teal text-white" : "text-stone-400"
                          )}>{i + 1}</span>
                        </td>
                        <td className={cx("px-3 py-2", qualifies ? "font-semibold text-teal-900" : "text-stone-800")}>
                          {entryShort(entriesById[r.entryId])}
                        </td>
                        <td className="px-3 py-2 text-center font-mono text-stone-600">{r.played}</td>
                        <td className="px-3 py-2 text-center font-mono font-semibold text-stone-800">{r.won}</td>
                        <td className="px-3 py-2 text-center font-mono text-stone-500">{r.lost}</td>
                        <td className="px-3 py-2 text-center font-mono text-xs text-stone-500">{r.gamesFor}–{r.gamesAgainst}</td>
                        <td className="px-3 py-2 text-center font-mono text-xs text-stone-500">{r.pointsFor}–{r.pointsAgainst}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {advance > 0 && (
              <p className="mt-1.5 text-[11px] text-stone-400">Top {advance} advance to the knockout.</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
