import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { ChevronLeft, Radio, Trophy } from "lucide-react";
import { entryName, entryShort, matchStageLabel, BadmintonScoringEngine, toAB, CATEGORY_META } from "../lib/engines";
import { Badge, EmptyState } from "./ui/primitives";
import { LivePulse } from "./ui/motion";
import ScorerPanel from "./ScorerPanel";

function MatchComplete({ match, entriesById }) {
  const winner = entriesById[match.winner_entry_id];
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex flex-col items-center gap-2 rounded-lg bg-navy-900 px-4 py-12 text-center"
    >
      <Trophy className="text-accent-yellow" size={28} />
      <div className="text-xs font-semibold uppercase tracking-widest text-accent-teal">Match complete</div>
      <div className="text-lg font-bold text-white">{entryName(winner)} wins</div>
    </motion.div>
  );
}

export default function LiveScoringBoard({ matches, events, entriesById, onStart, onScore, onUndo, onRetire }) {
  const [openMatchId, setOpenMatchId] = useState(null);
  const live = matches.filter((m) => m.status === "LIVE");
  const ready = matches.filter((m) => m.status === "READY");
  const active = [...live, ...ready];
  const openMatch = matches.find((m) => m.id === openMatchId);
  const openEvent = openMatch && events.find((e) => e.id === openMatch.event_id);
  const justFinished = openMatch && (openMatch.status === "COMPLETED" || openMatch.status === "WALKOVER");

  useEffect(() => {
    if (!justFinished) return;
    const t = setTimeout(() => setOpenMatchId(null), 2200);
    return () => clearTimeout(t);
  }, [justFinished, openMatchId]);

  if (openMatch) {
    return (
      <div>
        <button className="mb-3 flex items-center gap-1 text-xs font-medium text-stone-500 hover:text-stone-800" onClick={() => setOpenMatchId(null)}><ChevronLeft size={14} /> All courts</button>
        {justFinished ? (
          <MatchComplete match={openMatch} entriesById={entriesById} />
        ) : (
          <ScorerPanel
            match={openMatch} event={openEvent} entriesById={entriesById}
            onStart={onStart}
            onScore={onScore}
            onUndo={onUndo}
            onRetire={(id, side) => { onRetire(id, side); setOpenMatchId(null); }}
          />
        )}
      </div>
    );
  }

  if (active.length === 0) return <EmptyState icon={Radio} title="Nothing scheduled yet" hint="Once a schedule is generated and the tournament is started, matches ready to play will appear here." />;

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
              {m.status === "LIVE" ? <LivePulse /> : <Badge tone="teal">Ready</Badge>}
            </div>
            <div className="text-[11px] uppercase tracking-wide text-stone-400">{CATEGORY_META[ev.category].label} · {matchStageLabel(m, ev)}</div>
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
