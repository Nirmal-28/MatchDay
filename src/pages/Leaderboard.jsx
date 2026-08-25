import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Trophy, MapPin } from "lucide-react";
import { cx } from "../lib/engines";
import { getRankingData } from "../lib/repository";
import { computeRanking, rankPlayers, rankingConfigFor } from "../lib/ranking";
import { EmptyState } from "../components/ui/primitives";
import { BrandLoader, Reveal, StaggerList, StaggerItem } from "../components/ui/motion";
import { CourtGeometry } from "../components/ui/atmosphere";
import { MaskText } from "../components/ui/reveal";
import { useDocumentMeta } from "../lib/useDocumentMeta";

const RANK_ACCENT = ["text-accent-yellow", "text-ink-3", "text-accent-orange"];

export default function Leaderboard() {
  const [rows, setRows] = useState(null);
  useDocumentMeta({ title: "Leaderboard", description: "Badminton ranking points from completed tournament matches." });

  // Ranking points come from real completed matches only. getRankingData()
  // returns the raw material; computeRanking() applies the sport's points
  // model, and rankPlayers() drops anyone below the minimum match count
  // rather than publishing a provisional number that reads as a real position.
  useEffect(() => {
    let cancelled = false;
    getRankingData().then(({ players, matchesByPlayer, eventById }) => {
      if (cancelled) return;
      const scored = players.map((pl) => {
        const rec = matchesByPlayer[pl.id];
        const r = computeRanking(rec.matches, rec.entryIds, eventById, "badminton");
        return { ...pl, points: r.points ?? 0, played: r.played, won: r.won, winPct: r.winPct, titles: r.titles };
      });
      setRows(rankPlayers(scored, "badminton"));
    }).catch(() => setRows([]));
    return () => { cancelled = true; };
  }, []);

  return (
    <div>
      <div className="md-court-texture relative mb-6 overflow-hidden rounded-2xl border border-line bg-gradient-to-b from-navy-800 to-surface px-6 py-12 text-center">
        <CourtGeometry />
        <div className="relative">
          <div className="md-eyebrow text-accent-teal">Matchday</div>
          <MaskText as="h1" className="md-display md-h1 mt-1.5 text-ink" lines={["Rankings"]} />
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-3">
            Badminton ranking points from every completed match on MatchDay. A player needs at least {rankingConfigFor("badminton").minMatches} completed matches to be ranked.
          </p>
        </div>
      </div>

      {!rows ? (
        <BrandLoader />
      ) : rows.length === 0 ? (
        <EmptyState icon={Trophy} title="No rankings yet" hint={`Once players complete at least ${rankingConfigFor("badminton").minMatches} matches each, the ranking table fills in.`} />
      ) : (
        <Reveal>
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-2">
                <tr>
                  <th className="md-eyebrow px-3 py-2.5">#</th>
                  <th className="md-eyebrow px-3 py-2.5">Player</th>
                  <th className="md-eyebrow px-3 py-2.5 text-center">Points</th>
                  <th className="md-eyebrow px-3 py-2.5 text-center">Played</th>
                  <th className="md-eyebrow px-3 py-2.5 text-center">Won</th>
                  <th className="md-eyebrow px-3 py-2.5 text-center">Win %</th>
                </tr>
              </thead>
              <StaggerList as="tbody" className="divide-y divide-line-soft">
                {rows.map((p, i) => (
                  <StaggerItem key={p.id} as="tr">
                    <td className="px-3 py-2.5">
                      {i < 3 ? (
                        <Trophy size={16} className={RANK_ACCENT[i]} />
                      ) : (
                        <span className="md-score text-ink-3">{i + 1}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <Link to={`/p/${p.id}`} className="font-medium text-ink hover:text-accent-teal hover:underline">
                        {p.name}
                      </Link>
                      {p.city && (
                        <span className="ml-2 inline-flex items-center gap-0.5 text-xs text-ink-3">
                          <MapPin size={10} />{p.city}
                        </span>
                      )}
                    </td>
                    <td className="md-score px-3 py-2.5 text-center text-lg text-accent-teal">{p.points}</td>
                    <td className="px-3 py-2.5 text-center tabular-nums text-ink-2">{p.played}</td>
                    <td className="px-3 py-2.5 text-center font-semibold tabular-nums text-ink">{p.won}</td>
                    <td className={cx("px-3 py-2.5 text-center font-semibold tabular-nums", i < 3 ? "text-accent-teal" : "text-ink-2")}>
                      {p.winPct}%
                    </td>
                  </StaggerItem>
                ))}
              </StaggerList>
            </table>
          </div>
        </Reveal>
      )}
    </div>
  );
}
