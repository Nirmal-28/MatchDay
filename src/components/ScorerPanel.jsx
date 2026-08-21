import { useState } from "react";
import { motion } from "motion/react";
import { Play, Minus, Plus, RotateCcw } from "lucide-react";
import { entryName, entryShort, matchStageLabel, BadmintonScoringEngine, toAB, CATEGORY_META } from "../lib/engines";
import { Badge, Btn, Card } from "./ui/primitives";
import { LivePulse } from "./ui/motion";

export default function ScorerPanel({ match, event, entriesById, onScore, onUndo, onRetire, onStart }) {
  const a = entriesById[match.entry_a], b = entriesById[match.entry_b];
  const games = [...(match.games || [])].sort((x, y) => x.game_number - y.game_number);
  const tally = BadmintonScoringEngine.gameTally(toAB(games));
  const current = games[games.length - 1];
  const [confirmRetire, setConfirmRetire] = useState(null);
  const isLive = match.status === "LIVE";

  const Wrapper = isLive ? "div" : Card;

  return (
    <Wrapper className={isLive ? "overflow-hidden rounded-lg border border-navy-800 bg-navy-900" : "overflow-hidden"}>
      {isLive && <div className="h-1 bg-gradient-to-r from-accent-teal via-accent-blue to-accent-purple" />}
      <div className={isLive ? "flex items-center justify-between border-b border-white/10 px-4 py-2.5" : "flex items-center justify-between border-b border-line bg-surface-2 px-4 py-2.5"}>
        <div className={isLive ? "flex items-center gap-2 text-xs text-ink-3" : "flex items-center gap-2 text-xs text-ink-2"}>
          <Badge tone={isLive ? undefined : "slate"} className={isLive ? "border-white/20 bg-white/10 text-white" : undefined}>{match.court || "Court —"}</Badge>
          <span>{CATEGORY_META[event.category].label} · {matchStageLabel(match, event)}</span>
        </div>
        {isLive && <LivePulse />}
      </div>

      {!isLive ? (
        <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
          <div className="text-sm text-ink-2">{entryShort(a)} <span className="text-ink-3">vs</span> {entryShort(b)}</div>
          <Btn icon={Play} onClick={() => onStart(match.id)}>Start match</Btn>
        </div>
      ) : (
        <div className="p-4">
          <div className="grid grid-cols-2 gap-3">
            {[["A", a], ["B", b]].map(([side, e]) => {
              const value = current ? (side === "A" ? current.score_a : current.score_b) : 0;
              return (
                <div key={side} className="flex flex-col items-center gap-2 rounded-md border border-white/10 bg-white/5 py-4">
                  <div className="px-2 text-center text-sm font-medium text-ink-2">{entryName(e)}</div>
                  <motion.div
                    key={value}
                    initial={{ scale: 1.35, opacity: 0.3 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.25, ease: "easeOut" }}
                    className="font-display text-6xl font-bold tabular-nums text-white"
                  >
                    {value}
                  </motion.div>
                  <div className="flex gap-2">
                    <button className="flex h-9 w-9 items-center justify-center rounded-md border border-white/15 text-ink-3 hover:bg-white/10 disabled:opacity-30" onClick={() => onScore(match.id, side, -1)}><Minus size={16} /></button>
                    <button className="flex h-9 w-9 items-center justify-center rounded-md bg-accent-teal text-white hover:brightness-110 disabled:opacity-30"
                      disabled={!current || !BadmintonScoringEngine.canScore(current.score_a, current.score_b, side)}
                      onClick={() => onScore(match.id, side, 1)}><Plus size={16} /></button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-3 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs text-ink-3">
              Games: <span className="font-mono font-semibold text-white">{tally.a}–{tally.b}</span>
              {games.map((g, i) => i < games.length - 1 || BadmintonScoringEngine.isGameOver(g.score_a, g.score_b) ? (
                <span key={i} className="ml-1 rounded bg-white/10 px-1.5 py-0.5 font-mono">{g.score_a}-{g.score_b}</span>
              ) : null)}
            </div>
            <div className="flex gap-2">
              <Btn size="sm" variant="ghost" icon={RotateCcw} className="text-ink-3 hover:bg-white/10 hover:text-white" onClick={() => onUndo(match.id)}>Undo game</Btn>
              {confirmRetire ? (
                <div className="flex items-center gap-1 text-xs">
                  <span className="text-ink-3">{entryShort(confirmRetire === "A" ? a : b)} retires?</span>
                  <Btn size="sm" variant="danger" onClick={() => { onRetire(match.id, confirmRetire); setConfirmRetire(null); }}>Confirm</Btn>
                  <Btn size="sm" variant="ghost" className="text-ink-3 hover:bg-white/10 hover:text-white" onClick={() => setConfirmRetire(null)}>Cancel</Btn>
                </div>
              ) : (
                <div className="flex gap-1">
                  <Btn size="sm" variant="ghost" className="text-ink-3 hover:bg-white/10 hover:text-white" onClick={() => setConfirmRetire("A")}>A retires</Btn>
                  <Btn size="sm" variant="ghost" className="text-ink-3 hover:bg-white/10 hover:text-white" onClick={() => setConfirmRetire("B")}>B retires</Btn>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Wrapper>
  );
}
