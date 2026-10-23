import { useCallback, useEffect, useRef, useState } from "react";
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
import { useMatchPulse } from "../lib/useMatchPulse";
import { RatingChip, WinProbabilityBar, MomentumChart, MatchMoments } from "../components/pulse/PulseUI";
import ShareStoryCard from "../components/pulse/ShareStoryCard";
import CourtEta from "../components/CourtEta";

// One side of the match: name(s), live or final score, winner marker. Declared
// at module level rather than inside the page so it keeps its identity across
// re-renders (this page re-renders on every realtime score change).
function Side({ entry, side, won, showLive, showFinal, liveScore, finalGames, rating, delta }) {
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
        {rating && (
          <div className="mt-1.5">
            <RatingChip rating={rating.rating} provisional={rating.provisional} delta={delta} />
          </div>
        )}
      </div>
      <div className="shrink-0 text-right">
        {/* Keyed on the value so a point landing replays the one-shot bump.
            This page is what a spectator keeps open during a live match, so
            the score changing needs to be visible without a refresh — but it
            is a single 340ms animation, not a loop. */}
        {showLive && <div key={liveScore ?? 0} className="md-bump md-score text-5xl text-ink">{liveScore ?? 0}</div>}
        {showFinal && <div className="md-score text-5xl text-ink">{finalGames}</div>}
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

  // Only the FIRST load can decide the match does not exist. A realtime
  // refresh that fails mid-match is a connection blip, and swapping a live
  // scoreboard for "Match not found" because one re-read dropped told
  // spectators the match had vanished. Keep the last good score instead.
  const hasData = useRef(false);
  const load = useCallback(async () => {
    try { setData(await getMatchDetail(id)); hasData.current = true; }
    catch (e) { if (!hasData.current) setError(e.message); }
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => subscribeToMatch(id, load), [id, load]);

  if (error) return <EmptyState icon={Swords} title="Match not found" hint="This link may be wrong, or the tournament isn't published yet." />;
  if (!data) return <BrandLoader />;

  return <MatchDetailView data={data} navigate={navigate} />;
}

function MatchDetailView({ data, navigate }) {
  const { match, event, tournament, entriesById, officials, feeders, nextMatch } = data;
  const pulse = useMatchPulse(match, entriesById);
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
    rating: pulse?.rating?.[side] || null,
    delta: pulse?.delta?.[side] ?? null,
  });
  const nameA = entryShort(a) || "Side A";
  const nameB = entryShort(b) || "Side B";
  const winnerPre = winnerSide === "A" ? pulse?.preMatchA : winnerSide === "B" ? 1 - (pulse?.preMatchA ?? 0.5) : null;
  const upset = isDone && pulse?.basis === "ratings" && winnerPre != null && winnerPre < 0.35;
  const storyCard = isDone && !match.is_bye && games.length > 0 ? {
    tournament: tournament?.name, stage: matchStageLabel(match, event), division: divisionLabel(event),
    sides: [
      { name: nameA, won: winnerSide === "A", delta: pulse?.delta?.A, rating: pulse?.rating?.A?.rating },
      { name: nameB, won: winnerSide === "B", delta: pulse?.delta?.B, rating: pulse?.rating?.B?.rating },
    ],
    games: toAB(games),
    series: pulse?.logComplete ? pulse.story.series : [],
    moments: [
      ...(upset ? [{ title: `Upset — won from a ${Math.round(winnerPre * 100)}% pre-match chance`, side: winnerSide }] : []),
      ...(pulse?.story?.moments || []),
    ],
    url: typeof window !== "undefined" ? window.location.href : "",
  } : null;

  return (
    <div className="mx-auto max-w-3xl">
      <button className="mb-3 flex items-center gap-1 text-xs font-medium text-ink-2 hover:text-ink" onClick={() => navigate(-1)}>
        <ChevronLeft size={14} /> Back
      </button>

      {/* Header. Same court texture and condensed type as every other
          MatchDay hero — a shared match link should feel like part of the
          product, not like a database row rendered on its own. */}
      <div className="md-court-texture relative mb-5 overflow-hidden rounded-2xl border border-line bg-gradient-to-b from-navy-800 to-surface p-5">
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
            <h1 className="md-display mt-2.5 text-3xl text-ink">{matchStageLabel(match, event)}</h1>
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
            {/* Court in display type: at a venue this is the one fact
                someone is scanning the page for. */}
            <div className="mt-1.5 flex items-center justify-end gap-1.5">
              <MapPin size={12} />
              <span className="md-display text-xl leading-none text-ink">
                {match.court || match.courts?.name || "Court TBD"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* When it will really start, from live pace on this court. Renders
          nothing for a match that is finished, unscheduled or days away. */}
      {!isLive && !isDone && <CourtEta match={match} tournament={tournament} className="mb-4" />}

      {/* Sides + score */}
      <div className="mb-4 space-y-2">
        <Side entry={a} {...sideProps("A")} />
        <div className="text-center text-[11px] font-semibold uppercase tracking-widest text-ink-3">versus</div>
        <Side entry={b} {...sideProps("B")} />
      </div>

      {/* ── MatchDay Pulse ───────────────────────────────────────────────
          Live: who is winning, as a probability that moves every rally.
          Before: the rating-based prediction. After: how it happened. */}
      {isLive && pulse?.live != null && (
        <WinProbabilityBar className="mb-4" nameA={nameA} nameB={nameB} pA={pulse.live} basis={pulse.basis} />
      )}
      {!isLive && !isDone && pulse?.basis === "ratings" && match.entry_a && match.entry_b && (
        <WinProbabilityBar className="mb-4" label="Pre-match prediction" nameA={nameA} nameB={nameB} pA={pulse.preMatchA} basis="ratings" />
      )}
      {upset && (
        <div className="md-edge mb-4 rounded-lg border border-accent-yellow/40 bg-accent-yellow/[0.07] px-4 py-3 pl-5 text-sm" style={{ "--md-edge": "var(--color-accent-yellow)" }}>
          <span className="font-semibold text-accent-yellow">Upset.</span>{" "}
          <span className="text-ink-2">{winnerSide === "A" ? nameA : nameB} went in with a {Math.round(winnerPre * 100)}% chance on MatchDay Ratings — and won.</span>
        </div>
      )}

      {/* Game-by-game */}
      {games.length > 0 && (
        <Card className="mb-4 p-4">
          <div className="mb-2 md-eyebrow">Game by game</div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="md-eyebrow">
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

      {(isLive || isDone) && pulse && (pulse.logComplete || pulse.story.moments.length > 0 || storyCard) && (
        <section className="mb-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="md-display text-xl text-ink">Match pulse</h2>
            {storyCard && <ShareStoryCard card={storyCard} fileName={`matchday-${match.id.slice(0, 8)}.png`} />}
          </div>
          {pulse.logComplete && pulse.story.series.length > 2 && (
            <MomentumChart series={pulse.story.series} nameA={nameA} nameB={nameB} />
          )}
          {pulse.logPartial && (
            <p className="text-[11px] text-ink-3">Part of this match's rally log is missing, so the momentum chart is hidden rather than drawn from incomplete data. The score above is official.</p>
          )}
          <MatchMoments moments={pulse.story.moments} nameA={nameA} nameB={nameB} />
          {pulse.story.stats && pulse.logComplete && (
            <div className="text-[11px] text-ink-3">
              {pulse.story.stats.rallies} rallies · {nameA} won {pulse.story.stats.pointsWon.A}, {nameB} won {pulse.story.stats.pointsWon.B}
            </div>
          )}
        </section>
      )}

      {/* Officials + progression */}
      <div className="grid gap-4 sm:grid-cols-2">
        {(officials?.scorer || officials?.referee) && (
          <Card className="p-4">
            <div className="mb-2 md-eyebrow">Officials</div>
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
            <div className="mb-2 md-eyebrow">Path through the draw</div>
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
