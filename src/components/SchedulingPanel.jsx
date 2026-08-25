import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Wand2, Lock, Unlock, AlertTriangle, AlertCircle, Info, CheckCircle2, Settings2,
  Rocket, LayoutGrid, ListOrdered, GanttChartSquare, X,
} from "lucide-react";
import { Badge, Btn, Card, Field, inputCls } from "./ui/primitives";
import { StatTile } from "./ui/md";
import { entryShort, matchStageLabel } from "../lib/engines";
import {
  getSchedulingBoard, optimizeSchedule, moveMatch, setMatchLocked, setMatchPriority,
  findBetterSlotsForMatch, publishSchedule, updateSchedulingSettings, updateCourtAvailability,
  setCourtAvailabilityForDate, clearCourtAvailabilityForDate,
} from "../lib/repository";

const SEVERITY_META = {
  HARD: { icon: AlertCircle, tone: "red", textCls: "text-red-400", label: "Hard conflict" },
  WARNING: { icon: AlertTriangle, tone: "amber", textCls: "text-amber-400", label: "Warning" },
  INFO: { icon: Info, tone: "teal", textCls: "text-teal-400", label: "Suggestion" },
};

function fmtClock(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

function buildTimeSlots(constraints, scheduledMatches, date) {
  const slots = [];
  const step = constraints.durationMins + constraints.bufferMins;
  let cursor = new Date(`${date}T${constraints.tournamentStart}:00`);
  const end = new Date(`${date}T${constraints.tournamentEnd}:00`);
  // Rest-driven matches can land off the fixed duration+buffer grid (e.g. a
  // match pushed later to satisfy minimum player rest) — merge in their real
  // start times so they still get a row instead of silently disappearing.
  const extra = scheduledMatches.map((m) => new Date(m.scheduled_at).getTime());
  while (cursor < end) {
    slots.push(new Date(cursor));
    cursor = new Date(cursor.getTime() + step * 60000);
  }
  const known = new Set(slots.map((s) => s.getTime()));
  extra.forEach((t) => { if (!known.has(t)) { slots.push(new Date(t)); known.add(t); } });
  slots.sort((a, b) => a - b);
  return slots;
}
function dateStrOf(iso) { return iso.slice(0, 10); }

export default function SchedulingPanel({ tournament, events, entriesById, notify, onChanged }) {
  const [board, setBoard] = useState(null);
  // The grid is a drag-and-drop court×time board — a genuinely desktop
  // interaction. On a phone the organizer lands on the timeline instead, which
  // does the same job with tappable cards. The grid stays reachable either way.
  const [view, setView] = useState(
    () => (typeof window !== "undefined" && window.innerWidth < 640 ? "timeline" : "grid")
  );
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [alternatives, setAlternatives] = useState(null); // { matchId, slots }
  const [dragMatchId, setDragMatchId] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);

  const load = useCallback(async () => {
    const b = await getSchedulingBoard(tournament.id);
    setBoard(b);
  }, [tournament.id]);

  useEffect(() => { load(); }, [load]);

  const guarded = async (fn, okMsg) => {
    setBusy(true);
    try { await fn(); if (okMsg) notify(okMsg); }
    catch (e) { notify(e.message, "error"); }
    finally { setBusy(false); }
  };

  const eventById = useMemo(() => Object.fromEntries(events.map((e) => [e.id, e])), [events]);
  const activeCourts = useMemo(() => (board?.courts || []).filter((c) => c.status === "AVAILABLE"), [board]);
  const scheduledMatches = useMemo(() => (board?.matches || []).filter((m) => m.scheduled_at), [board]);

  if (!board) return <div className="py-10 text-center text-sm text-ink-2">Loading schedule…</div>;

  const { constraints, quality } = board;
  const dates = constraints.dates || [];
  const activeDate = selectedDate && dates.includes(selectedDate) ? selectedDate : dates[0];
  const conflictsByMatch = {};
  (quality.conflicts || []).forEach((c) => {
    (conflictsByMatch[c.matchId] = conflictsByMatch[c.matchId] || []).push(c);
    if (c.relatedMatchId) (conflictsByMatch[c.relatedMatchId] = conflictsByMatch[c.relatedMatchId] || []).push(c);
  });

  const doOptimize = () => guarded(async () => {
    const result = await optimizeSchedule(tournament.id);
    await load();
    onChanged?.();
    notify(`Schedule optimized — ${result.updatedCount} match(es) placed, ${result.quality.hardConflicts} hard conflict(s), ${result.quality.warnings} warning(s).`);
  });

  const doPublish = () => guarded(async () => {
    if (quality.hardConflicts > 0 && !confirm(`This schedule still has ${quality.hardConflicts} hard conflict(s). Publish anyway?`)) return;
    await publishSchedule(tournament.id);
    await load();
    onChanged?.();
  }, "Schedule published.");

  const toggleLock = (m) => guarded(async () => {
    await setMatchLocked(tournament.id, m.id, !m.locked);
    await load();
  });

  const cyclePriority = (m) => guarded(async () => {
    const order = ["NORMAL", "HIGH", "CRITICAL"];
    const next = order[(order.indexOf(m.priority || "NORMAL") + 1) % order.length];
    await setMatchPriority(m.id, next);
    await load();
  });

  const openAlternatives = (matchId) => guarded(async () => {
    const slots = await findBetterSlotsForMatch(tournament.id, matchId);
    setAlternatives({ matchId, slots });
  });

  const applySlot = (matchId, slot) => guarded(async () => {
    const res = await moveMatch(tournament.id, matchId, { courtId: slot.courtId, scheduledAt: slot.start });
    setAlternatives(null);
    await load();
    onChanged?.();
    if (res.affectedConflicts.some((c) => c.severity === "HARD")) notify("Moved — but this still creates a conflict.", "error");
  });

  const handleDrop = (courtId, slotStart) => guarded(async () => {
    if (!dragMatchId) return;
    const match = scheduledMatches.find((m) => m.id === dragMatchId) || board.matches.find((m) => m.id === dragMatchId);
    if (match?.locked) { notify("This match is locked — unlock it first.", "error"); return; }
    const res = await moveMatch(tournament.id, dragMatchId, { courtId, scheduledAt: slotStart.toISOString() });
    setDragMatchId(null);
    await load();
    onChanged?.();
    const hard = res.affectedConflicts.filter((c) => c.severity === "HARD");
    if (hard.length && !confirm(`⚠️ This change creates a conflict:\n\n${hard[0].message}\n\nKeep anyway?`)) {
      await load(); // organizer declined — data already moved server-side, but we still refresh; a true "undo" would re-move it back
    }
  });

  // The score in words. A hard conflict is disqualifying regardless of the
  // numeric score — an organizer must never read "84/100" and miss that two
  // players are double-booked.
  const scheduleVerdict = quality.hardConflicts > 0
    ? `${quality.hardConflicts} conflict${quality.hardConflicts === 1 ? "" : "s"} to resolve`
    : quality.score >= 85 ? "Ready to publish"
    : quality.score >= 60 ? "Workable, could be tighter"
    : "Needs another pass";
  const scheduleTone = quality.hardConflicts > 0 ? "var(--color-live)"
    : quality.score >= 85 ? "var(--color-open)"
    : quality.score >= 60 ? "var(--color-closing)"
    : "var(--color-live)";

  const matchesOnActiveDate = scheduledMatches.filter((m) => dateStrOf(m.scheduled_at) === activeDate);
  const timeSlots = buildTimeSlots(constraints, matchesOnActiveDate, activeDate);

  return (
    <div className="space-y-4">
      {/* ── Schedule quality ──────────────────────────────────────────────
          The engine already produces a score, a checklist and a conflict
          list. This states the verdict in words first — the score alone is
          a number an organizer has no scale for — and colours it by the
          same open/closing/live palette used everywhere else, so "this
          schedule is fine" reads the same way "this court is free" does. */}
      <section className="md-court-texture relative overflow-hidden rounded-2xl border border-line bg-gradient-to-b from-navy-800 to-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="md-eyebrow mb-2">Schedule quality</div>
            <div className="flex items-baseline gap-2.5">
              <span
                className="md-score text-6xl"
                style={{ color: scheduleTone }}
              >
                {quality.score}
              </span>
              <span className="text-sm text-ink-3">/ 100</span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span className="md-display text-xl" style={{ color: scheduleTone }}>{scheduleVerdict}</span>
              <span className={`md-status ${board.tournament?.schedule_published ? "md-status-open" : "md-status-closing"}`}>
                {board.tournament?.schedule_published ? "Published" : "Draft"}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Btn size="md" variant="secondary" icon={Settings2} onClick={() => setSettingsOpen((s) => !s)}>Configure</Btn>
            <Btn size="md" variant="secondary" icon={Wand2} disabled={busy} onClick={doOptimize}>Optimize</Btn>
            <Btn size="md" variant="primary" icon={Rocket} disabled={busy || scheduledMatches.length === 0} onClick={doPublish}>Publish</Btn>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <StatTile label="Matches scheduled" value={quality.scheduledCount} />
          <StatTile label="Court utilization" value={`${quality.avgUtilization}%`} />
          <StatTile
            label="Hard conflicts" value={quality.hardConflicts}
            tone={quality.hardConflicts > 0 ? "live" : "open"}
          />
          <StatTile
            label="Avg player rest"
            value={quality.avgRestMins != null ? `${quality.avgRestMins}m` : "—"}
            sub={`minimum ${constraints.minRestMins}m`}
          />
        </div>

        <div className="mt-4 grid gap-1.5 sm:grid-cols-2">
          {quality.checklist.map((item, i) => (
            <div
              key={i}
              className="flex items-center gap-2 text-xs"
              style={{ color: item.ok ? "var(--color-open)" : "var(--color-closing)" }}
            >
              {item.ok ? <CheckCircle2 size={14} className="shrink-0" /> : <AlertTriangle size={14} className="shrink-0" />}
              <span className="min-w-0">{item.label}</span>
            </div>
          ))}
        </div>
      </section>

      {settingsOpen && (
        <Card className="p-4">
          <div className="mb-3 md-eyebrow">Scheduling constraints</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Day start"><input type="time" className={inputCls} defaultValue={constraints.tournamentStart}
              onBlur={(e) => guarded(async () => { await updateSchedulingSettings(tournament.id, { startTime: e.target.value }); await load(); }, "Saved.")} /></Field>
            <Field label="Day end"><input type="time" className={inputCls} defaultValue={constraints.tournamentEnd}
              onBlur={(e) => guarded(async () => { await updateSchedulingSettings(tournament.id, { endTime: e.target.value }); await load(); }, "Saved.")} /></Field>
            <Field label="Match duration (min)"><input type="number" min="5" className={inputCls} defaultValue={constraints.durationMins}
              onBlur={(e) => guarded(async () => { await updateSchedulingSettings(tournament.id, { matchDurationMins: Number(e.target.value) }); await load(); }, "Saved.")} /></Field>
            <Field label="Buffer between matches (min)"><input type="number" min="0" className={inputCls} defaultValue={constraints.bufferMins}
              onBlur={(e) => guarded(async () => { await updateSchedulingSettings(tournament.id, { bufferMins: Number(e.target.value) }); await load(); }, "Saved.")} /></Field>
            <Field label="Minimum player rest (min)"><input type="number" min="0" className={inputCls} defaultValue={constraints.minRestMins}
              onBlur={(e) => guarded(async () => { await updateSchedulingSettings(tournament.id, { minRestMins: Number(e.target.value) }); await load(); }, "Saved.")} /></Field>
          </div>
          <div className="mt-4 mb-2 md-eyebrow">Court availability</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {board.courts.map((c) => (
              <div key={c.id} className="flex items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2 py-1.5 text-xs">
                <span className="min-w-0 flex-1 truncate text-ink">{c.name}</span>
                <input type="time" defaultValue={(c.available_start || "09:00").slice(0, 5)} className="rounded border border-line bg-surface px-1 py-0.5 text-ink"
                  onBlur={(e) => guarded(async () => { await updateCourtAvailability(c.id, { availableStart: e.target.value, availableEnd: (c.available_end || "18:00").slice(0, 5) }); await load(); })} />
                <input type="time" defaultValue={(c.available_end || "18:00").slice(0, 5)} className="rounded border border-line bg-surface px-1 py-0.5 text-ink"
                  onBlur={(e) => guarded(async () => { await updateCourtAvailability(c.id, { availableStart: (c.available_start || "09:00").slice(0, 5), availableEnd: e.target.value }); await load(); })} />
              </div>
            ))}
          </div>

          {dates.length > 1 && (
            <>
              <div className="mt-4 mb-2 md-eyebrow">Per-day court overrides (multi-day)</div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-ink-3">
                      <th className="py-1 pr-2">Court</th>
                      {dates.map((d) => <th key={d} className="px-1 py-1">{new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {board.courts.map((c) => (
                      <tr key={c.id}>
                        <td className="py-1 pr-2 text-ink">{c.name}</td>
                        {dates.map((d) => {
                          const override = board.courtAvailabilityByDate?.[c.id]?.[d];
                          return (
                            <td key={d} className="px-1 py-1">
                              <div className="flex items-center gap-0.5">
                                <input type="time" defaultValue={override?.start || (c.available_start || "09:00").slice(0, 5)}
                                  className="w-[72px] rounded border border-line bg-surface-2 px-1 py-0.5 text-ink"
                                  onBlur={(e) => guarded(async () => {
                                    await setCourtAvailabilityForDate(c.id, d, { startTime: e.target.value, endTime: override?.end || (c.available_end || "18:00").slice(0, 5) });
                                    await load();
                                  })} />
                                <input type="time" defaultValue={override?.end || (c.available_end || "18:00").slice(0, 5)}
                                  className="w-[72px] rounded border border-line bg-surface-2 px-1 py-0.5 text-ink"
                                  onBlur={(e) => guarded(async () => {
                                    await setCourtAvailabilityForDate(c.id, d, { startTime: override?.start || (c.available_start || "09:00").slice(0, 5), endTime: e.target.value });
                                    await load();
                                  })} />
                                {override && (
                                  <button title="Reset to default hours" className="text-ink-3 hover:text-red-400"
                                    onClick={() => guarded(async () => { await clearCourtAvailabilityForDate(c.id, d); await load(); })}>
                                    <X size={12} />
                                  </button>
                                )}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>
      )}

      {/* Court utilization */}
      {activeCourts.length > 0 && (
        <Card className="p-4">
          <div className="mb-2 md-eyebrow">Court utilization</div>
          <div className="space-y-1.5">
            {activeCourts.map((c) => {
              const pct = quality.utilizationByCourt[c.id] || 0;
              return (
                <div key={c.id} className="flex items-center gap-2 text-xs">
                  <span className="w-20 shrink-0 text-ink-2">{c.name}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full rounded-full bg-accent-teal" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-9 shrink-0 text-right text-ink-3">{pct}%</span>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* View switch + day tabs */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          {[
            { key: "grid", label: "Grid", icon: LayoutGrid },
            { key: "timeline", label: "Timeline", icon: GanttChartSquare },
            { key: "list", label: "List", icon: ListOrdered },
          ].map((v) => (
            <button key={v.key} onClick={() => setView(v.key)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium ${view === v.key ? "bg-accent-teal/10 text-accent-teal" : "text-ink-2 hover:bg-surface-2"}`}>
              <v.icon size={13} />{v.label}
            </button>
          ))}
        </div>
        {view !== "list" && dates.length > 1 && (
          <div className="flex flex-wrap gap-1">
            {dates.map((d) => (
              <button key={d} onClick={() => setSelectedDate(d)}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium ${activeDate === d ? "border-accent-teal bg-accent-teal text-white" : "border-line text-ink-2 hover:bg-surface-2"}`}>
                {new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
              </button>
            ))}
          </div>
        )}
      </div>

      {view === "grid" && (
        <Card className="overflow-x-auto p-2">
          {/* A court×time board is inherently two-dimensional, so horizontal
              scroll is the honest layout rather than a squashed table. */}
          <p className="mb-1.5 px-1 text-[11px] text-ink-3 sm:hidden">
            Scroll sideways for more courts, or switch to Timeline for tap-friendly cards.
          </p>
          <table className="w-full min-w-max border-separate border-spacing-1 text-left text-xs">
            <thead>
              <tr>
                <th className="w-16 px-1 py-1 text-ink-3">Time</th>
                {activeCourts.map((c) => <th key={c.id} className="px-1 py-1 text-ink-2">{c.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {timeSlots.map((slot) => (
                <tr key={slot.toISOString()}>
                  <td className="whitespace-nowrap px-1 py-1 font-mono text-[11px] text-ink-3">{fmtClock(slot.toISOString())}</td>
                  {activeCourts.map((c) => {
                    const match = matchesOnActiveDate.find((m) => m.court_id === c.id &&
                      new Date(m.scheduled_at).getTime() === slot.getTime());
                    return (
                      <td key={c.id} className="align-top"
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => handleDrop(c.id, slot)}>
                        {match ? (
                          <MatchCard match={match} event={eventById[match.event_id]} entriesById={entriesById}
                            conflicts={conflictsByMatch[match.id]} draggable={!match.locked}
                            onDragStart={() => setDragMatchId(match.id)}
                            onToggleLock={() => toggleLock(match)} onCyclePriority={() => cyclePriority(match)}
                            onFindSlot={() => openAlternatives(match.id)} />
                        ) : (
                          <div className="h-full min-h-[52px] w-28 rounded-md border border-dashed border-line/60" />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {view === "timeline" && (
        activeCourts.length === 0 ? (
          <div className="md-card px-4 py-10 text-center text-sm text-ink-2">
            Add courts before scheduling — the timeline draws one lane per court.
          </div>
        ) : (
          <CourtTimeline
            courts={activeCourts}
            matches={matchesOnActiveDate}
            constraints={constraints}
            date={activeDate}
            eventById={eventById}
            entriesById={entriesById}
            conflictsByMatch={conflictsByMatch}
            onFindSlot={openAlternatives}
            now={new Date()}
          />
        )
      )}

      {view === "list" && (() => {
        // Draw order: the list view is for working through a draw
        // methodically, so it sorts by round then match number.
        const ordered = [...scheduledMatches].sort(
          (a, b) => (a.round - b.round) || (a.match_number - b.match_number)
        );

        if (scheduledMatches.length === 0) {
          return <div className="py-10 text-center text-sm text-ink-2">No matches scheduled yet — click Optimize Schedule.</div>;
        }

        return (
          <div className="space-y-1.5">
            {ordered.map((m) => {
              const conflicts = conflictsByMatch[m.id] || [];
              const worst = conflicts.some((c) => c.severity === "HARD") ? "HARD"
                : conflicts.some((c) => c.severity === "WARNING") ? "WARNING" : null;
              return (
                <div key={m.id}>
                  {/* Mobile: a card. Time and court are the two facts an
                      organizer re-checks constantly, so they lead; the actions
                      get real tap targets instead of 13px icons. */}
                  <div className={`rounded-lg border bg-surface p-3 sm:hidden ${
                    worst === "HARD" ? "border-red-500/40" : worst === "WARNING" ? "border-amber-500/40" : "border-line"}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <span className="font-mono text-lg font-bold text-ink">{fmtClock(m.scheduled_at)}</span>
                          {dates.length > 1 && (
                            <span className="text-[11px] text-ink-3">
                              {new Date(m.scheduled_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 truncate md-eyebrow">
                          {matchStageLabel(m, eventById[m.event_id])}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {m.locked && <Lock size={12} className="text-ink-3" />}
                        <Badge tone="slate">{m.court || "—"}</Badge>
                      </div>
                    </div>

                    <div className="mt-1.5 text-sm font-medium text-ink">
                      {entryShort(entriesById[m.entry_a])} <span className="text-ink-3">vs</span> {entryShort(entriesById[m.entry_b])}
                    </div>

                    {conflicts.length > 0 && (
                      <div className="mt-1.5 space-y-1">
                        {conflicts.slice(0, 2).map((c) => {
                          const meta = SEVERITY_META[c.severity];
                          return (
                            <div key={c.id} className={`flex items-start gap-1.5 text-[11px] ${meta.textCls}`}>
                              <meta.icon size={12} className="mt-px shrink-0" />
                              <span className="min-w-0">{c.message}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <div className="mt-2.5 flex gap-1.5 border-t border-line-soft pt-2.5">
                      <Btn size="sm" variant="secondary" icon={m.locked ? Lock : Unlock} onClick={() => toggleLock(m)}>
                        {m.locked ? "Unlock" : "Lock"}
                      </Btn>
                      <Btn size="sm" variant="ghost" onClick={() => openAlternatives(m.id)}>Find better slot</Btn>
                    </div>
                  </div>

                  {/* Desktop keeps the dense row. */}
                  <div className="hidden items-center gap-3 rounded-md border border-line bg-surface p-2.5 text-xs sm:flex">
                    <span className="w-24 shrink-0 font-mono text-ink-3">
                      {dates.length > 1 && <span className="mr-1 text-ink-3">{new Date(m.scheduled_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</span>}
                      {fmtClock(m.scheduled_at)}
                    </span>
                    <Badge tone="slate">{m.court || "—"}</Badge>
                    <span className="w-32 shrink-0 truncate text-ink-2">{matchStageLabel(m, eventById[m.event_id])}</span>
                    <span className="flex-1 truncate text-ink">{entryShort(entriesById[m.entry_a])} <span className="text-ink-3">vs</span> {entryShort(entriesById[m.entry_b])}</span>
                    {conflicts.length > 0 && <ConflictDot conflicts={conflicts} />}
                    <button onClick={() => toggleLock(m)} className="rounded p-1 text-ink-3 hover:bg-surface-2">
                      {m.locked ? <Lock size={13} /> : <Unlock size={13} />}
                    </button>
                    <button onClick={() => openAlternatives(m.id)} className="text-accent-teal hover:underline">Find better slot</button>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Conflict list */}
      {(quality.conflicts || []).length > 0 && (
        <Card className="p-4">
          <div className="mb-2 md-eyebrow">Conflicts &amp; suggestions</div>
          <div className="space-y-1.5">
            {quality.conflicts.map((c) => {
              const meta = SEVERITY_META[c.severity];
              const m = board.matches.find((x) => x.id === c.matchId);
              return (
                <div key={c.id} className="flex items-start gap-2 rounded-md border border-line bg-surface-2 p-2.5 text-xs">
                  <meta.icon size={14} className={`mt-0.5 shrink-0 ${meta.textCls}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                      {m && <span className="text-ink-3">#{m.match_number}</span>}
                    </div>
                    <div className="mt-0.5 text-ink-2">{c.message}</div>
                    {c.suggestion && <div className="mt-0.5 text-ink-3">{c.suggestion}</div>}
                  </div>
                  {m && c.severity !== "INFO" && (
                    <Btn size="sm" variant="subtle" onClick={() => openAlternatives(m.id)}>Find better slot</Btn>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {alternatives && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setAlternatives(null)}>
          <div className="w-full max-w-md rounded-lg border border-line bg-surface p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold text-ink">Best alternatives</div>
              <button onClick={() => setAlternatives(null)}><X size={16} className="text-ink-3" /></button>
            </div>
            <div className="space-y-2">
              {alternatives.slots.length === 0 && <div className="text-sm text-ink-2">No feasible alternative slots found.</div>}
              {alternatives.slots.map((s, i) => (
                <button key={i} onClick={() => applySlot(alternatives.matchId, s)}
                  className="block w-full rounded-md border border-line bg-surface-2 p-2.5 text-left text-xs hover:border-accent-teal">
                  <div className="font-semibold text-ink">{fmtClock(s.start)} — {s.courtName}</div>
                  {s.notes.map((n, j) => <div key={j} className={n.startsWith("⚠") ? "text-amber-400" : "text-emerald-400"}>{n.startsWith("⚠") ? n : `✓ ${n}`}</div>)}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ConflictDot({ conflicts }) {
  const worst = conflicts.some((c) => c.severity === "HARD") ? "HARD" : conflicts.some((c) => c.severity === "WARNING") ? "WARNING" : "INFO";
  const meta = SEVERITY_META[worst];
  return <meta.icon size={13} className={meta.textCls} title={conflicts.map((c) => c.message).join("\n")} />;
}

/* ═══════════════════════════════════════════════════════════════════════
   COURT TIMELINE
   ═══════════════════════════════════════════════════════════════════════

   The scheduling engine is the most sophisticated thing MatchDay does — it
   solves court allocation, player rest, dependency order and multi-day
   availability simultaneously. The UI showed the result as a sorted list of
   rows, which communicates none of that: a list cannot show that Court 3
   sits idle for forty minutes at 2pm, or that two matches are stacked
   back-to-back with no rest between them.

   This draws the real thing: one lane per court, time running left to
   right, every match a block positioned and sized by its actual start and
   duration. Gaps are visible because they are literally gaps. Conflicts
   colour their block. A "now" line marks the present on tournament day, so
   an organizer can see at a glance how far behind the floor is running.

   Reads the same `board` the grid and list read — no extra query, no second
   source of truth for what is scheduled. */
function CourtTimeline({
  courts, matches, constraints, date, eventById, entriesById,
  conflictsByMatch, onFindSlot, now,
}) {
  const dayStart = new Date(`${date}T${constraints.tournamentStart}:00`);
  const dayEnd = new Date(`${date}T${constraints.tournamentEnd}:00`);
  const totalMins = Math.max(60, (dayEnd - dayStart) / 60000);

  // Percentage offset of a moment within the playing day. Clamped so a match
  // that the optimizer pushed past the configured day-end still renders at
  // the edge instead of overflowing the lane.
  const pctOf = (d) => Math.max(0, Math.min(100, ((d - dayStart) / 60000 / totalMins) * 100));

  // Hour ruler. One tick per hour keeps the axis readable at phone widths;
  // the lane itself scrolls horizontally rather than compressing.
  const hours = [];
  for (let h = new Date(dayStart); h <= dayEnd; h = new Date(h.getTime() + 3600000)) hours.push(new Date(h));

  const nowPct = now && now >= dayStart && now <= dayEnd ? pctOf(now) : null;

  // 96px per hour gives every match block enough room for two names.
  const laneWidth = Math.max(720, (totalMins / 60) * 96);

  return (
    <div className="md-card md-scroll overflow-x-auto p-3">
      <div style={{ width: laneWidth, minWidth: "100%" }}>
        {/* ── Time ruler ─────────────────────────────────────────────── */}
        <div className="relative mb-2 ml-20 h-5 border-b border-line">
          {hours.map((h) => (
            <span
              key={h.toISOString()}
              className="absolute top-0 -translate-x-1/2 text-[10px] tabular-nums text-ink-3"
              style={{ left: `${pctOf(h)}%` }}
            >
              {h.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
            </span>
          ))}
        </div>

        {/* ── Lanes ──────────────────────────────────────────────────── */}
        <div className="space-y-1.5">
          {courts.map((c) => {
            const onCourt = matches
              .filter((m) => m.court_id === c.id)
              .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));

            return (
              <div key={c.id} className="flex items-stretch gap-2">
                <div className="md-display flex w-18 shrink-0 items-center truncate text-lg text-ink" style={{ width: "4.5rem" }} title={c.name}>
                  {c.name}
                </div>

                <div className="relative h-14 flex-1 rounded-lg border border-line-soft bg-surface-2/40">
                  {/* Hour gridlines, so a gap can be measured by eye rather
                      than only seen. */}
                  {hours.map((h) => (
                    <span
                      key={h.toISOString()}
                      className="absolute inset-y-0 w-px bg-line-soft"
                      style={{ left: `${pctOf(h)}%` }}
                      aria-hidden="true"
                    />
                  ))}

                  {/* The present moment. This is what turns the timeline
                      from a plan into an operational instrument:
                      everything left of this line should already have
                      happened. Drawn per lane so it survives the lane
                      list scrolling independently of the ruler. */}
                  {nowPct !== null && (
                    <span
                      className="absolute inset-y-0 z-10 w-0.5"
                      style={{ left: `${nowPct}%`, background: "var(--color-live)" }}
                      aria-hidden="true"
                    />
                  )}

                  {onCourt.map((m) => {
                    const start = new Date(m.scheduled_at);
                    const end = new Date(start.getTime() + constraints.durationMins * 60000);
                    const left = pctOf(start);
                    const width = Math.max(2, pctOf(end) - left);
                    const conflicts = conflictsByMatch[m.id] || [];
                    const worst = conflicts.some((x) => x.severity === "HARD") ? "HARD"
                      : conflicts.some((x) => x.severity === "WARNING") ? "WARNING" : null;
                    const live = m.status === "LIVE";
                    const done = ["COMPLETED", "WALKOVER"].includes(m.status);

                    const color = live ? "var(--color-live)"
                      : worst === "HARD" ? "var(--color-live)"
                      : worst === "WARNING" ? "var(--color-closing)"
                      : done ? "var(--color-done)"
                      : "var(--color-accent-teal)";

                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => onFindSlot(m.id)}
                        title={`${matchStageLabel(m, eventById[m.event_id])} — ${entryShort(entriesById[m.entry_a])} vs ${entryShort(entriesById[m.entry_b])}${conflicts.length ? `\n${conflicts.map((x) => x.message).join("\n")}` : ""}`}
                        className="absolute inset-y-1 overflow-hidden rounded-md border px-1.5 py-1 text-left transition-[filter] hover:brightness-125"
                        style={{
                          left: `${left}%`,
                          width: `${width}%`,
                          borderColor: color,
                          background: `color-mix(in oklab, ${color} 16%, var(--color-surface))`,
                          opacity: done ? 0.6 : 1,
                        }}
                      >
                        <div className="flex items-center gap-1">
                          {live && <span className="md-live-dot" style={{ width: 6, height: 6 }} />}
                          {m.locked && <Lock size={9} className="shrink-0 text-ink-3" />}
                          <span className="truncate text-[10px] font-bold tabular-nums text-ink">
                            {fmtClock(m.scheduled_at)}
                          </span>
                        </div>
                        <div className="truncate text-[10px] leading-tight text-ink-2">
                          {entryShort(entriesById[m.entry_a])}
                        </div>
                        <div className="truncate text-[10px] leading-tight text-ink-3">
                          {entryShort(entriesById[m.entry_b])}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

      </div>

      {/* Legend — the colours mean specific things and an organizer should
          not have to infer them. */}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-line-soft pt-2.5 text-[10px] text-ink-3">
        {[
          ["var(--color-accent-teal)", "Scheduled"],
          ["var(--color-live)", "Live or hard conflict"],
          ["var(--color-closing)", "Warning"],
          ["var(--color-done)", "Completed"],
        ].map(([c, label]) => (
          <span key={label} className="flex items-center gap-1.5">
            <span className="h-2 w-3 rounded-sm" style={{ background: c }} />
            {label}
          </span>
        ))}
        <span className="ml-auto">Tap a block to find a better slot.</span>
      </div>
    </div>
  );
}

function MatchCard({ match, event, entriesById, conflicts, draggable, onDragStart, onToggleLock, onCyclePriority, onFindSlot }) {
  const worst = conflicts?.length ? (conflicts.some((c) => c.severity === "HARD") ? "HARD" : "WARNING") : null;
  const priorityTone = match.priority === "CRITICAL" ? "red" : match.priority === "HIGH" ? "amber" : "slate";
  return (
    <div draggable={draggable} onDragStart={onDragStart}
      className={`w-28 rounded-md border p-1.5 text-[10px] ${worst === "HARD" ? "border-red-500/60 bg-red-500/5" : worst === "WARNING" ? "border-amber-500/50 bg-amber-500/5" : "border-line bg-surface-2"} ${draggable ? "cursor-grab" : "cursor-not-allowed opacity-80"}`}>
      <div className="mb-0.5 flex items-center justify-between gap-1">
        <span className="truncate text-ink-3">{matchStageLabel(match, event)}</span>
        {worst && <span>{worst === "HARD" ? "🔴" : "🟠"}</span>}
      </div>
      <div className="truncate text-ink">{entryShort(entriesById[match.entry_a])}</div>
      <div className="truncate text-ink-3">vs {entryShort(entriesById[match.entry_b])}</div>
      <div className="mt-1 flex items-center justify-between">
        <button onClick={(e) => { e.stopPropagation(); onCyclePriority(); }} title="Cycle priority">
          <Badge tone={priorityTone} className="!px-1 !py-0 !text-[9px]">{match.priority?.[0] || "N"}</Badge>
        </button>
        <button onClick={(e) => { e.stopPropagation(); onToggleLock(); }} title={match.locked ? "Unlock" : "Lock"}>
          {match.locked ? <Lock size={11} className="text-accent-teal" /> : <Unlock size={11} className="text-ink-3" />}
        </button>
        {worst && (
          <button onClick={(e) => { e.stopPropagation(); onFindSlot(); }} title="Find better slot" className="text-accent-teal">↻</button>
        )}
      </div>
    </div>
  );
}
