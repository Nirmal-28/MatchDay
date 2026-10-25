import { ListOrdered } from "lucide-react";
import { cx, entryShort, computeStandings, parseGroupLabel, groupDisplayName } from "../lib/engines";
import { EmptyState, Badge } from "./ui/primitives";

// Standings for a round robin ("RR") or for each group of a group stage.
export default function StandingsPanel({ event, matches, entriesById, advancePerGroup }) {
  const grouped = matches.filter((m) => m.group_label);
  if (grouped.length === 0) {
    return <EmptyState icon={ListOrdered} title="No standings yet" hint="Standings appear once a round robin or group stage is generated." />;
  }

  // Newest stage first: after a reshuffle, the groups being played now are the
  // ones people look for; earlier stages stay below as the record.
  const labels = [...new Set(grouped.map((m) => m.group_label))].sort((a, b) => {
    const x = parseGroupLabel(a), y = parseGroupLabel(b);
    return y.stage - x.stage || x.group.localeCompare(y.group);
  });
  const latestStage = Math.max(...labels.map((l) => parseGroupLabel(l).stage));
  const advanceCount = event?.format === "GROUP_KO" ? (advancePerGroup ?? event?.advance_per_group ?? 2) : 0;

  return (
    <div className="space-y-5">
      {labels.map((label) => {
        const gm = grouped.filter((m) => m.group_label === label);
        const ids = [...new Set(gm.flatMap((m) => [m.entry_a, m.entry_b]).filter(Boolean))];
        const rows = computeStandings(ids, gm);
        const remaining = gm.filter((m) => m.status !== "COMPLETED" && m.status !== "WALKOVER").length;
        // Only the newest stage feeds the knockout; an earlier stage fed the reshuffle.
        const advance = parseGroupLabel(label).stage === latestStage ? advanceCount : 0;

        return (
          <div key={label}>
            <div className="mb-2 flex items-center gap-2">
              <div className="md-eyebrow">
                {label === "RR" ? "Standings" : groupDisplayName(label)}
              </div>
              {remaining > 0
                ? <Badge tone="amber">{remaining} to play</Badge>
                : <Badge tone="emerald">Complete</Badge>}
            </div>
            <div className="overflow-x-auto rounded-md border border-line">
              <table className="w-full text-left text-sm">
                <thead className="bg-surface-2 text-[11px] uppercase tracking-wide text-ink-2">
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
                <tbody className="divide-y divide-line-soft">
                  {rows.map((r, i) => {
                    const qualifies = advance > 0 && i < advance;
                    return (
                      <tr key={r.entryId} className={cx(qualifies && "bg-accent-teal/10")}>
                        <td className="px-3 py-2">
                          <span className={cx(
                            "inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold",
                            qualifies ? "bg-accent-teal text-white" : "text-ink-3"
                          )}>{i + 1}</span>
                        </td>
                        <td className={cx("px-3 py-2", qualifies ? "font-semibold text-accent-teal" : "text-ink")}>
                          {entryShort(entriesById[r.entryId])}
                        </td>
                        <td className="px-3 py-2 text-center font-mono text-ink-2">{r.played}</td>
                        <td className="px-3 py-2 text-center font-mono font-semibold text-ink">{r.won}</td>
                        <td className="px-3 py-2 text-center font-mono text-ink-2">{r.lost}</td>
                        <td className="px-3 py-2 text-center font-mono text-xs text-ink-2">{r.gamesFor}–{r.gamesAgainst}</td>
                        <td className="px-3 py-2 text-center font-mono text-xs text-ink-2">{r.pointsFor}–{r.pointsAgainst}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {advance > 0 && (
              <p className="mt-1.5 text-[11px] text-ink-3">Top {advance} advance to the knockout.</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
