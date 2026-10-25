import { ListOrdered } from "lucide-react";
import { cx, entryShort, computeStandings, parseGroupLabel, groupDisplayName, isVoidMatch, overallStandings } from "../lib/engines";

// One fixture line under a group table: who plays whom, in playing order,
// with the score once it is in. Organizers asked "who should they play?" —
// the table alone never said.
function Fixture({ m, i, entriesById }) {
  const done = m.status === "COMPLETED" || m.status === "WALKOVER";
  const score = isVoidMatch(m) ? "not played"
    : [...(m.games || [])].sort((x, y) => x.game_number - y.game_number).map((g) => `${g.score_a}–${g.score_b}`).join("  ");
  const won = (id) => done && m.winner_entry_id === id;
  return (
    <li className="flex items-baseline gap-2 px-3 py-1.5 text-sm">
      <span className="w-5 shrink-0 text-right font-mono text-[11px] text-ink-3">{i + 1}</span>
      <span className="min-w-0 flex-1">
        <span className={cx(won(m.entry_a) ? "font-semibold text-ink" : "text-ink-2")}>{entryShort(entriesById[m.entry_a])}</span>
        <span className="px-1.5 text-ink-3">vs</span>
        <span className={cx(won(m.entry_b) ? "font-semibold text-ink" : "text-ink-2")}>{entryShort(entriesById[m.entry_b])}</span>
      </span>
      <span className={cx("shrink-0 font-mono text-xs", done ? "text-ink-2" : m.status === "LIVE" ? "text-red-300" : "text-ink-3")}>
        {done ? score : m.status === "LIVE" ? "live" : "to play"}
      </span>
    </li>
  );
}
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

  const overall = latestStage >= 2 ? overallStandings(grouped) : [];

  return (
    <div className="space-y-5">
      {overall.length > 0 && (
        <div>
          <div className="mb-2 flex items-center gap-2">
            <div className="md-eyebrow">Overall · all stages added together</div>
            <Badge tone="teal">Top 8 highlighted</Badge>
          </div>
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-2 text-[11px] uppercase tracking-wide text-ink-2">
                <tr>
                  <th className="px-3 py-2 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">Pair</th>
                  <th className="px-3 py-2 font-medium text-center">P</th>
                  <th className="px-3 py-2 font-medium text-center">W</th>
                  <th className="px-3 py-2 font-medium text-center">L</th>
                  <th className="px-3 py-2 font-medium text-center">Pts</th>
                  <th className="px-3 py-2 font-medium text-center">+/-</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {overall.map((r, i) => {
                  const top = i < 8;
                  const diff = r.pointsFor - r.pointsAgainst;
                  return (
                    <tr key={r.entryId} className={cx(top && "bg-accent-teal/10")}>
                      <td className="px-3 py-2">
                        <span className={cx("inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold", top ? "bg-accent-teal text-white" : "text-ink-3")}>{i + 1}</span>
                      </td>
                      <td className={cx("px-3 py-2", top ? "font-semibold text-accent-teal" : "text-ink")}>{entryShort(entriesById[r.entryId])}</td>
                      <td className="px-3 py-2 text-center font-mono text-ink-2">{r.played}</td>
                      <td className="px-3 py-2 text-center font-mono font-semibold text-ink">{r.won}</td>
                      <td className="px-3 py-2 text-center font-mono text-ink-2">{r.lost}</td>
                      <td className="px-3 py-2 text-center font-mono text-xs text-ink-2">{r.pointsFor}–{r.pointsAgainst}</td>
                      <td className="px-3 py-2 text-center font-mono text-xs text-ink">{diff > 0 ? "+" : ""}{diff}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-1.5 text-[11px] text-ink-3">Ranked by wins, then point difference. Pairs who played fewer matches (a skipped match) have fewer chances to win.</p>
        </div>
      )}
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
            <details className="mt-2 rounded-md border border-line" open={remaining > 0}>
              <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-ink-2">Matches — who plays whom, in order</summary>
              <ol className="divide-y divide-line-soft border-t border-line-soft">
                {[...gm].sort((x, y) => (x.match_number ?? 0) - (y.match_number ?? 0)).map((m, i) => (
                  <Fixture key={m.id} m={m} i={i} entriesById={entriesById} />
                ))}
              </ol>
            </details>
          </div>
        );
      })}
    </div>
  );
}
