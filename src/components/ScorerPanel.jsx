import { useState } from "react";
import { Play, Radio, Minus, Plus, RotateCcw } from "lucide-react";
import { entryName, entryShort, roundLabel, BadmintonScoringEngine, toAB, CATEGORY_META } from "../lib/engines";
import { Badge, Btn, Card } from "./ui/primitives";

export default function ScorerPanel({ match, event, entriesById, onScore, onUndo, onRetire, onStart }) {
  const a = entriesById[match.entry_a], b = entriesById[match.entry_b];
  const games = [...(match.games || [])].sort((x, y) => x.game_number - y.game_number);
  const tally = BadmintonScoringEngine.gameTally(toAB(games));
  const current = games[games.length - 1];
  const [confirmRetire, setConfirmRetire] = useState(null);

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-stone-200 bg-stone-50 px-4 py-2.5">
        <div className="flex items-center gap-2 text-xs text-stone-500">
          <Badge tone="slate">{match.court || "Court —"}</Badge>
          <span>{CATEGORY_META[event.category].label} · {roundLabel(match.round, event.total_rounds)}</span>
        </div>
        {match.status === "LIVE" && <span className="flex items-center gap-1 text-xs font-semibold text-red-600"><Radio size={12} className="animate-pulse" /> LIVE</span>}
      </div>

      {match.status !== "LIVE" ? (
        <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
          <div className="text-sm text-stone-600">{entryShort(a)} <span className="text-stone-300">vs</span> {entryShort(b)}</div>
          <Btn icon={Play} onClick={() => onStart(match.id)}>Start match</Btn>
        </div>
      ) : (
        <div className="p-4">
          <div className="grid grid-cols-2 gap-3">
            {[["A", a], ["B", b]].map(([side, e]) => (
              <div key={side} className="flex flex-col items-center gap-2 rounded-md border border-stone-200 py-4">
                <div className="px-2 text-center text-sm font-medium text-stone-800">{entryName(e)}</div>
                <div className="font-mono text-5xl font-bold tabular-nums text-stone-900">{current ? (side === "A" ? current.score_a : current.score_b) : 0}</div>
                <div className="flex gap-2">
                  <button className="flex h-9 w-9 items-center justify-center rounded-md border border-stone-300 text-stone-500 hover:bg-stone-50 disabled:opacity-30" onClick={() => onScore(match.id, side, -1)}><Minus size={16} /></button>
                  <button className="flex h-9 w-9 items-center justify-center rounded-md bg-teal-700 text-white hover:bg-teal-800 disabled:opacity-30"
                    disabled={!current || !BadmintonScoringEngine.canScore(current.score_a, current.score_b, side)}
                    onClick={() => onScore(match.id, side, 1)}><Plus size={16} /></button>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs text-stone-500">
              Games: <span className="font-mono font-semibold text-stone-700">{tally.a}–{tally.b}</span>
              {games.map((g, i) => i < games.length - 1 || BadmintonScoringEngine.isGameOver(g.score_a, g.score_b) ? (
                <span key={i} className="ml-1 rounded bg-stone-100 px-1.5 py-0.5 font-mono">{g.score_a}-{g.score_b}</span>
              ) : null)}
            </div>
            <div className="flex gap-2">
              <Btn size="sm" variant="ghost" icon={RotateCcw} onClick={() => onUndo(match.id)}>Undo game</Btn>
              {confirmRetire ? (
                <div className="flex items-center gap-1 text-xs">
                  <span className="text-stone-500">{entryShort(confirmRetire === "A" ? a : b)} retires?</span>
                  <Btn size="sm" variant="danger" onClick={() => { onRetire(match.id, confirmRetire); setConfirmRetire(null); }}>Confirm</Btn>
                  <Btn size="sm" variant="ghost" onClick={() => setConfirmRetire(null)}>Cancel</Btn>
                </div>
              ) : (
                <div className="flex gap-1">
                  <Btn size="sm" variant="ghost" onClick={() => setConfirmRetire("A")}>A retires</Btn>
                  <Btn size="sm" variant="ghost" onClick={() => setConfirmRetire("B")}>B retires</Btn>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
