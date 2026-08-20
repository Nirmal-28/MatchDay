import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { motion } from "motion/react";
import { ChevronLeft, MapPin, Trophy, Share2, Building2 } from "lucide-react";
import { cx, fmtDate, computeCareerStats, currentStreak, computeBadges, topRivals, divisionLabel, BadmintonScoringEngine, toAB } from "../lib/engines";
import { getPlayer, getPlayerHistory, getPlayersByIds } from "../lib/repository";
import { Card, Badge, Btn, EmptyState } from "../components/ui/primitives";
import { BrandLoader, Reveal } from "../components/ui/motion";
import { CourtGeometry } from "../components/ui/atmosphere";

const BADGE_TONES = {
  yellow: "text-accent-yellow", teal: "text-accent-teal", purple: "text-accent-purple",
  blue: "text-accent-blue", pink: "text-accent-pink",
};

function StatTile({ label, value, accent }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-center">
      <div className={cx("font-display text-3xl font-bold", accent || "text-white")}>{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-stone-400">{label}</div>
    </div>
  );
}

export default function PlayerProfile() {
  const { id } = useParams();
  const [player, setPlayer] = useState(null);
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

  // Titles = divisions where one of this player's entries is the champion.
  const titles = (history.entries || []).filter(
    (a) => a.entries?.tournament_events?.champion_entry_id &&
           a.entries.tournament_events.champion_entry_id === a.entry_id
  );
  // event_id -> division, so each match row can name the division it was in
  const eventById = Object.fromEntries(
    (history.entries || [])
      .map((a) => a.entries?.tournament_events)
      .filter(Boolean)
      .map((ev) => [ev.id, ev])
  );

  const badges = computeBadges(stats, streak, titles.length);

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
      <Link to="/" className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-stone-500 hover:text-stone-800">
        <ChevronLeft size={14} /> Back
      </Link>

      <div className="relative mb-5 overflow-hidden rounded-2xl bg-navy-900 p-5 sm:p-6">
        <CourtGeometry />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.4 }}
              className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-accent-teal to-accent-blue font-display text-2xl font-bold text-white"
            >
              {player.name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()}
            </motion.div>
            <div>
              <h1 className="text-2xl font-bold text-white">{player.name}</h1>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-stone-400">
                {player.city && <span className="flex items-center gap-1"><MapPin size={11} />{player.city}</span>}
                {player.club && <span className="flex items-center gap-1"><Building2 size={11} />{player.club}</span>}
                {streak && streak.count > 1 && (
                  <span className={cx("font-semibold", streak.kind === "W" ? "text-accent-teal" : "text-stone-500")}>
                    {streak.count} {streak.kind === "W" ? "win" : "loss"} streak
                  </span>
                )}
              </div>
            </div>
          </div>
          <Btn size="sm" variant="secondary" icon={Share2} onClick={share}>Share</Btn>
        </div>

        <div className="relative mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <StatTile label="Played" value={stats.played} />
          <StatTile label="Won" value={stats.won} accent="text-accent-teal" />
          <StatTile label="Lost" value={stats.lost} />
          <StatTile label="Win %" value={`${stats.winPct}%`} />
          <StatTile label="Titles" value={titles.length} accent="text-accent-yellow" />
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
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">Recent matches</h2>
            <div className="overflow-x-auto rounded-md border border-stone-200">
              <table className="w-full text-left text-sm">
                <thead className="bg-stone-50 text-[11px] uppercase tracking-wide text-stone-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Result</th>
                    <th className="px-3 py-2 font-medium">Division</th>
                    <th className="px-3 py-2 font-medium">Games</th>
                    <th className="px-3 py-2 font-medium">Score</th>
                    <th className="px-3 py-2 font-medium">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
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
                        <td className="px-3 py-2 text-xs text-stone-500">
                          {eventById[m.event_id] ? divisionLabel(eventById[m.event_id]) : "—"}
                        </td>
                        <td className="px-3 py-2 text-xs text-stone-500">
                          {iAmA ? `${tally.a}–${tally.b}` : `${tally.b}–${tally.a}`}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-stone-600">
                          {games.map((g, i) => (
                            <span key={i} className="mr-1.5">
                              {iAmA ? `${g.score_a}-${g.score_b}` : `${g.score_b}-${g.score_a}`}
                            </span>
                          ))}
                        </td>
                        <td className="px-3 py-2 text-xs text-stone-500">{m.completed_at ? fmtDate(m.completed_at) : "—"}</td>
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
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">Rivals</h2>
                <div className="space-y-2">
                  {rivals.map((r) => (
                    <Card key={r.playerId} className="flex items-center justify-between p-3">
                      <Link to={`/p/${r.playerId}`} className="text-sm font-medium text-stone-800 hover:text-teal-700">{r.player.name}</Link>
                      <span className="font-mono text-xs text-stone-500">{r.won}–{r.lost}</span>
                    </Card>
                  ))}
                </div>
              </Reveal>
            )}
            <Reveal delay={0.15}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">Tournaments</h2>
              <div className="space-y-2">
                {tournaments.length === 0 && <p className="text-sm text-stone-400">None yet.</p>}
                {tournaments.map((t) => (
                  <Card key={t.id} className="p-3">
                    <Link to={`/t/${t.slug}`} className="text-sm font-medium text-stone-800 hover:text-teal-700">{t.name}</Link>
                    <div className="text-xs text-stone-500">{fmtDate(t.start_date)}</div>
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
