import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { LayoutGrid, Activity } from "lucide-react";
import {
  fmtTime, relativeTime, fmtDuration, entryShort, divisionLabel, matchStageLabel,
} from "../lib/engines";
import { commandCenter, courtUtilization } from "../lib/analytics";
import { SectionHeader, StatTile, MatchCard, StatusPill } from "../components/ui/md";
import TournamentHealthPanel from "./TournamentHealthPanel";

/* ═══════════════════════════════════════════════════════════════════════
   TOURNAMENT COMMAND CENTER
   ═══════════════════════════════════════════════════════════════════════

   The one screen that answers "what is happening in my tournament right
   now?" — and, immediately after it, "what needs me?".

   This is an OPERATIONS surface, not a marketing one, so it is built to be
   read at a glance by someone standing at a desk with a queue in front of
   them: large numerals, status carried by colour, and the attention list
   directly under the status band rather than below three sections of
   reference material.

   The reading order is deliberate:

     1. STATUS BAND    are we live, and are we on schedule
     2. ATTENTION      the things only a human can resolve
     3. LIVE           what is on court, with running scores
     4. COURTS         the physical floor, as lanes
     5. UP NEXT        what is about to happen, with overdue flagged

   It renders entirely from data the control center has already loaded —
   participants, matches, courts, check-in and scheduling — so it can never
   drift out of step with the tabs it summarises. No figure here is
   estimated: every one is a count or an average over real rows.
   ══════════════════════════════════════════════════════════════════════ */

const COURT_STATE = {
  LIVE: { label: "In play", color: "var(--color-live)" },
  NEXT: { label: "Next up", color: "var(--color-accent-teal)" },
  AVAILABLE: { label: "Free", color: "var(--color-open)" },
  UNAVAILABLE: { label: "Closed", color: "var(--color-full)" },
};

/* A court, drawn as a lane rather than a table row. The court name is set
   in display type at the leading edge because on a busy floor "which court"
   is the index everything else hangs off. */
function CourtLane({ c, name }) {
  const meta = COURT_STATE[c.state];
  return (
    <div
      className="md-card md-edge flex items-center gap-3.5 px-3.5 py-3 pl-5"
      style={{ "--md-edge": meta.color }}
    >
      <div className="md-display w-16 shrink-0 truncate text-2xl text-ink" title={c.court.name}>
        {c.court.name}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] text-ink-2">
          {c.state === "LIVE" && `${name(c.liveMatch.entry_a)} vs ${name(c.liveMatch.entry_b)}`}
          {c.state === "NEXT" && (
            <>
              {fmtTime(c.nextMatch.scheduled_at)} · {name(c.nextMatch.entry_a)} vs {name(c.nextMatch.entry_b)}
              {c.nextIsLate && (
                <span className="ml-1.5 font-bold" style={{ color: "var(--color-live)" }}>late</span>
              )}
            </>
          )}
          {c.state === "AVAILABLE" && <span className="text-ink-3">Nothing on this court</span>}
          {c.state === "UNAVAILABLE" && <span className="text-ink-3">Marked unavailable</span>}
        </div>
      </div>
      <span
        className="md-status shrink-0"
        style={{ "--md-status": meta.color }}
      >
        {c.state === "LIVE" && <span className="md-live-dot" />}
        {meta.label}
      </span>
    </div>
  );
}

