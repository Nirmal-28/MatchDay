import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle, Radio, Clock, LayoutGrid, CheckCircle2, ArrowRight, Users, Activity,
} from "lucide-react";
import {
  cx, fmtTime, relativeTime, fmtDuration, entryShort, divisionLabel, matchStageLabel, TONE_CLASSES,
} from "../lib/engines";
import { commandCenter, courtUtilization } from "../lib/analytics";
import { Badge, Card } from "../components/ui/primitives";
import { LivePulse } from "../components/ui/motion";

/* The one screen that answers "what is happening in my tournament right now?"
   It renders entirely from data the control center has already loaded —
   participants, matches, courts, check-in and scheduling — so it can never
   drift out of step with the tabs it summarises. */

function Stat({ label, value, sub, tone = "ink", icon: Icon }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-ink-3">
        {Icon && <Icon size={11} />} {label}
      </div>
      <div className={cx("font-display text-2xl font-bold leading-tight", tone === "teal" ? "text-accent-teal" : tone === "red" ? "text-red-300" : "text-white")}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-ink-3">{sub}</div>}
    </div>
  );
}

function LiveMatchCard({ item }) {
  const { match, event, scoreA, scoreB, gameTally, elapsedMins } = item;
  return (
    <Link to={`/m/${match.id}`} className="block">
      <Card className="border-red-500/30 bg-red-500/[0.04] p-3.5 transition-colors hover:border-red-500/50">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="text-sm font-bold text-ink">{match.court || match.courts?.name || "Court —"}</span>
          <LivePulse />
        </div>
        <div className="mb-1.5 truncate text-[11px] uppercase tracking-wide text-ink-3">
          {divisionLabel(event)} · {matchStageLabel(match, event)}
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="truncate font-medium text-ink">{item.nameA}</span>
            <span className="font-mono text-lg font-bold tabular-nums text-ink">{scoreA}</span>
          </div>
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="truncate font-medium text-ink">{item.nameB}</span>
            <span className="font-mono text-lg font-bold tabular-nums text-ink">{scoreB}</span>
          </div>
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[11px] text-ink-3">
          <span>Games {gameTally.a}–{gameTally.b}</span>
          {elapsedMins !== null && <span>{fmtDuration(elapsedMins)} on court</span>}
        </div>
      </Card>
    </Link>
  );
}

const COURT_STATE = {
  LIVE: { label: "In play", tone: "red" },
  NEXT: { label: "Next up", tone: "teal" },
  AVAILABLE: { label: "Available", tone: "emerald" },
  UNAVAILABLE: { label: "Closed", tone: "slate" },
};

