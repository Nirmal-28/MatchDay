import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, ShieldCheck } from "lucide-react";
import { cx } from "../../lib/engines";
import { getRatingData } from "../../lib/repository";
import { percentileOf, MDR } from "../../lib/rating";

/* A player's MatchDay Rating, singles and doubles.

   The pitch to a player is one line: "your level, proven." Every number on
   this card is replayed from officiated matches; the card says how many, and
   against how many different opponents, so the rating carries its own
   evidence. Provisional ratings are shown as provisional — a number off two
   matches must not read like a settled level. */

function Sparkline({ history }) {
  if (!history || history.length < 2) return null;
  const pts = [MDR.START, ...history.map((h) => h.rating)];
  const lo = Math.min(...pts), hi = Math.max(...pts);
  const span = Math.max(1, hi - lo);
  const d = pts.map((r, i) => `${(i / (pts.length - 1)) * 118 + 1},${34 - ((r - lo) / span) * 32}`).join(" ");
  return (
    <svg viewBox="0 0 120 36" className="h-10 w-36" preserveAspectRatio="none" aria-hidden="true">
      <polyline fill="none" stroke="var(--color-accent-teal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" points={d} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export default function PlayerRatingCard({ playerId, className }) {
  const [data, setData] = useState(undefined);
  const [format, setFormat] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getRatingData().then((r) => { if (!cancelled) setData(r); }).catch(() => { if (!cancelled) setData(null); });
    return () => { cancelled = true; };
  }, []);

  if (data === undefined) return <div className={cx("h-28 animate-pulse rounded-lg border border-line bg-surface-2", className)} />;
  if (!data) return null;

  const s = data.players.singles[playerId];
  const d = data.players.doubles[playerId];
  const available = [s && "singles", d && "doubles"].filter(Boolean);
  const active = format && available.includes(format) ? format : (s && (!d || s.matches >= d.matches) ? "singles" : d ? "doubles" : null);
  const r = active === "singles" ? s : active === "doubles" ? d : null;

  if (!r) {
    return (
      <div className={cx("rounded-lg border border-line bg-surface-2 p-3.5", className)}>
        <div className="md-eyebrow flex items-center gap-1.5"><Activity size={12} className="text-accent-teal" /> MatchDay Rating</div>
        <p className="mt-1 max-w-md text-sm text-ink-3">
          No rated matches yet. A rating starts with the first officiated match on MatchDay against a registered player.
        </p>
      </div>
    );
  }

  const top = percentileOf(data.players[active], playerId);
  const last = r.history[r.history.length - 1];

  return (
    <div className={cx("rounded-lg border border-accent-teal/30 bg-gradient-to-br from-accent-teal/[0.08] to-surface-2 p-3.5", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="md-eyebrow flex items-center gap-1.5">
            <Activity size={12} className="text-accent-teal" /> MatchDay Rating
          </div>
          <div className="mt-1 flex items-baseline gap-2.5">
            <span className="md-score text-5xl text-ink">{r.rating}</span>
            {last?.delta ? (
              <span className={cx("text-sm font-semibold tabular-nums", last.delta > 0 ? "text-accent-teal" : "text-accent-orange")}>
                {last.delta > 0 ? `+${last.delta}` : last.delta} last match
              </span>
            ) : null}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-2">
            {r.provisional
              ? <span className="text-accent-yellow">Provisional · {r.matches} of {MDR.PROVISIONAL_UNTIL} rated matches</span>
              : top != null && <span className="font-semibold text-accent-teal">Top {top}% of rated {active} players</span>}
            <span>Peak {r.peak}</span>
            <span>{r.wins}W {r.matches - r.wins}L rated</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          {available.length > 1 && (
            <div className="flex rounded-full border border-line p-0.5 text-[11px] font-semibold uppercase">
              {available.map((f) => (
                <button key={f} onClick={() => setFormat(f)} aria-pressed={active === f}
                  className={cx("rounded-full px-2.5 py-1", active === f ? "bg-accent-teal text-navy-950" : "text-ink-3 hover:text-ink")}>
                  {f}
                </button>
              ))}
            </div>
          )}
          <Sparkline history={r.history} />
        </div>
      </div>
      <div className="mt-2.5 flex items-start gap-1.5 text-[11px] text-ink-3">
        <ShieldCheck size={12} className="mt-px shrink-0 text-accent-teal" />
        <span>
          Verified from {r.matches} officiated {r.matches === 1 ? "match" : "matches"} against {r.opponents} different {r.opponents === 1 ? "opponent" : "opponents"}, scored rally by rally on MatchDay.{" "}
          <Link to="/pulse" className="text-accent-teal hover:underline">How ratings work</Link>
        </span>
      </div>
    </div>
  );
}
