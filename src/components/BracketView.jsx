import { motion } from "motion/react";
import { Radio, Swords } from "lucide-react";
import { cx, roundLabel, entryShort, BadmintonScoringEngine, toAB, MATCH_STATUS_META } from "../lib/engines";
import { Badge, EmptyState } from "./ui/primitives";

export default function BracketView({ event, matches, entriesById }) {
  const rounds = event.total_rounds;
  if (!rounds) return <EmptyState icon={Swords} title="No draw yet" hint="Generate the draw to see the bracket here." />;
  const byRound = Array.from({ length: rounds }, (_, i) => matches.filter((m) => m.round === i + 1).sort((a, b) => a.match_number - b.match_number));

  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex min-w-max gap-8 px-1 py-2">
        {byRound.map((roundMatches, ri) => (
          <div key={ri} className="flex flex-col justify-around gap-6" style={{ minWidth: 210 }}>
            <div className="mb-1 text-center text-[11px] font-semibold uppercase tracking-widest text-ink-3">{roundLabel(ri + 1, rounds)}</div>
            <div className="flex flex-1 flex-col justify-around gap-6">
              {roundMatches.map((m) => <BracketMatch key={m.id} match={m} entriesById={entriesById} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BracketMatch({ match, entriesById }) {
  const a = entriesById[match.entry_a], b = entriesById[match.entry_b];
  const games = toAB(match.games);
  const tally = BadmintonScoringEngine.gameTally(games);
  const meta = MATCH_STATUS_META[match.status];
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="rounded-md border border-line bg-surface shadow-sm"
    >
      <div className="flex items-center justify-between border-b border-line-soft px-2 py-1">
        <span className="font-mono text-[10px] text-ink-3">#{match.match_number}</span>
        <Badge tone={meta.tone}>{match.status === "LIVE" ? <><Radio size={10} className="animate-pulse" /> Live</> : meta.label}</Badge>
      </div>
      {[["A", a], ["B", b]].map(([side, e]) => {
        const isWinner = match.winner_entry_id && match.winner_entry_id === e?.id;
        return (
          <motion.div
            key={side}
            animate={{ backgroundColor: isWinner ? "rgba(20,184,166,0.08)" : "rgba(0,0,0,0)" }}
            transition={{ duration: 0.5 }}
            className={cx("flex items-center justify-between gap-2 px-2.5 py-1.5 text-sm", isWinner ? "font-semibold text-accent-teal" : "text-ink-2")}
          >
            <span className="flex items-center gap-1.5 truncate">
              {isWinner && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-teal" />}
              {e ? entryShort(e) : match.is_bye ? "—" : "TBD"}
            </span>
            {games.length > 0 && <span className="font-mono text-xs text-ink-3">{side === "A" ? tally.a : tally.b}</span>}
          </motion.div>
        );
      })}
    </motion.div>
  );
}
