import { useState } from "react";
import { ChevronLeft, Radio } from "lucide-react";
import { entryShort, roundLabel, BadmintonScoringEngine, toAB, CATEGORY_META } from "../lib/engines";
import { Badge, EmptyState } from "./ui/primitives";
import ScorerPanel from "./ScorerPanel";

export default function LiveScoringBoard({ matches, events, entriesById, onStart, onScore, onUndo, onRetire }) {
  const [openMatchId, setOpenMatchId] = useState(null);
  const live = matches.filter((m) => m.status === "LIVE");
  const ready = matches.filter((m) => m.status === "READY");
  const active = [...live, ...ready];
  const openMatch = matches.find((m) => m.id === openMatchId);
  const openEvent = openMatch && events.find((e) => e.id === openMatch.event_id);

  if (active.length === 0) return <EmptyState icon={Radio} title="No matches ready to score" hint="Once a schedule is generated and the tournament is started, matches ready to play will appear here." />;

  if (openMatch) {
    return (
      <div>
        <button className="mb-3 flex items-center gap-1 text-xs font-medium text-stone-500 hover:text-stone-800" onClick={() => setOpenMatchId(null)}><ChevronLeft size={14} /> All courts</button>
        <ScorerPanel
          match={openMatch} event={openEvent} entriesById={entriesById}
          onStart={onStart}
          onScore={onScore}
          onUndo={onUndo}
          onRetire={(id, side) => { onRetire(id, side); setOpenMatchId(null); }}
        />
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {active.map((m) => {
        const ev = events.find((e) => e.id === m.event_id);
        const a = entriesById[m.entry_a], b = entriesById[m.entry_b];
        const tally = BadmintonScoringEngine.gameTally(toAB(m.games));
        return (
          <button key={m.id} onClick={() => setOpenMatchId(m.id)} className="rounded-lg border border-stone-200 bg-white p-3.5 text-left shadow-sm hover:border-teal-300 hover:shadow-md transition-all">
            <div className="mb-2 flex items-center justify-between">
              <Badge tone="slate">{m.court || "Court —"}</Badge>
              {m.status === "LIVE" ? <span className="flex items-center gap-1 text-[11px] font-semibold text-red-600"><Radio size={10} className="animate-pulse" />LIVE</span> : <Badge tone="teal">Ready</Badge>}
            </div>
            <div className="text-[11px] uppercase tracking-wide text-stone-400">{CATEGORY_META[ev.category].label} · {roundLabel(m.round, ev.total_rounds)}</div>
            <div className="mt-1.5 space-y-1 text-sm">
              <div className="flex items-center justify-between"><span className="truncate font-medium text-stone-800">{entryShort(a)}</span><span className="font-mono text-stone-500">{tally.a}</span></div>
              <div className="flex items-center justify-between"><span className="truncate font-medium text-stone-800">{entryShort(b)}</span><span className="font-mono text-stone-500">{tally.b}</span></div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
