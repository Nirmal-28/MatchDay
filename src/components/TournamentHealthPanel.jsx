import { useMemo } from "react";
import {
  Activity, AlertTriangle, ArrowRight, CheckCircle2, Clock, Gauge, Info, Wand2,
} from "lucide-react";
import { cx, fmtDuration, TONE_CLASSES } from "../lib/engines";
import {
  tournamentHealth, HEALTH_STATUS_META, SEVERITY_TONE, fmtClock, CONFIDENCE_NOTE,
} from "../lib/intelligence";
import { Badge, Card } from "./ui/primitives";

/* Tournament Health — the judgement layer over the Command Center's numbers.
   "43 of 48 matches done" is a fact; "you will finish at 7:42 PM and Court 2
   is the reason it isn't 7:15" is a decision an organizer can act on.

   Everything rendered here comes from lib/intelligence.js, which returns
   `{ available: false, reason }` for anything it cannot derive honestly. This
   component renders that reason rather than hiding the row, because an
   organizer who sees a blank projection assumes the tournament is fine. */

function Metric({ label, value, sub, tone = "ink", icon: Icon }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-ink-3">
        {Icon && <Icon size={11} />} {label}
      </div>
      <div className={cx(
        "font-display text-2xl font-bold leading-tight",
        tone === "teal" ? "text-accent-teal" : tone === "red" ? "text-red-300" : tone === "amber" ? "text-amber-300" : "text-white"
      )}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[11px] leading-snug text-ink-3">{sub}</div>}
    </div>
  );
}

export default function TournamentHealthPanel({
  tournament, courts, entries, matches, members = [], onGoToTab, now,
}) {
  const health = useMemo(
    () => tournamentHealth({ tournament, courts, entries, matches, members, now }),
    [tournament, courts, entries, matches, members, now]
  );

  const { status, progress, checkIn, finish, deviation, issues, recommendation, duration } = health;
  const statusMeta = HEALTH_STATUS_META[status];

  // The projection is the headline, so how it is qualified matters as much as
  // the time itself. Before the first match is due, the honest phrasing is
  // how long the tournament RUNS, not how long is "left" — nothing is
  // elapsing yet, and "2h 38m left" before anyone has served is a lie.
  const finishValue = !finish.available ? "—"
    : finish.complete ? "Finished"
    : fmtClock(finish.iso, now);
  const finishSub = !finish.available ? finish.reason
    : finish.complete ? "Every match is done."
    : finish.pending
      ? `Runs about ${fmtDuration(finish.minsRemaining)} from the ${fmtClock(finish.startsAtIso, now)} start · ${CONFIDENCE_NOTE[finish.confidence]}`
      : `${fmtDuration(finish.minsRemaining)} left · ${CONFIDENCE_NOTE[finish.confidence]}`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-2">
          <Gauge size={13} /> Tournament health
        </h3>
        <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric
          label="Matches" icon={CheckCircle2}
          value={`${progress.completed} / ${progress.total}`}
          sub={`${progress.pct}% complete`}
          tone={progress.pct === 100 ? "teal" : "ink"}
        />
        <Metric
          label="Check-in" icon={CheckCircle2}
          value={checkIn.pct === null ? "—" : `${checkIn.pct}%`}
          sub={checkIn.pct === null ? "No participants registered yet." : `${checkIn.checkedIn} of ${checkIn.expected} arrived`}
          tone={checkIn.pct !== null && checkIn.pct < 70 ? "amber" : "ink"}
        />
        <Metric
          label="Projected finish" icon={Clock}
          value={finishValue} sub={finishSub}
          tone={finish.available && !finish.complete && finish.confidence === "LOW" ? "amber" : "teal"}
        />
        <Metric
          label="Running to time" icon={Activity}
          value={
            !deviation.available ? "—"
              : deviation.direction === "ON_TIME" ? "On time"
              : `${Math.abs(deviation.minsBehind)}m ${deviation.direction === "BEHIND" ? "late" : "early"}`
          }
          sub={deviation.available ? `Across ${deviation.sample} started matches` : deviation.reason}
          tone={deviation.available && deviation.direction === "BEHIND" && deviation.minsBehind >= 10 ? "red" : "ink"}
        />
      </div>

      {/* Progress bar — the same number as the metric, but readable across a
          room, which is how it gets used on tournament day. */}
      <div>
        <div className="mb-1 flex items-center justify-between text-[11px] text-ink-3">
          <span>Progress</span>
          <span className="font-medium text-white">{progress.completed} / {progress.total}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-accent-teal to-accent-blue transition-[width] duration-500"
            style={{ width: `${progress.pct}%` }}
          />
        </div>
      </div>

      {/* ── Attention ───────────────────────────────────────────────────── */}
      {issues.length > 0 ? (
        <div>
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-2">
            <AlertTriangle size={12} className="text-amber-400" /> Attention
          </div>
          <div className="space-y-1.5">
            {issues.map((i) => (
              <button
                key={i.key}
                onClick={() => onGoToTab?.(i.tab)}
                className={cx(
                  "flex w-full items-start justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition-opacity hover:opacity-80",
                  TONE_CLASSES[SEVERITY_TONE[i.severity]]
                )}
              >
                <span className="min-w-0">
                  <span className="block text-xs font-semibold">{i.title}</span>
                  <span className="mt-0.5 block text-[11px] opacity-80">{i.detail}</span>
                </span>
                <ArrowRight size={13} className="mt-0.5 shrink-0 opacity-70" />
              </button>
            ))}
          </div>
        </div>
      ) : (
        <Card className="flex items-center gap-2 px-4 py-3 text-sm text-ink-2">
          <CheckCircle2 size={15} className="text-emerald-400" />
          Nothing needs attention right now.
        </Card>
      )}

      {/* ── The one recommended action ──────────────────────────────────── */}
      {recommendation && (
        <button
          onClick={() => onGoToTab?.(recommendation.tab)}
          className="flex w-full items-center justify-between gap-3 rounded-lg border border-accent-teal/40 bg-accent-teal/10 px-4 py-3 text-left transition-colors hover:bg-accent-teal/15"
        >
          <span className="flex min-w-0 items-start gap-2.5">
            <Wand2 size={15} className="mt-0.5 shrink-0 text-accent-teal" />
            <span className="min-w-0">
              <span className="block text-[10px] uppercase tracking-wide text-accent-teal">Recommended action</span>
              <span className="block text-sm font-semibold text-ink">{recommendation.label}</span>
              <span className="mt-0.5 block text-[11px] text-ink-2">{recommendation.why}</span>
            </span>
          </span>
          <ArrowRight size={14} className="shrink-0 text-accent-teal" />
        </button>
      )}

      {/* How the projection was reached. Stated plainly, because an organizer
          about to tell 60 players "we finish at 7:40" deserves to know whether
          that came from real data or from a setting they typed in once. */}
      <div className="flex gap-2 rounded-md border border-line bg-surface-2 px-3 py-2.5 text-[11px] leading-relaxed text-ink-3">
        <Info size={12} className="mt-px shrink-0" />
        <span>
          {duration.basis === "OBSERVED"
            ? `Matches here are taking about ${duration.mins} min (median of ${duration.sample} completed).`
            : `Using your configured ${duration.mins} min match length — no matches have finished yet, so this is a plan, not a measurement.`}
          {finish.available && !finish.complete && (
            <> Finish time assumes {finish.courtsUsed} court{finish.courtsUsed === 1 ? "" : "s"} stay available
              {finish.limitedBy === "DEPENDENCIES" ? " and is limited by rounds that must run in sequence" : ""}.</>
          )}
        </span>
      </div>
    </div>
  );
}
