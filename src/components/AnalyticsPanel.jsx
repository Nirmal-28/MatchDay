import { useMemo } from "react";
import { BarChart3, Users, Swords, LayoutGrid, Clock, IndianRupee } from "lucide-react";
import { cx, inr, fmtDuration, divisionLabel } from "../lib/engines";
import { participationStats, matchStats, courtUtilization, financeStats } from "../lib/analytics";
import { Card } from "../components/ui/primitives";

/* Analytics on real rows only. Where the data cannot support a number — no
   completed matches to average, no schedule to measure utilization against —
   the figure is withheld with a short explanation instead of shown as zero,
   because a confident-looking 0 min average is worse than an honest gap.

   Only two chart forms are used, both because they carry information a table
   would not: a stacked bar for composition of a whole, and horizontal bars for
   comparing magnitudes across categories. */

function StatTile({ label, value, sub, tone, icon: Icon }) {
  return (
    <Card className="p-3.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-ink-3">
        {Icon && <Icon size={11} />}{label}
      </div>
      <div className={cx("font-display text-2xl font-bold leading-tight",
        tone === "teal" ? "text-accent-teal" : tone === "red" ? "text-red-300" : tone === "amber" ? "text-amber-300" : "text-ink")}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-ink-3">{sub}</div>}
    </Card>
  );
}

// Composition of one whole, e.g. registration statuses across all entries.
function StackedBar({ segments, total }) {
  if (!total) return <div className="h-2.5 rounded-full bg-surface-3" />;
  return (
    <>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-3">
        {segments.filter((s) => s.value > 0).map((s) => (
          <div key={s.label} className={s.className} style={{ width: `${(s.value / total) * 100}%` }} title={`${s.label}: ${s.value}`} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {segments.filter((s) => s.value > 0).map((s) => (
          <span key={s.label} className="flex items-center gap-1.5 text-[11px] text-ink-2">
            <span className={cx("h-2 w-2 rounded-full", s.className)} />
            {s.label} <span className="tabular-nums text-ink-3">{s.value}</span>
          </span>
        ))}
      </div>
    </>
  );
}

// Magnitude comparison across a handful of named rows.
function BarRows({ rows, format = (v) => v, max }) {
  const peak = max ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[minmax(6rem,10rem)_1fr_auto] items-center gap-2">
          <span className="truncate text-xs text-ink-2" title={r.label}>{r.label}</span>
          <div className="h-2 overflow-hidden rounded-full bg-surface-3">
            <div className={cx("h-full rounded-full", r.className || "bg-accent-teal")}
              style={{ width: `${Math.max(2, (r.value / peak) * 100)}%` }} />
          </div>
          <span className="text-right text-xs tabular-nums text-ink-3">{format(r.value)}</span>
        </div>
      ))}
    </div>
  );
}