export default function CommandCenterPanel({ tournament, events, courts, entries, matches, entriesById, members = [], onGoToTab }) {
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

  // `attention` is deliberately not destructured — TournamentHealthPanel is
  // now the single source of the attention list (see below).
  const { participation: p, matches: ms, board, live, upNext } = cc;
  const name = (id) => entryShort(entriesById[id]) || "TBD";

  const isLive = tournament.status === "LIVE";
  const late = ms.runningLate.length;

  return (
    <div className="space-y-7">
      {/* ── 1. Status band ───────────────────────────────────────────────
          The single most important line on the screen is not a number, it is
          a verdict: on schedule, or running late. That verdict is stated in
          words, in the status colour, before any of the counts. */}
      <section className="md-court-texture relative overflow-hidden rounded-2xl border border-line bg-gradient-to-b from-navy-800 to-surface p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {isLive ? <StatusPill status="live" /> : <span className="md-status md-status-full">{tournament.status.replace(/_/g, " ")}</span>}
            <span
              className="md-display text-2xl"
              style={{ color: late ? "var(--color-closing)" : "var(--color-open)" }}
            >
              {late ? `${late} match${late === 1 ? "" : "es"} running late` : "On schedule"}
            </span>
          </div>
          <div className="text-[11px] text-ink-3">
            Updated {fmtTime(new Date(now).toISOString())}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          <StatTile label="Live" value={ms.live} tone={ms.live ? "live" : undefined}
            sub={`${cc.courtsBusy} of ${courts.length} courts`} />
          <StatTile label="Participants" value={p.active}
            sub={p.waitlisted ? `${p.waitlisted} waitlisted` : `${p.confirmed} confirmed`} />
          <StatTile label="Checked in" value={p.checkedIn} tone={p.checkedIn ? "open" : undefined}
            sub={`${p.notCheckedIn} still to arrive`} />
          <StatTile label="Completed" value={ms.completed} tone="done" sub={`of ${ms.total} matches`} />
          <StatTile label="Remaining" value={ms.remaining}
            sub={ms.unscheduled ? `${ms.unscheduled} unscheduled` : "all scheduled"} />
          <StatTile label="Courts free" value={cc.courtsFree} tone="open"
            sub={util ? `${util.overallPct}% booked` : "no schedule yet"} />
        </div>

        {/* Tournament progress. The bar animates its width only when the
            number actually changes — a completed match is an event. */}
        <div className="mt-5">
          <div className="mb-1.5 flex items-center justify-between text-[11px]">
            <span className="md-eyebrow">Tournament progress</span>
            <span className="md-score text-sm text-ink">{ms.progressPct}%</span>
          </div>
          <div
            className="h-2.5 overflow-hidden rounded-full bg-surface-2"
            role="progressbar" aria-valuenow={ms.progressPct} aria-valuemin={0} aria-valuemax={100}
            aria-label="Matches completed"
          >
            <div
              className="h-full rounded-full bg-gradient-to-r from-accent-teal to-accent-blue transition-[width] duration-500"
              style={{ width: `${ms.progressPct}%` }}
            />
          </div>
        </div>
      </section>

      {/* ── 2. Attention ─────────────────────────────────────────────────
          Owns the attention list outright. It previously lived in the status
          band as a row of chips built by commandCenter(); the intelligence
          layer computes a strict superset (those items plus delay,
          bottleneck, rest and officials analysis) with severity attached,
          and two competing "needs attention" lists on one screen is how an
          organizer learns to trust neither. */}
      <TournamentHealthPanel
        tournament={tournament} courts={courts}
        entries={entries} matches={matches} members={members}
        onGoToTab={onGoToTab} now={now}
      />

      {/* ── 3. Live ──────────────────────────────────────────────────── */}
      <section>
        <SectionHeader
          eyebrow="On court"
          title={
            <span className="flex items-center gap-2.5">
              {live.length > 0 && <span className="md-live-dot" />} Live matches
            </span>
          }
          action={live.length > 0 ? <span className="text-xs text-ink-3">{live.length} in play</span> : null}
        />
        {live.length === 0 ? (
          <div className="md-card px-4 py-8 text-center text-sm text-ink-3">
            {isLive ? "No match is being scored right now." : "Nothing live — the tournament hasn't started."}
          </div>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {live.map((item) => (
              <MatchCard
                key={item.match.id}
                to={`/m/${item.match.id}`}
                match={{
                  status: "live",
                  sport: tournament.sport,
                  round: matchStageLabel(item.match, item.event),
                  event: divisionLabel(item.event),
                  court: item.match.court || item.match.courts?.name || null,
                  // Elapsed time on court is the organizer's version of a
                  // clock: it is how a delay is spotted before it cascades.
                  time: item.elapsedMins !== null ? `${fmtDuration(item.elapsedMins)} on court` : null,
                  sideA: { name: name(item.match.entry_a), score: item.scoreA },
                  sideB: { name: name(item.match.entry_b), score: item.scoreB },
                  note: `Games ${item.gameTally.a}–${item.gameTally.b}`,
                }}
              />
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-7 lg:grid-cols-2">
        {/* ── 4. Courts ──────────────────────────────────────────────── */}
        <section>
          <SectionHeader eyebrow="The floor" title="Court status" />
          {courts.length === 0 ? (
            <div className="md-card px-4 py-8 text-center text-sm text-ink-3">No courts configured yet.</div>
          ) : (
            <div className="space-y-2">
              {board.map((c) => <CourtLane key={c.court.id} c={c} name={name} />)}
            </div>
          )}
          {util && (
            <div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-ink-3">
              <LayoutGrid size={11} />
              Court utilization {util.overallPct}% of scheduled availability.
            </div>
          )}
        </section>

        {/* ── 5. Up next ─────────────────────────────────────────────── */}
        <section>
          <SectionHeader eyebrow="About to happen" title="Up next" />
          {upNext.length === 0 ? (
            <div className="md-card px-4 py-8 text-center text-sm text-ink-3">
              Nothing scheduled ahead. Generate or publish a schedule to fill this in.
            </div>
          ) : (
            <div className="space-y-2">
              {upNext.map(({ match, event, late: isLate }) => (
                <Link key={match.id} to={`/m/${match.id}`} className="block">
                  <div
                    className="md-card md-card-link md-edge flex items-center justify-between gap-3 px-3.5 py-3 pl-5"
                    style={{ "--md-edge": isLate ? "var(--color-live)" : "var(--color-line)" }}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-ink">
                        {name(match.entry_a)} <span className="text-ink-3">vs</span> {name(match.entry_b)}
                      </div>
                      <div className="truncate text-[11px] text-ink-3">
                        {divisionLabel(event)} · {matchStageLabel(match, event)}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div
                        className="md-score text-xl"
                        style={{ color: isLate ? "var(--color-live)" : "var(--color-ink)" }}
                      >
                        {fmtTime(match.scheduled_at)}
                      </div>
                      <div className="text-[11px] text-ink-3">
                        {match.court || "Court TBD"}
                        {isLate ? " · overdue" : ` · ${relativeTime(match.scheduled_at, now)}`}
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* ── Timing health ────────────────────────────────────────────────
          Only rendered once there is enough completed play to average over,
          so an organizer is never shown a confident-looking figure derived
          from one match. */}
      {(ms.avgDurationMins !== null || ms.avgDelayMins !== null) && (
        <section>
          <SectionHeader
            eyebrow="Measured, not estimated"
            title={<span className="flex items-center gap-2"><Activity size={18} /> Running to time</span>}
          />
          <div className="grid gap-2.5 sm:grid-cols-3">
            {ms.avgDurationMins !== null && (
              <StatTile
                label="Average match length"
                value={fmtDuration(ms.avgDurationMins)}
                sub={`from ${ms.durationSample} completed matches`}
              />
            )}
            {ms.avgDelayMins !== null && (
              <StatTile
                label="Average start delay"
                value={fmtDuration(ms.avgDelayMins)}
                tone={ms.avgDelayMins > 15 ? "closing" : undefined}
                sub={`across ${ms.delaySample} started matches`}
              />
            )}
            <StatTile
              label="Running late now"
              value={late}
              tone={late ? "live" : undefined}
              sub="past their scheduled start"
            />
          </div>
        </section>
      )}
    </div>
  );
}

