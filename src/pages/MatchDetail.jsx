import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, MapPin, Clock, Radio, Swords, Gavel, ClipboardList, ArrowRight, Trophy } from "lucide-react";
import {
  cx, fmtDateTime, fmtDuration, relativeTime, entryName, entryShort, divisionLabel, matchStageLabel,
  BadmintonScoringEngine, toAB, MATCH_STATUS_META,
} from "../lib/engines";
import { getMatchDetail, subscribeToMatch } from "../lib/repository";
import { Badge, Card, EmptyState } from "../components/ui/primitives";
import { BrandLoader, LivePulse } from "../components/ui/motion";
import { useDocumentMeta } from "../lib/useDocumentMeta";

// One side of the match: name(s), live or final score, winner marker. Declared
// at module level rather than inside the page so it keeps its identity across
// re-renders (this page re-renders on every realtime score change).
function Side({ entry, side, won, showLive, showFinal, liveScore, finalGames }) {
  return (
    <div className={cx(
      "flex items-center justify-between gap-3 rounded-lg border px-4 py-3",
      won ? "border-accent-teal/50 bg-accent-teal/[0.08]" : "border-line bg-surface-2/50"
    )}>
      <div className="min-w-0">
        <div className={cx("truncate text-base font-semibold", won ? "text-accent-teal" : "text-ink")}>
          {entryName(entry) || "TBD"}
        </div>
        {entry?.entry_players?.length > 1 && (
          <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-ink-3">
            {entry.entry_players.map((p) => (
              p.player_id
                ? <Link key={p.id || p.name} to={`/p/${p.player_id}`} className="hover:text-accent-teal">{p.name}</Link>
                : <span key={p.name}>{p.name}</span>
            ))}
          </div>
        )}
        {entry?.entry_players?.length === 1 && entry.entry_players[0].player_id && (
          <Link to={`/p/${entry.entry_players[0].player_id}`} className="text-[11px] text-ink-3 hover:text-accent-teal">
            View profile
          </Link>
        )}
      </div>
      <div className="shrink-0 text-right">
        {showLive && <div className="font-display text-3xl font-bold tabular-nums text-ink">{liveScore ?? 0}</div>}
        {showFinal && <div className="font-display text-3xl font-bold tabular-nums text-ink">{finalGames}</div>}
        {won && <Badge tone="emerald" className="mt-1">Winner</Badge>}
        <span className="sr-only">{side}</span>
      </div>
    </div>
  );
}

