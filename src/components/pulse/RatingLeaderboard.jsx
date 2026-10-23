import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, MapPin } from "lucide-react";
import { cx } from "../../lib/engines";
import { getRatingData, getPlayersByIds } from "../../lib/repository";
import { MDR } from "../../lib/rating";
import { EmptyState } from "../ui/primitives";
import { BrandLoader } from "../ui/motion";

/* The skill table. Established ratings only: a provisional number off two
   matches would read as a real position, so those players are counted and
   named as "settling" rather than ranked. */
export default function RatingLeaderboard() {
  const [state, setState] = useState(null);
  const [format, setFormat] = useState("singles");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await getRatingData();
        const ids = [...new Set([...Object.keys(r.players.singles), ...Object.keys(r.players.doubles)])];
        const people = ids.length ? await getPlayersByIds(ids) : [];
        if (!cancelled) setState({ r, byId: Object.fromEntries(people.map((p) => [p.id, p])) });
      } catch {
        if (!cancelled) setState({ r: { players: { singles: {}, doubles: {} } }, byId: {} });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!state) return <BrandLoader />;
  const pool = state.r.players[format];
  const all = Object.entries(pool).map(([id, x]) => ({ id, ...x, player: state.byId[id] })).filter((x) => x.player);
  const rows = all.filter((x) => !x.provisional).sort((a, b) => b.rating - a.rating || b.matches - a.matches);
  const settling = all.length - rows.length;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex rounded-full border border-line p-0.5 text-xs font-semibold uppercase">
          {["singles", "doubles"].map((f) => (
            <button key={f} onClick={() => setFormat(f)} aria-pressed={format === f}
              className={cx("rounded-full px-3 py-1.5", format === f ? "bg-accent-teal text-navy-950" : "text-ink-3 hover:text-ink")}>
              {f}
            </button>
          ))}
        </div>
        {settling > 0 && (
          <span className="text-xs text-ink-3">
            {settling} more {settling === 1 ? "player is" : "players are"} settling (under {MDR.PROVISIONAL_UNTIL} rated matches)
          </span>
        )}
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={Activity} title={`No established ${format} ratings yet`}
          hint={`A rating is published once a player has ${MDR.PROVISIONAL_UNTIL} officiated ${format} matches against registered players.`} />
      ) : (
        <div className="overflow-x-auto rounded-md border border-line">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-2">
              <tr>
                <th className="md-eyebrow px-3 py-2.5">#</th>
                <th className="md-eyebrow px-3 py-2.5">Player</th>
                <th className="md-eyebrow px-3 py-2.5 text-center">MDR</th>
                <th className="md-eyebrow px-3 py-2.5 text-center">Rated</th>
                <th className="md-eyebrow px-3 py-2.5 text-center">W–L</th>
                <th className="md-eyebrow px-3 py-2.5 text-center">Peak</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {rows.map((p, i) => (
                <tr key={p.id}>
                  <td className="md-score px-3 py-2.5 text-ink-3">{i + 1}</td>
                  <td className="px-3 py-2.5">
                    <Link to={`/p/${p.id}`} className="font-medium text-ink hover:text-accent-teal hover:underline">{p.player.name}</Link>
                    {p.player.city && <span className="ml-2 inline-flex items-center gap-0.5 text-xs text-ink-3"><MapPin size={10} />{p.player.city}</span>}
                  </td>
                  <td className="md-score px-3 py-2.5 text-center text-lg text-accent-teal">{p.rating}</td>
                  <td className="px-3 py-2.5 text-center tabular-nums text-ink-2">{p.matches}</td>
                  <td className="px-3 py-2.5 text-center tabular-nums text-ink">{p.wins}–{p.matches - p.wins}</td>
                  <td className="px-3 py-2.5 text-center tabular-nums text-ink-2">{p.peak}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
