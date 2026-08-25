import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ChevronLeft, MapPin, Trophy, Share2, Building2 } from "lucide-react";
import { cx, fmtDate, computeCareerStats, currentStreak, computeBadges, topRivals, divisionLabel, BadmintonScoringEngine, toAB } from "../lib/engines";
import { getPlayer, getPlayerHistory, getPlayersByIds } from "../lib/repository";
import { computeRanking } from "../lib/ranking";
import { Card, Badge, Btn, EmptyState } from "../components/ui/primitives";
import { BrandLoader, Reveal } from "../components/ui/motion";
import { CourtGeometry } from "../components/ui/atmosphere";
import { useDocumentMeta } from "../lib/useDocumentMeta";
import FollowButton from "../components/FollowButton";

const BADGE_TONES = {
  yellow: "text-accent-yellow", teal: "text-accent-teal", purple: "text-accent-purple",
  blue: "text-accent-blue", pink: "text-accent-pink",
};

// A career figure. Deliberately plain — on an athlete profile the number
// IS the design, and every one of these is counted from completed matches
// rather than stored, so it can never drift from the actual results.
function StatTile({ label, value, accent }) {
  return (
    <div className="rounded-lg border border-line bg-surface-2/60 px-3 py-3 text-center">
      <div className={cx("md-score text-3xl", accent || "text-ink")}>{value}</div>
      <div className="md-eyebrow mt-1">{label}</div>
    </div>
  );
}

