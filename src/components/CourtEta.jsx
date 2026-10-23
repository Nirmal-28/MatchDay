import { useEffect, useState } from "react";
import { Hourglass, Radio } from "lucide-react";
import { cx, fmtTime } from "../lib/engines";
import { listTournamentQueue } from "../lib/repository";
import { matchEta } from "../lib/courtQueue";

/* "Kab hai mera match?" — the live answer, from real on-court pace.

   Shows nothing at all when there is nothing honest to say (no court yet,
   days away, already finished): the scheduled time elsewhere on the page
   covers those. Re-reads every minute, because the answer drifts with every
   match that runs long. Pass `matches` when the page already has the whole
   tournament loaded, to skip the fetch. */
export default function CourtEta({ match, tournament, matches: given, className, compact = false }) {
  const [fetched, setFetched] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  const needsFetch = !given && !!tournament?.id && !!match?.scheduled_at && !["COMPLETED", "WALKOVER"].includes(match?.status);
  useEffect(() => {
    if (!needsFetch) return;
    let cancelled = false;
    const load = () => listTournamentQueue(tournament.id).then((m) => { if (!cancelled) setFetched(m); }).catch(() => {});
    load();
    const t = setInterval(() => { load(); setNow(Date.now()); }, 60_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [needsFetch, tournament?.id, match?.status, match?.scheduled_at]);

  useEffect(() => {
    if (!given) return;
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, [given]);

  const matches = given || fetched;
  if (!match || !matches) return null;
  const eta = matchEta({ match, matches, settings: tournament?.settings || {}, now });

  if (eta.onCourtNow) {
    return (
      <div className={cx("flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold", className)}
        style={{ color: "var(--color-live)", borderColor: "var(--color-live)" }}>
        <Radio size={15} /> On court now
      </div>
    );
  }
  if (!eta.available) return null;

  const queue = eta.aheadCount === 0
    ? (eta.liveOnCourt ? "Next after the match on court" : "Next up on this court")
    : `${eta.aheadCount} match${eta.aheadCount === 1 ? "" : "es"} ahead${eta.liveOnCourt ? " + 1 on court" : ""}`;

  return (
    <div className={cx("rounded-lg border border-accent-teal/40 bg-accent-teal/[0.07] p-3.5", className)} aria-live="polite">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="md-eyebrow flex items-center gap-1.5 text-accent-teal"><Hourglass size={12} /> Expected on court</div>
        {eta.minsLate >= 10 && (
          <span className="text-[11px] font-semibold" style={{ color: "var(--color-closing)" }}>
            Running ~{eta.minsLate} min behind schedule
          </span>
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
        <span className={cx("md-score text-ink", compact ? "text-3xl" : "text-4xl")}>~{fmtTime(eta.etaIso)}</span>
        <span className="text-sm text-ink-2">{queue}{eta.court ? ` · ${eta.court}` : ""}</span>
      </div>
      {!compact && (
        <div className="mt-1.5 text-[11px] text-ink-3">
          {eta.basis === "OBSERVED"
            ? `From today's pace: matches here are taking about ${eta.durationMins} min (${eta.sample} played).`
            : `Estimated from the planned ${eta.durationMins}-min match length until more matches finish.`}
          {eta.waitingOnResult && " Your opponent depends on an earlier result."}
          {" "}Be at the court a little before this time.
        </div>
      )}
    </div>
  );
}
