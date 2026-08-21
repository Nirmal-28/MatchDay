import { Trophy, ClipboardList } from "lucide-react";
import { cx, entryName, entryShort, matchStageLabel, CATEGORY_META } from "../lib/engines";
import { Card, EmptyState } from "./ui/primitives";

export default function ResultsPanel({ event, matches, entriesById }) {
  const completed = matches.filter((m) => m.status === "COMPLETED" || m.status === "WALKOVER").sort((a, b) => a.round - b.round || a.match_number - b.match_number);
  const champion = event.champion_entry_id ? entriesById[event.champion_entry_id] : null;
  return (
    <div className="space-y-4">
      {champion && (
        <Card className="flex items-center gap-3 border-amber-400/30 bg-amber-400/10 p-4">
          <Trophy className="text-accent-yellow" size={28} />
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-accent-yellow">{CATEGORY_META[event.category].label} Champion</div>
            <div className="text-lg font-bold text-ink">{entryName(champion)}</div>
          </div>
        </Card>
      )}
      {completed.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No results yet" hint="Completed matches will be listed here as the tournament progresses." />
      ) : (
        <div className="overflow-x-auto rounded-md border border-line">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-2 text-[11px] uppercase tracking-wide text-ink-2">
              <tr><th className="px-3 py-2 font-medium">Round</th><th className="px-3 py-2 font-medium">Result</th><th className="px-3 py-2 font-medium">Score</th></tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {completed.map((m) => {
                const a = entriesById[m.entry_a], b = entriesById[m.entry_b];
                const winner = m.winner_entry_id === m.entry_a ? "A" : "B";
                const games = [...(m.games || [])].sort((x, y) => x.game_number - y.game_number);
                return (
                  <tr key={m.id}>
                    <td className="px-3 py-2 text-ink-2">{matchStageLabel(m, event)}</td>
                    <td className="px-3 py-2">
                      {m.is_bye ? <span className="text-ink-2">{entryShort(a)} advances (bye)</span> : (
                        <span>
                          <span className={cx(winner === "A" && "font-semibold text-accent-teal")}>{entryShort(a)}</span>
                          <span className="text-ink-3"> def. </span>
                          <span className={cx(winner === "B" && "font-semibold text-accent-teal")}>{entryShort(b)}</span>
                          {m.retired && <span className="ml-1 text-[11px] text-ink-3">(retired)</span>}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-ink-2">{games.map((g, i) => <span key={i} className="mr-1.5">{g.score_a}-{g.score_b}</span>)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
