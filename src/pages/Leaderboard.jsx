import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Trophy, MapPin } from "lucide-react";
import { cx } from "../lib/engines";
import { getLeaderboard } from "../lib/repository";
import { EmptyState } from "../components/ui/primitives";
import { BrandLoader, Reveal, StaggerList, StaggerItem } from "../components/ui/motion";
import { CourtGeometry } from "../components/ui/atmosphere";

const RANK_ACCENT = ["text-accent-yellow", "text-ink-3", "text-accent-orange"];

export default function Leaderboard() {
  const [rows, setRows] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getLeaderboard().then((r) => { if (!cancelled) setRows(r); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div>
      <div className="relative mb-6 overflow-hidden rounded-2xl bg-navy-900 px-6 py-10 text-center">
        <CourtGeometry />
        <div className="relative">
          <div className="text-[11px] font-semibold uppercase tracking-widest text-accent-teal">Matchday</div>
          <h1 className="mt-1 text-2xl font-bold text-white sm:text-3xl">Leaderboard</h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-3">
            Ranked by matches won across every MatchDay tournament. Play more, climb higher.
          </p>
        </div>
      </div>

      {!rows ? (
        <BrandLoader />
      ) : rows.length === 0 ? (
        <EmptyState icon={Trophy} title="No rankings yet" hint="Once a few tournaments finish, the top players will show up here." />
      ) : (
        <Reveal>
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-2 text-[11px] uppercase tracking-wide text-ink-2">
                <tr>
                  <th className="px-3 py-2 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">Player</th>
                  <th className="px-3 py-2 font-medium text-center">Played</th>
                  <th className="px-3 py-2 font-medium text-center">Won</th>
                  <th className="px-3 py-2 font-medium text-center">Win %</th>
                </tr>
              </thead>
              <StaggerList as="tbody" className="divide-y divide-line-soft">
                {rows.map((p, i) => (
                  <StaggerItem key={p.id} as="tr">
                    <td className="px-3 py-2.5">
                      {i < 3 ? (
                        <Trophy size={16} className={RANK_ACCENT[i]} />
                      ) : (
                        <span className="text-ink-3">{i + 1}</span>
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
                    <td className="px-3 py-2.5 text-center font-mono text-ink-2">{p.played}</td>
                    <td className="px-3 py-2.5 text-center font-mono font-semibold text-ink">{p.won}</td>
                    <td className={cx("px-3 py-2.5 text-center font-mono font-semibold", i < 3 ? "text-accent-teal" : "text-ink-2")}>
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