export default function PlayerProfile() {
  const { id } = useParams();
  const [player, setPlayer] = useState(null);
  useDocumentMeta({ title: player?.name, description: player?.name ? `${player.name} on Matchday — tournament history, results and ranking.` : undefined });
  const [history, setHistory] = useState(null);
  const [rivals, setRivals] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [p, h] = await Promise.all([getPlayer(id), getPlayerHistory(id)]);
        if (cancelled) return;
        setPlayer(p); setHistory(h);

        const rivalRows = topRivals(h.matches, h.entryIds, h.entryToPlayer);
        if (rivalRows.length) {
          const rivalPlayers = await getPlayersByIds(rivalRows.map((r) => r.playerId));
          const byId = Object.fromEntries(rivalPlayers.map((rp) => [rp.id, rp]));
          if (!cancelled) setRivals(rivalRows.map((r) => ({ ...r, player: byId[r.playerId] })).filter((r) => r.player));
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  if (error) return <EmptyState icon={Trophy} title="Player not found" hint={error} />;
  if (!player || !history) return <BrandLoader />;

  const entryIds = history.entryIds || [];
  const stats = computeCareerStats(history.matches, entryIds);
  const streak = currentStreak(history.matches, entryIds);
  const mine = new Set(entryIds);

  // event_id -> division, so each match row can name the division it was in
  const eventById = Object.fromEntries(
    (history.entries || [])
      .map((a) => a.entries?.tournament_events)
      .filter(Boolean)
      .map((ev) => [ev.id, ev])
  );

  // Ranking uses the same match history already loaded — no extra fetch. The
  // sport comes from the tournaments this player actually competed in.
  const sport = (history.entries || [])
    .map((a) => a.entries?.tournament_events?.tournaments?.sport)
    .find(Boolean) || "badminton";
  const ranking = computeRanking(history.matches, entryIds, eventById, sport);

  const badges = computeBadges(stats, streak, ranking.titles);

  const tournaments = [...new Map(
    (history.entries || [])
      .map((a) => a.entries?.tournament_events?.tournaments)
      .filter(Boolean)
      .map((t) => [t.id, t])
  ).values()];

  const recent = history.matches
    .filter((m) => (m.status === "COMPLETED" || m.status === "WALKOVER") && (mine.has(m.entry_a) || mine.has(m.entry_b)))
    .sort((a, b) => (b.completed_at || "").localeCompare(a.completed_at || ""))
    .slice(0, 12);

  const share = () => {
    const text = `${player.name} on MatchDay — ${stats.won}W ${stats.lost}L (${stats.winPct}% wins) across ${tournaments.length} tournament${tournaments.length === 1 ? "" : "s"}. ${window.location.href}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  };

  return (
    <div>
      <Link to="/" className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-ink-2 hover:text-ink">
        <ChevronLeft size={14} /> Back
      </Link>

      <div className="relative mb-5 overflow-hidden rounded-2xl bg-navy-900 p-5 sm:p-6">
        <CourtGeometry />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            {/* Static. The avatar used to scale in on every mount, which on
                a profile someone opens repeatedly reads as the page being
                slow rather than as polish. */}
            <div className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl">
              {player.photo_url ? (
                <img src={player.photo_url} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-accent-teal to-accent-blue md-display text-3xl text-navy-950">
                  {player.name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()}
                </div>
              )}
            </div>
            <div>
              <div className="md-eyebrow mb-1">Player</div>
              <h1 className="md-display md-h2 text-ink">{player.name}</h1>
              {player.bio && <p className="mt-0.5 max-w-md text-sm text-ink-2">{player.bio}</p>}
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-3">
                {player.city && <span className="flex items-center gap-1"><MapPin size={11} />{player.city}</span>}
                {player.club && <span className="flex items-center gap-1"><Building2 size={11} />{player.club}</span>}
                {player.skill_level && <span className="capitalize">{player.skill_level.toLowerCase()}</span>}
                {streak && streak.count > 1 && (
                  <span className={cx("font-semibold", streak.kind === "W" ? "text-accent-teal" : "text-ink-2")}>
                    {streak.count} {streak.kind === "W" ? "win" : "loss"} streak
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <FollowButton subjectType="PLAYER" subjectId={player.id} />
            <Btn size="sm" variant="secondary" icon={Share2} onClick={share}>Share</Btn>
          </div>
        </div>

        <div className="relative mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatTile label="Played" value={stats.played} />
          <StatTile label="Won" value={stats.won} accent="text-accent-teal" />
          <StatTile label="Lost" value={stats.lost} />
          <StatTile label="Win %" value={`${stats.winPct}%`} />
          <StatTile label="Titles" value={ranking.titles} accent="text-accent-yellow" />
          <StatTile label="Finals" value={ranking.finals} />
        </div>

        {/* Ranking is withheld rather than shown as a provisional number —
            a "rank" off one match would read as a real standing. */}
        <div className="relative mt-3 rounded-lg border border-white/10 bg-white/5 p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="md-eyebrow">Badminton ranking points</div>
              {ranking.ranked ? (
                <div className="md-score text-4xl text-accent-teal">{ranking.points}</div>
              ) : (
                <div className="mt-0.5 max-w-xs text-sm text-ink-3">
                  Unranked — {ranking.minMatches} completed matches are needed, {ranking.played} so far.
                </div>
              )}
            </div>
            {/* Cumulative points over completed matches. A sparkline is the
                honest shape here: it shows direction without implying
                precision the data does not have. */}
            {ranking.ranked && ranking.history.length > 1 && (
              <svg viewBox="0 0 120 36" className="h-9 w-32" preserveAspectRatio="none" aria-hidden="true">
                <polyline
                  fill="none" stroke="var(--color-accent-teal)" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round"
                  points={ranking.history.map((h, i) => {
                    const x = (i / (ranking.history.length - 1)) * 118 + 1;
                    const max = ranking.history[ranking.history.length - 1].points || 1;
                    return `${x},${34 - (h.points / max) * 32}`;
                  }).join(" ")}
                />
              </svg>
            )}
          </div>
          {ranking.ranked && (
            <div className="mt-1 text-[11px] text-ink-3">
              Earned across {ranking.played} completed {ranking.played === 1 ? "match" : "matches"}. See the{" "}
              <Link to="/leaderboard" className="text-accent-teal hover:underline">leaderboard</Link> for position.
            </div>
          )}
        </div>

        {badges.length > 0 && (
          <div className="relative mt-4 flex flex-wrap gap-1.5">
            {badges.map((b) => (
              <span key={b.key} className={cx(
                "inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-[11px] font-semibold",
                BADGE_TONES[b.tone] || "text-white"
              )}>
                🏅 {b.label}
              </span>
            ))}
          </div>
        )}
      </div>

      {stats.played === 0 ? (
        <EmptyState icon={Trophy} title="No matches yet" hint="This player's results will appear here after their first completed match." />
      ) : (
        <div className="grid gap-5 lg:grid-cols-3">
          <Reveal className="lg:col-span-2">
            <h2 className="md-display md-rule mb-3 text-xl text-ink">Recent matches</h2>
            <div className="overflow-x-auto rounded-md border border-line">
              <table className="w-full text-left text-sm">
                <thead className="bg-surface-2 text-[11px] uppercase tracking-wide text-ink-2">
                  <tr>
                    <th className="px-3 py-2 font-medium">Result</th>
                    <th className="px-3 py-2 font-medium">Division</th>
                    <th className="px-3 py-2 font-medium">Games</th>
                    <th className="px-3 py-2 font-medium">Score</th>
                    <th className="px-3 py-2 font-medium">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-soft">
                  {recent.map((m) => {
                    const iAmA = mine.has(m.entry_a);
                    const iWon = m.winner_entry_id && mine.has(m.winner_entry_id);
                    const tally = BadmintonScoringEngine.gameTally(toAB(m.games));
                    const games = [...(m.games || [])].sort((a, b) => a.game_number - b.game_number);
                    return (
                      <tr key={m.id}>
                        <td className="px-3 py-2">
                          <Badge tone={iWon ? "emerald" : "slate"}>{iWon ? "Won" : "Lost"}</Badge>
                        </td>
                        <td className="px-3 py-2 text-xs text-ink-2">
                          {eventById[m.event_id] ? divisionLabel(eventById[m.event_id]) : "—"}
                        </td>
                        <td className="px-3 py-2 text-xs text-ink-2">
                          {iAmA ? `${tally.a}–${tally.b}` : `${tally.b}–${tally.a}`}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-ink-2">
                          {games.map((g, i) => (
                            <span key={i} className="mr-1.5">
                              {iAmA ? `${g.score_a}-${g.score_b}` : `${g.score_b}-${g.score_a}`}
                            </span>
                          ))}
                        </td>
                        <td className="px-3 py-2 text-xs text-ink-2">{m.completed_at ? fmtDate(m.completed_at) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Reveal>

          <div className="space-y-5">
            {rivals.length > 0 && (
              <Reveal delay={0.1}>
                <h2 className="md-display md-rule mb-3 text-xl text-ink">Rivals</h2>
                <div className="space-y-2">
                  {rivals.map((r) => (
                    <Card key={r.playerId} className="flex items-center justify-between p-3">
                      <Link to={`/p/${r.playerId}`} className="text-sm font-medium text-ink hover:text-accent-teal">{r.player.name}</Link>
                      <span className="font-mono text-xs text-ink-2">{r.won}–{r.lost}</span>
                    </Card>
                  ))}
                </div>
              </Reveal>
            )}
            <Reveal delay={0.15}>
              <h2 className="md-display md-rule mb-3 text-xl text-ink">Tournaments</h2>
              <div className="space-y-2">
                {tournaments.length === 0 && <p className="text-sm text-ink-3">None yet.</p>}
                {tournaments.map((t) => (
                  <Card key={t.id} className="p-3">
                    <Link to={`/t/${t.slug}`} className="text-sm font-medium text-ink hover:text-accent-teal">{t.name}</Link>
                    <div className="text-xs text-ink-2">{fmtDate(t.start_date)}</div>
                  </Card>
                ))}
              </div>
            </Reveal>
          </div>
        </div>
      )}
    </div>
  );
}
