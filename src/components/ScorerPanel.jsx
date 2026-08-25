import { useState } from "react";
import { Play, Minus, Plus, RotateCcw, Flag, Settings2, X, Trophy } from "lucide-react";
import { entryName, entryShort, matchStageLabel, BadmintonScoringEngine, toAB, CATEGORY_META } from "../lib/engines";
import { Badge, Btn, Card } from "./ui/primitives";
import { LivePulse } from "./ui/motion";
import { raiseDispute } from "../lib/repository";

const DISPUTE_TYPES = [
  { key: "SCORE", label: "Score is wrong" },
  { key: "WINNER", label: "Winner is wrong" },
  { key: "OPPONENT", label: "Wrong opponent" },
  { key: "OTHER", label: "Other issue" },
];

function ReportIssue({ match, tournamentId }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("SCORE");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  if (!tournamentId) return null;

  const submit = async () => {
    if (!description.trim()) return;
    setSaving(true);
    try { await raiseDispute(match.id, tournamentId, type, description.trim()); setDone(true); }
    finally { setSaving(false); }
  };

  if (!open) {
    return <button onClick={() => setOpen(true)} className="flex items-center gap-1 text-[11px] text-ink-3 hover:text-amber-400"><Flag size={11} /> Report an issue</button>;
  }
  return (
    <div className="mt-2 rounded-md border border-line bg-surface-2 p-2.5 text-xs">
      {done ? (
        <div className="text-emerald-400">Reported — the organizer will review it.</div>
      ) : (
        <>
          <select className="mb-1.5 w-full rounded border border-line bg-surface px-2 py-1 text-ink" value={type} onChange={(e) => setType(e.target.value)}>
            {DISPUTE_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
          <textarea className="mb-1.5 w-full resize-none rounded border border-line bg-surface px-2 py-1 text-ink" rows={2}
            placeholder="What happened?" value={description} onChange={(e) => setDescription(e.target.value)} />
          <div className="flex justify-end gap-1.5">
            <button className="text-ink-3" onClick={() => setOpen(false)}>Cancel</button>
            <button className="font-semibold text-amber-400 disabled:opacity-40" disabled={saving || !description.trim()} onClick={submit}>Submit</button>
          </div>
        </>
      )}
    </div>
  );
}

export default function ScorerPanel({ match, event, entriesById, onScore, onUndo, onRetire, onStart, tournamentId }) {
  const a = entriesById[match.entry_a], b = entriesById[match.entry_b];
  const games = [...(match.games || [])].sort((x, y) => x.game_number - y.game_number);
  const tally = BadmintonScoringEngine.gameTally(toAB(games));
  const current = games[games.length - 1];
  const [confirmRetire, setConfirmRetire] = useState(null);
  const [confirmUndo, setConfirmUndo] = useState(false);
  const [correctionsOpen, setCorrectionsOpen] = useState(false);
  const isLive = match.status === "LIVE";
  const isDone = ["COMPLETED", "WALKOVER"].includes(match.status);
  const winner = match.winner_entry_id === match.entry_a ? a : match.winner_entry_id === match.entry_b ? b : null;

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

      {isDone ? (
        /* A finished match must be unmistakable — a scorer glancing down
           should never wonder whether the last point registered. */
        <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
          <Trophy size={28} className="text-accent-teal" />
          <div className="md-eyebrow text-accent-teal">
            {match.retired ? "Match ended — retirement" : "Match complete"}
          </div>
          <div className="md-display text-3xl text-ink">{entryShort(winner) || "Result recorded"}</div>
          <div className="md-score text-5xl text-ink">{tally.a}–{tally.b}</div>
          <div className="flex flex-wrap justify-center gap-1.5">
            {games.map((g, i) => (
              <span key={i} className="md-score rounded bg-surface-2 px-2 py-1 text-sm text-ink-2">{g.score_a}–{g.score_b}</span>
            ))}
          </div>
          <p className="mt-1 max-w-xs text-[11px] text-ink-3">
            This result is published. Corrections now go through the organizer — report an issue below.
          </p>
          <ReportIssue match={match} tournamentId={tournamentId || event?.tournament_id} />
        </div>
      ) : !isLive ? (
        <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
          <div className="text-sm text-ink-2">{entryShort(a)} <span className="text-ink-3">vs</span> {entryShort(b)}</div>
          <Btn icon={Play} className="h-14 px-8 text-base" onClick={() => onStart(match.id)}>Start match</Btn>
        </div>
      ) : (
        <div className="p-3">
          {/* Courtside layout: the two things a scorer does a hundred times an
              hour are "point to A" and "point to B", so those get the whole
              panel. Everything corrective is one deliberate tap further away —
              a mis-tap should never silently change a score. */}
          <div className="grid grid-cols-2 gap-2.5">
            {[["A", a], ["B", b]].map(([side, e]) => {
              const value = current ? (side === "A" ? current.score_a : current.score_b) : 0;
              const canScore = !!current && BadmintonScoringEngine.canScore(current.score_a, current.score_b, side);
              const leading = current && (side === "A" ? current.score_a > current.score_b : current.score_b > current.score_a);
              return (
                <div className={`flex flex-col rounded-xl border ${leading ? "border-accent-teal/40 bg-accent-teal/[0.06]" : "border-white/10 bg-white/5"}`} key={side}>
                  <div className="truncate px-2 pt-3 text-center text-sm font-semibold text-white" title={entryName(e)}>
                    {entryShort(e)}
                  </div>
                  {/* Keyed on the value, so React remounts the node when a
                      point lands and the one-shot bump replays. Moved off
                      Motion onto the shared `.md-bump` class: this is the
                      one screen where a scorer taps twice a second, and a
                      CSS animation costs nothing per tap. Sized fluidly so
                      the number fills a 390px phone and a tablet alike. */}
                  <div
                    key={value}
                    className="md-bump md-score py-1 text-center text-white"
                    style={{ fontSize: "clamp(4rem, 22vw, 7rem)" }}
                  >
                    {value}
                  </div>

                  {/* The primary target, and by far the largest control on
                      the screen: full width of its column, 88px tall, which
                      clears the 44px minimum with room for a gloved or wet
                      thumb in a hall. */}
                  <button
                    className="m-2 flex items-center justify-center gap-1.5 rounded-lg bg-accent-teal text-lg font-bold uppercase tracking-wide text-navy-950 transition-transform active:scale-[0.97] disabled:opacity-25"
                    style={{ height: "5.5rem" }}
                    disabled={!canScore}
                    onClick={() => onScore(match.id, side, 1)}
                    aria-label={`Point to ${entryShort(e)}`}
                  >
                    <Plus size={24} /> Point
                  </button>
                </div>
              );
            })}
          </div>

          {/* Game tally stays visible without scrolling. */}
          <div className="mt-2.5 flex flex-wrap items-center justify-center gap-1.5 text-xs text-ink-3">
            <span>Games</span>
            <span className="md-score text-base text-white">{tally.a}–{tally.b}</span>
            {games.map((g, i) => i < games.length - 1 || BadmintonScoringEngine.isGameOver(g.score_a, g.score_b) ? (
              <span key={i} className="md-score rounded bg-white/10 px-1.5 py-0.5">{g.score_a}–{g.score_b}</span>
            ) : null)}
          </div>

          {/* Corrections are collapsed by default so a stray tap cannot undo a
              game or retire a player. */}
          <div className="mt-2.5 border-t border-white/10 pt-2.5">
            {!correctionsOpen ? (
              <button
                onClick={() => setCorrectionsOpen(true)}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg py-2.5 text-xs font-medium text-ink-3 hover:bg-white/5 hover:text-white"
              >
                <Settings2 size={13} /> Corrections &amp; retirement
              </button>
            ) : (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">Corrections</span>
                  <button onClick={() => { setCorrectionsOpen(false); setConfirmRetire(null); setConfirmUndo(false); }}
                    className="rounded p-1 text-ink-3 hover:bg-white/10 hover:text-white" aria-label="Close corrections">
                    <X size={14} />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {[["A", a], ["B", b]].map(([side, e]) => (
                    <button key={side}
                      className="flex h-12 items-center justify-center gap-1.5 rounded-lg border border-white/15 text-sm text-ink-2 hover:bg-white/10 hover:text-white disabled:opacity-30"
                      disabled={!current || (side === "A" ? current.score_a : current.score_b) <= 0}
                      onClick={() => onScore(match.id, side, -1)}
                    >
                      <Minus size={16} /> {entryShort(e)}
                    </button>
                  ))}
                </div>

                {confirmUndo ? (
                  <div className="flex items-center gap-2 rounded-lg border border-amber-400/30 bg-amber-400/10 p-2.5">
                    <span className="flex-1 text-xs text-amber-200">Undo the last game?</span>
                    <Btn size="sm" variant="danger" onClick={() => { onUndo(match.id); setConfirmUndo(false); }}>Undo</Btn>
                    <Btn size="sm" variant="ghost" className="text-ink-3 hover:bg-white/10 hover:text-white" onClick={() => setConfirmUndo(false)}>Cancel</Btn>
                  </div>
                ) : (
                  <Btn size="sm" variant="ghost" icon={RotateCcw} className="w-full justify-center text-ink-3 hover:bg-white/10 hover:text-white"
                    onClick={() => setConfirmUndo(true)}>Undo last game</Btn>
                )}

                {confirmRetire ? (
                  <div className="flex items-center gap-2 rounded-lg border border-red-400/30 bg-red-400/10 p-2.5">
                    <span className="flex-1 text-xs text-red-200">{entryShort(confirmRetire === "A" ? a : b)} retires — this ends the match.</span>
                    <Btn size="sm" variant="danger" onClick={() => { onRetire(match.id, confirmRetire); setConfirmRetire(null); }}>Confirm</Btn>
                    <Btn size="sm" variant="ghost" className="text-ink-3 hover:bg-white/10 hover:text-white" onClick={() => setConfirmRetire(null)}>Cancel</Btn>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <Btn size="sm" variant="ghost" className="justify-center text-ink-3 hover:bg-white/10 hover:text-white" onClick={() => setConfirmRetire("A")}>
                      {entryShort(a)} retires
                    </Btn>
                    <Btn size="sm" variant="ghost" className="justify-center text-ink-3 hover:bg-white/10 hover:text-white" onClick={() => setConfirmRetire("B")}>
                      {entryShort(b)} retires
                    </Btn>
                  </div>
                )}

                <ReportIssue match={match} tournamentId={tournamentId || event?.tournament_id} />
              </div>
            )}
          </div>
        </div>
      )}
    </Wrapper>
  );
}
