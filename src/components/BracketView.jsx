import { Swords } from "lucide-react";
import { cx, roundLabel, entryShort, BadmintonScoringEngine, toAB, MATCH_STATUS_META } from "../lib/engines";
import { Badge, EmptyState } from "./ui/primitives";
import { StatusPill } from "./ui/md";
import { Rise } from "./ui/reveal";

/* ═══════════════════════════════════════════════════════════════════════
   BRACKET
   ═══════════════════════════════════════════════════════════════════════

   A draw is a story about progression, and a spreadsheet cannot tell it.
   The three questions a bracket has to answer instantly are:

       WHO WON?          the winner's row is the only lit one
       WHO PLAYS NEXT?   connector lines physically join a match to the one
                         it feeds, and the connector is lit once the feeding
                         match has produced a winner
       HOW FAR AM I?     round headers, with the final named as the final

   The connectors are the addition that turns this from a grid into a
   bracket. They are drawn in CSS (two borders per match, an elbow), not
   SVG: no measuring pass, no resize listener, and they survive the column
   scrolling horizontally on a phone.

   A LIT connector means the result is in and the winner has advanced. That
   is the "bracket advances" moment — carried by state and colour rather
   than by an animation that a spectator arriving late would never see.
   ══════════════════════════════════════════════════════════════════════ */

export default function BracketView({ event, matches, entriesById }) {
  const rounds = event.total_rounds;
  if (!rounds) return <EmptyState icon={Swords} title="No draw yet" hint="Generate the draw to see the bracket here." />;
  const byRound = Array.from({ length: rounds }, (_, i) =>
    matches.filter((m) => m.round === i + 1).sort((a, b) => a.match_number - b.match_number)
  );

  return (
    <div className="md-scroll overflow-x-auto pb-2">
      <div className="flex min-w-max gap-0 px-1 py-2">
        {byRound.map((roundMatches, ri) => {
          const isFinal = ri === rounds - 1;
          return (
            <div key={ri} className="flex flex-col" style={{ minWidth: 232 }}>
              <div
                className={cx(
                  "mb-3 text-center text-[11px] font-bold uppercase tracking-widest",
                  isFinal ? "text-accent-teal" : "text-ink-3"
                )}
              >
                {roundLabel(ri + 1, rounds)}
              </div>

              <div className="flex flex-1 flex-col justify-around gap-6 pr-6">
                {roundMatches.map((m, mi) => (
                  <BracketMatch
                    key={m.id}
                    match={m}
                    entriesById={entriesById}
                    // The elbow reaches right toward the next round. The last
                    // column has nothing to feed, so it draws none.
                    connector={!isFinal}
                    // Pairs of matches converge on one parent: the upper of
                    // each pair elbows down, the lower elbows up.
                    down={mi % 2 === 0}
                    delay={Math.min(ri, 6) * 0.05}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BracketMatch({ match, entriesById, connector, down, delay }) {
  const a = entriesById[match.entry_a], b = entriesById[match.entry_b];
  const games = toAB(match.games);
  const tally = BadmintonScoringEngine.gameTally(games);
  const meta = MATCH_STATUS_META[match.status];
  const isLive = match.status === "LIVE";
  // A decided match is what lights its connector — the winner has somewhere
  // to go, and the line says so.
  const decided = !!match.winner_entry_id;
  const lineColor = decided ? "var(--color-accent-teal)" : "var(--color-line)";

  return (
    <Rise delay={delay} className="relative">
      <div
        className={cx(
          "md-card md-edge overflow-hidden",
          isLive && "md-live-surface"
        )}
        style={{ "--md-edge": isLive ? "var(--color-live)" : decided ? "var(--color-accent-teal)" : "var(--color-line)" }}
      >
        <div className="flex items-center justify-between border-b border-line-soft px-2.5 py-1.5">
          <span className="md-score text-[10px] text-ink-3">#{match.match_number}</span>
          {isLive ? <StatusPill status="live" /> : <Badge tone={meta.tone}>{meta.label}</Badge>}
        </div>

        {[["A", a], ["B", b]].map(([side, e]) => {
          const isWinner = match.winner_entry_id && match.winner_entry_id === e?.id;
          const isLoser = decided && e && !isWinner;
          return (
            <div
              key={side}
              className={cx(
                "flex items-center justify-between gap-2 px-2.5 py-2 text-sm transition-colors duration-500",
                isWinner ? "bg-accent-teal/[0.08] font-semibold text-accent-teal"
                  : isLoser ? "text-ink-3"
                  : "text-ink-2"
              )}
            >
              <span className="flex items-center gap-1.5 truncate">
                {isWinner && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-teal" />}
                {e ? entryShort(e) : match.is_bye ? "—" : "TBD"}
              </span>
              {games.length > 0 && (
                <span className={cx("md-score text-xs", isWinner ? "text-accent-teal" : "text-ink-3")}>
                  {side === "A" ? tally.a : tally.b}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* The elbow into the next round. Pure CSS: a horizontal stub out of
          the card's right edge, then a vertical run toward the midpoint the
          paired match shares. Lit once this match has a winner. */}
      {connector && (
        <span aria-hidden="true">
          <span
            className="absolute top-1/2 h-px transition-colors duration-500"
            style={{ right: -24, width: 24, background: lineColor }}
          />
          <span
            className="absolute w-px transition-colors duration-500"
            style={{
              right: -24,
              background: lineColor,
              top: down ? "50%" : "auto",
              bottom: down ? "auto" : "50%",
              height: "calc(50% + 12px)",
            }}
          />
        </span>
      )}
    </Rise>
  );
}