export default function CommandCenterPanel({ tournament, events, courts, entries, matches, entriesById, onGoToTab }) {
  // A live tournament changes with the clock, not only with the data — a
  // match becomes "running late" purely by time passing. Re-render on a
  // timer so the attention list stays truthful without a page refresh.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const cc = useMemo(
    () => commandCenter({ tournament, events, courts, entries, matches, now }),
    [tournament, events, courts, entries, matches, now]
  );
  const util = useMemo(() => courtUtilization(courts, matches, tournament), [courts, matches, tournament]);

  const { participation: p, matches: ms, board, live, upNext, attention } = cc;
  const name = (id) => entryShort(entriesById[id]) || "TBD";

  return (
    <div className="space-y-5">
      {/* ── Headline numbers ─────────────────────────────────────────── */}
      <div className="rounded-2xl bg-navy-900 p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-widest text-accent-teal">Right now</div>
          <div className="text-[11px] text-ink-3">Updated {fmtTime(new Date(now).toISOString())}</div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Live" value={ms.live} tone={ms.live ? "red" : "ink"} icon={Radio}
            sub={`${cc.courtsBusy} of ${courts.length} courts`} />
          <Stat label="Participants" value={p.active} icon={Users}
            sub={p.waitlisted ? `${p.waitlisted} waitlisted` : `${p.confirmed} confirmed`} />
          <Stat label="Checked in" value={p.checkedIn} tone={p.checkedIn ? "teal" : "ink"} icon={CheckCircle2}
            sub={`${p.notCheckedIn} still to arrive`} />
          <Stat label="Completed" value={ms.completed} icon={CheckCircle2} sub={`of ${ms.total} matches`} />
          <Stat label="Remaining" value={ms.remaining} icon={Clock}
            sub={ms.unscheduled ? `${ms.unscheduled} unscheduled` : "all scheduled"} />
          <Stat label="Courts free" value={cc.courtsFree} tone="teal" icon={LayoutGrid}
            sub={util ? `${util.overallPct}% booked` : "no schedule yet"} />
        </div>

        {/* Tournament progress */}
        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between text-[11px] text-ink-3">
            <span>Tournament progress</span>
            <span className="font-medium text-white">{ms.progressPct}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-gradient-to-r from-accent-teal to-accent-blue transition-[width] duration-500"
              style={{ width: `${ms.progressPct}%` }} />
          </div>
        </div>
      </div>

      {/* ── Attention ────────────────────────────────────────────────── */}
      {attention.length > 0 && (
        <div>
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-2">
            <AlertTriangle size={13} className="text-amber-400" /> Needs attention
          </h3>
          <div className="flex flex-wrap gap-2">
            {attention.map((a) => (
              <button key={a.key} onClick={() => onGoToTab?.(a.tab)}
                className={cx(
                  "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-80",
                  TONE_CLASSES[a.tone]
                )}>
                {a.label} <ArrowRight size={12} />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Live matches ─────────────────────────────────────────────── */}
      <div>
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-2">
          <Radio size={13} className="text-red-400" /> Live matches
        </h3>
        {live.length === 0 ? (
          <Card className="px-4 py-6 text-center text-sm text-ink-3">
            {tournament.status === "LIVE" ? "No match is being scored right now." : "Nothing live — the tournament hasn't started."}
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {live.map((item) => (
              <LiveMatchCard key={item.match.id} item={{ ...item, nameA: name(item.match.entry_a), nameB: name(item.match.entry_b) }} />
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* ── Courts ─────────────────────────────────────────────────── */}
        <div>
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-2">
            <LayoutGrid size={13} /> Court status
          </h3>
          {courts.length === 0 ? (
            <Card className="px-4 py-6 text-center text-sm text-ink-3">No courts configured yet.</Card>
          ) : (
            <div className="space-y-1.5">
              {board.map((c) => {
                const meta = COURT_STATE[c.state];
                return (
                  <Card key={c.court.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-ink">{c.court.name}</div>
                      <div className="truncate text-[11px] text-ink-3">
                        {c.state === "LIVE" && `${name(c.liveMatch.entry_a)} vs ${name(c.liveMatch.entry_b)}`}
                        {c.state === "NEXT" && (
                          <>
                            {fmtTime(c.nextMatch.scheduled_at)} · {name(c.nextMatch.entry_a)} vs {name(c.nextMatch.entry_b)}
                            {c.nextIsLate && <span className="ml-1 font-medium text-red-300">late</span>}
                          </>
                        )}
                        {c.state === "AVAILABLE" && "Free"}
                        {c.state === "UNAVAILABLE" && "Marked unavailable"}
                      </div>
                    </div>
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                  </Card>
                );
              })}
            </div>
          )}
          {util && (
            <div className="mt-2 text-[11px] text-ink-3">
              Court utilization {util.overallPct}% of scheduled availability.
            </div>
          )}
        </div>

        {/* ── Up next ────────────────────────────────────────────────── */}
        <div>
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-2">
            <Clock size={13} /> Up next
          </h3>
          {upNext.length === 0 ? (
            <Card className="px-4 py-6 text-center text-sm text-ink-3">
              Nothing scheduled ahead. Generate or publish a schedule to fill this in.
            </Card>
          ) : (
            <div className="space-y-1.5">
              {upNext.map(({ match, event, late }) => (
                <Link key={match.id} to={`/m/${match.id}`} className="block">
                  <Card className={cx("flex items-center justify-between gap-3 px-3.5 py-2.5 transition-colors hover:border-accent-teal/50",
                    late && "border-red-500/40")}>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-ink">
                        {name(match.entry_a)} <span className="text-ink-3">vs</span> {name(match.entry_b)}
                      </div>
                      <div className="truncate text-[11px] text-ink-3">{divisionLabel(event)} · {matchStageLabel(match, event)}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className={cx("font-mono text-sm", late ? "text-red-300" : "text-ink")}>{fmtTime(match.scheduled_at)}</div>
                      <div className="text-[11px] text-ink-3">
                        {match.court || "Court TBD"}{late ? " · overdue" : ` · ${relativeTime(match.scheduled_at, now)}`}
                      </div>
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Timing health ────────────────────────────────────────────── */}
      {(ms.avgDurationMins !== null || ms.avgDelayMins !== null) && (
        <div>
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-2">
            <Activity size={13} /> Running to time
          </h3>
          <div className="grid gap-3 sm:grid-cols-3">
            {ms.avgDurationMins !== null && (
              <Card className="p-3">
                <div className="text-[10px] uppercase tracking-wide text-ink-3">Average match length</div>
                <div className="font-display text-2xl font-bold text-ink">{fmtDuration(ms.avgDurationMins)}</div>
                <div className="text-[11px] text-ink-3">from {ms.durationSample} completed matches</div>
              </Card>
            )}
            {ms.avgDelayMins !== null && (
              <Card className="p-3">
                <div className="text-[10px] uppercase tracking-wide text-ink-3">Average start delay</div>
                <div className={cx("font-display text-2xl font-bold", ms.avgDelayMins > 15 ? "text-red-300" : "text-ink")}>
                  {fmtDuration(ms.avgDelayMins)}
                </div>
                <div className="text-[11px] text-ink-3">across {ms.delaySample} started matches</div>
              </Card>
            )}
            <Card className="p-3">
              <div className="text-[10px] uppercase tracking-wide text-ink-3">Running late now</div>
              <div className={cx("font-display text-2xl font-bold", ms.runningLate.length ? "text-red-300" : "text-ink")}>
                {ms.runningLate.length}
              </div>
              <div className="text-[11px] text-ink-3">past their scheduled start</div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
