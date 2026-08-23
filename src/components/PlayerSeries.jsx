import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Layers, TrendingUp, TrendingDown, Minus, CalendarDays, CheckCircle2 } from "lucide-react";
import { cx, fmtDate } from "../lib/engines";
import { getMySeries, getSeriesData } from "../lib/repository";
import { playerSeriesPosition } from "../lib/seriesStandings";
import { Badge, Card } from "./ui/primitives";

/* A player's line in each series they compete in.

   Position and points come from the same aggregation the public series page
   uses, so a player never sees a different number from a spectator. Movement
   is only shown when it can be derived honestly — it needs at least two
   played matchdays to compare against, otherwise there is no "previous
   position" and nothing is claimed. */

function Movement({ value }) {
  if (value === null || value === undefined) {
    return <span className="text-[11px] text-ink-3">No movement yet</span>;
  }
  if (value === 0) {
    return <span className="flex items-center gap-1 text-[11px] text-ink-3"><Minus size={11} /> Held position</span>;
  }
  const up = value > 0;
  return (
    <span className={cx("flex items-center gap-1 text-[11px] font-medium", up ? "text-accent-teal" : "text-amber-300")}>
      {up ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
      {up ? `Up ${value}` : `Down ${Math.abs(value)}`} since last matchday
    </span>
  );
}

function SeriesRow({ series, playerId }) {
  const [state, setState] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getSeriesData(series.id)
      .then((d) => { if (!cancelled) setState(playerSeriesPosition(d, playerId, { sport: series.sport || "badminton" })); })
      .catch(() => { if (!cancelled) setState(false); });
    return () => { cancelled = true; };
  }, [series.id, series.sport, playerId]);

  const played = (series.myTournaments || []).filter((t) => ["COMPLETED", "ARCHIVED"].includes(t.status));
  const upcoming = (series.myTournaments || [])
    .filter((t) => !["COMPLETED", "ARCHIVED", "CANCELLED"].includes(t.status))
    .sort((a, b) => (a.start_date || "").localeCompare(b.start_date || ""));

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to={`/series/${series.id}`} className="flex items-center gap-1.5 font-semibold text-ink hover:text-accent-teal">
            <Layers size={14} className="text-accent-teal" /> {series.name}
          </Link>
          <div className="mt-0.5 text-[11px] text-ink-3">
            {played.length} played · {upcoming.length} upcoming of {(series.myTournaments || []).length} you entered
          </div>
        </div>

        {/* Position is withheld rather than guessed when the aggregation has
            nothing to stand on yet. */}
        {state === null ? (
          <div className="text-[11px] text-ink-3">Loading…</div>
        ) : state && state.mine ? (
          <div className="shrink-0 text-right">
            <div className="font-display text-2xl font-bold text-accent-teal">#{state.mine.position}</div>
            <div className="text-[11px] text-ink-3">{state.mine.points} pts</div>
          </div>
        ) : (
          <Badge tone="slate">Unranked</Badge>
        )}
      </div>

      {state && state.mine && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line-soft pt-2">
          <Movement value={state.movement} />
          <span className="text-[11px] text-ink-3">
            {state.mine.won}W {state.mine.lost}L across {state.mine.matchdays} matchday{state.mine.matchdays === 1 ? "" : "s"}
          </span>
        </div>
      )}
      {state && !state.mine && (
        <p className="mt-2 border-t border-line-soft pt-2 text-[11px] text-ink-3">
          You&apos;ll appear in the standings once you have completed matches in {state.config.minMatchdays}{" "}
          matchday{state.config.minMatchdays === 1 ? "" : "s"}.
        </p>
      )}

      {upcoming.length > 0 && (
        <div className="mt-2 border-t border-line-soft pt-2">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-ink-3">Next matchday</div>
          <Link to={`/t/${upcoming[0].slug || ""}`} className="flex items-center gap-1.5 text-sm text-ink hover:text-accent-teal">
            <CalendarDays size={12} className="text-ink-3" />
            {upcoming[0].name}
            <span className="text-[11px] text-ink-3">{fmtDate(upcoming[0].start_date)}</span>
          </Link>
        </div>
      )}
      {upcoming.length === 0 && played.length > 0 && (
        <div className="mt-2 flex items-center gap-1.5 border-t border-line-soft pt-2 text-[11px] text-ink-3">
          <CheckCircle2 size={11} /> All your matchdays in this series are done.
        </div>
      )}
    </Card>
  );
}

export default function PlayerSeries({ playerId }) {
  const [series, setSeries] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getMySeries().then((s) => { if (!cancelled) setSeries(s); }).catch(() => { if (!cancelled) setSeries([]); });
    return () => { cancelled = true; };
  }, [playerId]);

  // A player not in any series shouldn't see an empty section at all.
  if (!series || series.length === 0) return null;

  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-2">My series</h2>
      <div className="grid gap-2 sm:grid-cols-2">
        {series.map((s) => <SeriesRow key={s.id} series={s} playerId={playerId} />)}
      </div>
    </section>
  );
}