// One match, readable by anyone who can read the tournament. Organizers and
// staff see the same page with a little more on it (officials, a link into
// the control center) — the difference comes from RLS, not from a second
// implementation.
export default function MatchDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useDocumentMeta({ title: data ? "Match detail" : undefined });

  const load = useCallback(async () => {
    try { setData(await getMatchDetail(id)); }
    catch (e) { setError(e.message); }
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => subscribeToMatch(id, load), [id, load]);

  if (error) return <EmptyState icon={Swords} title="Match not found" hint="This link may be wrong, or the tournament isn't published yet." />;
  if (!data) return <BrandLoader />;

  const { match, event, tournament, entriesById, officials, feeders, nextMatch } = data;
  const a = entriesById[match.entry_a];
  const b = entriesById[match.entry_b];
  const games = [...(match.games || [])].sort((x, y) => x.game_number - y.game_number);
  const tally = BadmintonScoringEngine.gameTally(toAB(games));
  const isLive = match.status === "LIVE";
  const isDone = ["COMPLETED", "WALKOVER"].includes(match.status);
  const winnerSide = match.winner_entry_id === match.entry_a ? "A" : match.winner_entry_id === match.entry_b ? "B" : null;
  const current = games[games.length - 1];
  const durationMins = match.started_at && match.completed_at
    ? Math.round((new Date(match.completed_at) - new Date(match.started_at)) / 60000)
    : null;

  const sideProps = (side) => ({
    side,
    won: winnerSide === side,
    showLive: isLive,
    showFinal: isDone,
    liveScore: side === "A" ? current?.score_a : current?.score_b,
    finalGames: side === "A" ? tally.a : tally.b,
  });

  return (
    <div className="mx-auto max-w-3xl">
      <button className="mb-3 flex items-center gap-1 text-xs font-medium text-ink-2 hover:text-ink" onClick={() => navigate(-1)}>
        <ChevronLeft size={14} /> Back
      </button>

      {/* Header */}
      <div className="mb-4 rounded-2xl border border-line bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={MATCH_STATUS_META[match.status]?.tone ?? "slate"}>
                {MATCH_STATUS_META[match.status]?.label ?? match.status}
              </Badge>
              {isLive && <LivePulse />}
              {match.retired && <Badge tone="amber">Retired</Badge>}
              {match.is_bye && <Badge tone="slate">Bye</Badge>}
            </div>
            <h1 className="mt-2 text-lg font-bold text-ink">{matchStageLabel(match, event)}</h1>
            <div className="mt-0.5 text-sm text-ink-2">{divisionLabel(event)}</div>
            {tournament && (
              <Link to={tournament.slug ? `/t/${tournament.slug}` : "#"} className="mt-1 inline-block text-xs font-medium text-accent-teal hover:underline">
                {tournament.name}
              </Link>
            )}
          </div>
          <div className="text-right text-xs text-ink-2">
            <div className="flex items-center justify-end gap-1">
              <Clock size={12} />
              {match.scheduled_at ? fmtDateTime(match.scheduled_at) : "Time TBD"}
            </div>
            {match.scheduled_at && !isDone && (
              <div className="mt-0.5 text-accent-teal">{relativeTime(match.scheduled_at)}</div>
            )}
            <div className="mt-1 flex items-center justify-end gap-1">
              <MapPin size={12} />{match.court || match.courts?.name || "Court TBD"}
            </div>
          </div>
        </div>
      </div>

      {/* Sides + score */}
      <div className="mb-4 space-y-2">
        <Side entry={a} {...sideProps("A")} />
        <div className="text-center text-[11px] font-semibold uppercase tracking-widest text-ink-3">versus</div>
        <Side entry={b} {...sideProps("B")} />
      </div>

      {/* Game-by-game */}
      {games.length > 0 && (
        <Card className="mb-4 p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-2">Game by game</div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-ink-3">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">Side</th>
                  {games.map((g) => <th key={g.id} className="px-2 py-1.5 text-center font-medium">Game {g.game_number}</th>)}
                  <th className="px-2 py-1.5 text-center font-medium">Games</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {[["A", a, tally.a], ["B", b, tally.b]].map(([side, entry, won]) => (
                  <tr key={side} className={winnerSide === side ? "text-accent-teal" : "text-ink-2"}>
                    <td className="truncate py-2 pr-3 font-medium">{entryShort(entry) || "TBD"}</td>
                    {games.map((g) => {
                      const mine = side === "A" ? g.score_a : g.score_b;
                      const theirs = side === "A" ? g.score_b : g.score_a;
                      const tookIt = BadmintonScoringEngine.gameWinnerSide(g.score_a, g.score_b) === side;
                      return (
                        <td key={g.id} className={cx("px-2 py-2 text-center font-mono tabular-nums", tookIt && "font-bold text-ink")}>
                          {mine}
                          <span className="sr-only"> of {mine + theirs}</span>
                        </td>
                      );
                    })}
                    <td className="px-2 py-2 text-center font-mono font-bold tabular-nums">{won}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {durationMins !== null && (
            <div className="mt-2 text-[11px] text-ink-3">Match duration {fmtDuration(durationMins)}</div>
          )}
        </Card>
      )}

      {/* Officials + progression */}
      <div className="grid gap-4 sm:grid-cols-2">
        {(officials?.scorer || officials?.referee) && (
          <Card className="p-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-2">Officials</div>
            <div className="space-y-1.5 text-sm">
              {officials.referee && (
                <div className="flex items-center gap-2 text-ink-2">
                  <Gavel size={13} className="text-ink-3" /> Referee <span className="text-ink">{officials.referee.display_name}</span>
                </div>
              )}
              {officials.scorer && (
                <div className="flex items-center gap-2 text-ink-2">
                  <ClipboardList size={13} className="text-ink-3" /> Scorer <span className="text-ink">{officials.scorer.display_name}</span>
                </div>
              )}
            </div>
          </Card>
        )}

        {(feeders?.length > 0 || nextMatch) && (
          <Card className="p-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-2">Path through the draw</div>
            <div className="space-y-1.5 text-sm">
              {feeders?.map((f) => (
                <Link key={f.id} to={`/m/${f.id}`} className="flex items-center gap-1.5 text-ink-2 hover:text-accent-teal">
                  <ChevronLeft size={13} /> From {matchStageLabel(f, event)} · match {f.match_number}
                </Link>
              ))}
              {nextMatch && (
                <Link to={`/m/${nextMatch.id}`} className="flex items-center gap-1.5 text-ink-2 hover:text-accent-teal">
                  <ArrowRight size={13} /> Winner goes to {matchStageLabel(nextMatch, event)} · match {nextMatch.match_number}
                </Link>
              )}
              {isDone && !nextMatch && event?.champion_entry_id === match.winner_entry_id && (
                <div className="flex items-center gap-1.5 font-medium text-accent-yellow">
                  <Trophy size={13} /> Title decider
                </div>
              )}
            </div>
          </Card>
        )}
      </div>

      {!isLive && !isDone && match.status === "PENDING" && (
        <p className="mt-4 flex items-center gap-1.5 text-xs text-ink-3">
          <Radio size={12} /> This match is waiting on earlier results — the line-up fills in as the draw progresses.
        </p>
      )}
    </div>
  );
}