export default function AnalyticsPanel({ tournament, events, courts, entries, matches, payments = [] }) {
  const p = useMemo(() => participationStats(entries), [entries]);
  const ms = useMemo(() => matchStats(matches), [matches]);
  const util = useMemo(() => courtUtilization(courts, matches, tournament), [courts, matches, tournament]);
  const fin = useMemo(() => financeStats(entries, events, payments), [entries, events, payments]);

  const entriesByEvent = useMemo(() => {
    const m = {};
    entries.forEach((e) => {
      if (["REJECTED", "CANCELLED"].includes(e.reg_status)) return;
      m[e.event_id] = (m[e.event_id] || 0) + 1;
    });
    return m;
  }, [entries]);

  return (
    <div className="space-y-6">
      {/* Participation */}
      <section>
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-2">
          <Users size={13} /> Participation
        </h3>
        <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <StatTile label="Total registrations" value={p.total} icon={Users} sub={`${p.active} active`} />
          <StatTile label="Confirmed" value={p.confirmed} tone="teal" />
          <StatTile label="Waitlist" value={p.waitlisted} tone={p.waitlisted ? "amber" : undefined} />
          <StatTile label="Checked in" value={p.checkedIn} tone="teal" sub={`${p.notCheckedIn} outstanding`} />
          <StatTile label="No-shows" value={p.noShows} tone={p.noShows ? "red" : undefined} />
        </div>
        <Card className="p-4">
          <div className="mb-2 text-[11px] uppercase tracking-wide text-ink-3">Registration status breakdown</div>
          <StackedBar
            total={p.total}
            segments={[
              { label: "Confirmed", value: p.confirmed, className: "bg-emerald-400" },
              { label: "Pending", value: p.pending, className: "bg-amber-400" },
              { label: "Waitlisted", value: p.waitlisted, className: "bg-indigo-400" },
              { label: "Rejected", value: p.rejected, className: "bg-red-400" },
              { label: "Cancelled", value: p.cancelled, className: "bg-slate-500" },
            ]}
          />
        </Card>
      </section>

      {/* Entries per category */}
      {events.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-2">Entries by category</h3>
          <Card className="p-4">
            <BarRows
              rows={events.map((e) => ({
                label: divisionLabel(e),
                value: entriesByEvent[e.id] || 0,
              }))}
              max={Math.max(1, ...events.map((e) => e.max_entries || 0), ...Object.values(entriesByEvent))}
              format={(v) => `${v}`}
            />
            <div className="mt-2 text-[11px] text-ink-3">Bars are scaled against the largest category capacity.</div>
          </Card>
        </section>
      )}

      {/* Matches */}
      <section>
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-2">
          <Swords size={13} /> Matches
        </h3>
        <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Completed" value={ms.completed} tone="teal" sub={`of ${ms.total}`} />
          <StatTile label="Remaining" value={ms.remaining} />
          <StatTile label="Live now" value={ms.live} tone={ms.live ? "red" : undefined} />
          <StatTile label="Progress" value={`${ms.progressPct}%`} icon={BarChart3} />
        </div>
        <Card className="p-4">
          <div className="mb-2 text-[11px] uppercase tracking-wide text-ink-3">Match pipeline</div>
          <StackedBar
            total={ms.total}
            segments={[
              { label: "Completed", value: ms.completed, className: "bg-emerald-400" },
              { label: "Live", value: ms.live, className: "bg-red-400" },
              { label: "Scheduled", value: Math.max(0, ms.scheduled - ms.completed - ms.live), className: "bg-teal-400" },
              { label: "Unscheduled", value: ms.unscheduled, className: "bg-slate-500" },
            ]}
          />
        </Card>
      </section>

      {/* Timing */}
      <section>
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-2">
          <Clock size={13} /> Timing
        </h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <Card className="p-3.5">
            <div className="text-[10px] uppercase tracking-wide text-ink-3">Average match duration</div>
            {ms.avgDurationMins === null ? (
              <p className="mt-1 text-xs text-ink-3">
                Not enough data yet — needs at least 3 completed matches with recorded start and end times.
                {ms.durationSample > 0 && ` (${ms.durationSample} so far)`}
              </p>
            ) : (
              <>
                <div className="font-display text-2xl font-bold text-ink">{fmtDuration(ms.avgDurationMins)}</div>
                <div className="text-[11px] text-ink-3">from {ms.durationSample} matches</div>
              </>
            )}
          </Card>
          <Card className="p-3.5">
            <div className="text-[10px] uppercase tracking-wide text-ink-3">Average start delay</div>
            {ms.avgDelayMins === null ? (
              <p className="mt-1 text-xs text-ink-3">Not enough started matches to measure schedule drift yet.</p>
            ) : (
              <>
                <div className={cx("font-display text-2xl font-bold", ms.avgDelayMins > 15 ? "text-red-300" : "text-ink")}>
                  {fmtDuration(ms.avgDelayMins)}
                </div>
                <div className="text-[11px] text-ink-3">across {ms.delaySample} matches</div>
              </>
            )}
          </Card>
          <Card className="p-3.5">
            <div className="text-[10px] uppercase tracking-wide text-ink-3">Currently running late</div>
            <div className={cx("font-display text-2xl font-bold", ms.runningLate.length ? "text-red-300" : "text-ink")}>
              {ms.runningLate.length}
            </div>
            <div className="text-[11px] text-ink-3">past scheduled start, not begun</div>
          </Card>
        </div>
      </section>

      {/* Courts */}
      <section>
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-2">
          <LayoutGrid size={13} /> Court utilization
        </h3>
        {!util ? (
          <Card className="px-4 py-6 text-center text-sm text-ink-3">
            Nothing to measure yet — utilization compares booked court time against each court&apos;s availability
            window, and no matches have been scheduled onto courts.
          </Card>
        ) : (
          <Card className="p-4">
            <div className="mb-3 text-[11px] uppercase tracking-wide text-ink-3">
              {util.overallPct}% of available court time is booked
            </div>
            <BarRows
              rows={util.rows.map((r) => ({
                label: r.court.name,
                value: r.pct,
                className: r.pct > 90 ? "bg-red-400" : r.pct > 60 ? "bg-amber-400" : "bg-accent-teal",
              }))}
              max={100}
              format={(v) => `${v}%`}
            />
            <div className="mt-2 text-[11px] text-ink-3">
              Based on {util.rows.reduce((n, r) => n + r.matches, 0)} scheduled matches against each court&apos;s
              daily availability window.
            </div>
          </Card>
        )}
      </section>

      {/* Revenue */}
      <section>
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-2">
          <IndianRupee size={13} /> Revenue
        </h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <StatTile label="Expected" value={inr(fin.expected)} sub={`${fin.registrations} billable entries`} />
          <StatTile label="Collected" value={inr(fin.collected)} tone="teal" sub={`${fin.collectionPct}% collected`} />
          <StatTile label="Outstanding" value={inr(fin.outstanding)} tone={fin.outstanding ? "amber" : undefined} />
        </div>
        <p className="mt-2 text-[11px] text-ink-3">Full breakdown, ledger and exports are on the Finance tab.</p>
      </section>
    </div>
  );
}
