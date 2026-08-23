import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ChevronLeft, Layers, Plus, Trash2, ArrowUp, ArrowDown, MapPin, CalendarDays,
  Trophy, Settings2, Radio, Info,
} from "lucide-react";
import {
  cx, fmtDate, fmtDateRange,
} from "../lib/engines";
import { tournamentStage } from "../lib/lifecycle";
import { SERIES_SCORING, computeSeriesStandings } from "../lib/seriesStandings";
import {
  getSeriesData, updateSeries, deleteSeries, setTournamentSeries,
  reorderSeriesTournaments, listAttachableTournaments, getSession,
} from "../lib/repository";
import { Badge, Btn, Card, Field, EmptyState, inputCls, useToasts, Toasts } from "../components/ui/primitives";
import { BrandLoader } from "../components/ui/motion";
import { useDocumentMeta } from "../lib/useDocumentMeta";

/* A series is a set of matchdays. Each matchday is an ordinary tournament with
   its own draws, schedule and results — this page adds the ordering and the
   cross-matchday table on top, and never duplicates the tournament model.

   Readable by anyone (the standings are public, like any published result);
   the management controls only render for the series owner. */

const TABS = [
  { key: "matchdays", label: "Matchdays", icon: CalendarDays },
  { key: "standings", label: "Standings", icon: Trophy },
  { key: "settings", label: "Settings", icon: Settings2 },
];

function MatchdayCard({ t, index, total, canManage, onMove, onRemove, events }) {
  const stage = tournamentStage(t, events);
  const evs = events.filter((e) => e.tournament_id === t.id);
  return (
    <Card className="p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-3 font-display text-sm font-bold text-ink-2">
            {t.series_round ?? index + 1}
          </div>
          <div className="min-w-0">
            <Link
              to={t.slug ? `/t/${t.slug}` : `/organizer/${t.id}`}
              className="truncate font-semibold text-ink hover:text-accent-teal"
            >
              {t.name}
            </Link>
            <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-ink-3">
              <span className="flex items-center gap-1"><CalendarDays size={10} />{fmtDateRange(t.start_date, t.end_date)}</span>
              {t.venue && <span className="flex items-center gap-1"><MapPin size={10} />{t.venue}</span>}
              {evs.length > 0 && <span>{evs.length} {evs.length === 1 ? "category" : "categories"}</span>}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Badge tone={stage.tone}>{t.status === "LIVE" ? <><Radio size={10} className="animate-pulse" /> Live</> : stage.label}</Badge>
        </div>
      </div>

      {canManage && (
        <div className="mt-2.5 flex items-center justify-between border-t border-line-soft pt-2">
          <div className="flex gap-1">
            <button
              className="rounded p-1.5 text-ink-3 hover:bg-surface-2 hover:text-ink disabled:opacity-30"
              disabled={index === 0} onClick={() => onMove(index, -1)} aria-label="Move earlier"
            ><ArrowUp size={14} /></button>
            <button
              className="rounded p-1.5 text-ink-3 hover:bg-surface-2 hover:text-ink disabled:opacity-30"
              disabled={index === total - 1} onClick={() => onMove(index, 1)} aria-label="Move later"
            ><ArrowDown size={14} /></button>
          </div>
          <div className="flex gap-2">
            <Link to={`/organizer/${t.id}`} className="text-xs font-medium text-accent-teal hover:underline">Manage</Link>
            <button className="text-xs font-medium text-ink-3 hover:text-red-400" onClick={() => onRemove(t)}>Remove</button>
          </div>
        </div>
      )}
    </Card>
  );
}

export default function SeriesPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toasts, notify } = useToasts();

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [userId, setUserId] = useState(null);
  const [tab, setTab] = useState("matchdays");
  useDocumentMeta({ title: data?.series?.name, description: data?.series?.name ? `Standings and matchdays for ${data.series.name} on Matchday.` : undefined });
  const [attachable, setAttachable] = useState([]);
  const [addOpen, setAddOpen] = useState(false);
  const [scoring, setScoring] = useState("standard");

  const load = useCallback(async () => {
    try { setData(await getSeriesData(id)); }
    catch (e) { setError(e.message); }
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { getSession().then((s) => setUserId(s?.user?.id ?? null)); }, []);

  const canManage = !!(data?.series && userId && data.series.owner_id === userId);

  useEffect(() => {
    if (canManage) listAttachableTournaments().then(setAttachable).catch(() => setAttachable([]));
  }, [canManage, data]);

  const standings = useMemo(
    () => (data ? computeSeriesStandings(data, { scoring, sport: data.series?.sport || "badminton" }) : null),
    [data, scoring]
  );

  if (error) return <EmptyState icon={Layers} title="Series not found" hint={error} />;
  if (!data || !standings) return <BrandLoader />;

  const { series, tournaments, events } = data;
  const ordered = [...tournaments].sort(
    (a, b) => (a.series_round ?? 999) - (b.series_round ?? 999) || (a.start_date || "").localeCompare(b.start_date || "")
  );

  const guarded = async (fn, ok) => {
    try { await fn(); await load(); if (ok) notify(ok); }
    catch (e) { notify(e.message, "error"); }
  };

  const move = (index, delta) => {
    const next = [...ordered];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    guarded(() => reorderSeriesTournaments(next.map((t) => t.id)), "Matchday order updated.");
  };

  const completed = ordered.filter((t) => ["COMPLETED", "ARCHIVED"].includes(t.status)).length;
  const participants = new Set(Object.values(data.entryToPlayer || {})).size;

  return (
    <div>
      <button className="mb-3 flex items-center gap-1 text-xs font-medium text-ink-2 hover:text-ink" onClick={() => navigate(-1)}>
        <ChevronLeft size={14} /> Back
      </button>

      {/* Header */}
      <div className="mb-5 rounded-2xl bg-navy-900 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-accent-teal">
              <Layers size={12} /> Series
            </div>
            <h1 className="mt-1 text-2xl font-bold text-white">{series.name}</h1>
            {series.description && <p className="mt-1 max-w-xl text-sm text-ink-2">{series.description}</p>}
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Matchdays", value: ordered.length },
            { label: "Completed", value: completed },
            { label: "Players", value: participants },
            { label: "Matches played", value: data.matches.length },
          ].map((s) => (
            <div key={s.label} className="rounded-lg border border-white/10 bg-white/5 p-3">
              <div className="font-display text-2xl font-bold text-white">{s.value}</div>
              <div className="text-[11px] uppercase tracking-wide text-ink-3">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs — settings only exists for the owner. */}
      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
        {TABS.filter((t) => t.key !== "settings" || canManage).map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={cx("flex flex-shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium",
              tab === t.key ? "border-accent-teal text-accent-teal" : "border-transparent text-ink-2 hover:text-ink")}>
            <t.icon size={14} />{t.label}
          </button>
        ))}
      </div>

      {/* ── Matchdays ─────────────────────────────────────────────────── */}
      {tab === "matchdays" && (
        <div className="space-y-3">
          {canManage && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-ink-3">Matchdays run in this order. Each one is a full tournament.</p>
              <Btn size="sm" variant="secondary" icon={Plus} onClick={() => setAddOpen((o) => !o)}>Add matchday</Btn>
            </div>
          )}

          {canManage && addOpen && (
            <Card className="p-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-2">Add an existing tournament</div>
              {attachable.length === 0 ? (
                <p className="text-sm text-ink-3">
                  You have no tournaments outside a series. Create one from the organizer workspace first — a
                  matchday is an ordinary tournament.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {attachable.map((t) => (
                    <div key={t.id} className="flex items-center justify-between gap-2 rounded-md border border-line px-3 py-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm text-ink">{t.name}</div>
                        <div className="text-[11px] text-ink-3">{fmtDate(t.start_date)} · {t.venue}</div>
                      </div>
                      <Btn size="sm" variant="secondary"
                        onClick={() => guarded(
                          () => setTournamentSeries(t.id, series.id, ordered.length + 1),
                          `${t.name} added to the series.`
                        )}>
                        Add
                      </Btn>
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-2 flex gap-1.5 text-[11px] text-ink-3">
                <Info size={12} className="mt-px shrink-0" />
                Only tournaments you own can be added — a series owner cannot pull in someone else&apos;s tournament.
              </p>
            </Card>
          )}

          {ordered.length === 0 ? (
            <EmptyState
              icon={CalendarDays} title="No matchdays yet"
              hint={canManage
                ? "Add a tournament you own as the first matchday. Its draws, schedule and results stay exactly as they are."
                : "This series has no matchdays yet."}
            />
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {ordered.map((t, i) => (
                <MatchdayCard
                  key={t.id} t={t} index={i} total={ordered.length} events={events}
                  canManage={canManage} onMove={move}
                  onRemove={(tt) => confirm(`Remove ${tt.name} from this series? The tournament itself is kept.`) &&
                    guarded(() => setTournamentSeries(tt.id, null, null), "Removed from series.")}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Standings ─────────────────────────────────────────────────── */}
      {tab === "standings" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-ink-2">Series standings</div>
              <p className="mt-0.5 max-w-lg text-[11px] text-ink-3">
                Aggregated from completed matches across {standings.playedMatchdays} played{" "}
                {standings.playedMatchdays === 1 ? "matchday" : "matchdays"}. A matchday that has not been
                played contributes nothing.
              </p>
            </div>
            <label className="text-[11px] text-ink-2">
              <span className="mb-1 block font-medium">Scoring</span>
              <select className={cx(inputCls, "w-auto py-1 text-xs")} value={scoring} onChange={(e) => setScoring(e.target.value)}>
                {Object.values(SERIES_SCORING).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </label>
          </div>
          <p className="text-[11px] text-ink-3">{standings.config.description}</p>

          {standings.table.length === 0 ? (
            <EmptyState
              icon={Trophy} title="No standings yet"
              hint={standings.playedMatchdays === 0
                ? "Standings appear once a matchday has completed matches."
                : `No player has yet competed in the ${standings.config.minMatchdays} matchdays this scoring model requires.`}
            />
          ) : (
            <>
              {/* Mobile: cards. Desktop: the full table. */}
              <div className="space-y-2 sm:hidden">
                {standings.table.map((r) => (
                  <Card key={r.playerId} className="flex items-center gap-3 p-3">
                    <div className={cx("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg font-display text-sm font-bold",
                      r.position === 1 ? "bg-accent-yellow/15 text-accent-yellow" : "bg-surface-3 text-ink-2")}>
                      {r.position}
                    </div>
                    <div className="min-w-0 flex-1">
                      <Link to={`/p/${r.playerId}`} className="truncate font-medium text-ink hover:text-accent-teal">{r.player.name}</Link>
                      <div className="text-[11px] text-ink-3">
                        {r.matchdays} matchday{r.matchdays === 1 ? "" : "s"} · {r.won}W {r.lost}L
                        {r.titles > 0 && <span className="text-accent-yellow"> · {r.titles} title{r.titles === 1 ? "" : "s"}</span>}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="font-display text-lg font-bold text-accent-teal">{r.points}</div>
                      <div className="text-[10px] uppercase text-ink-3">pts</div>
                    </div>
                  </Card>
                ))}
              </div>

              <div className="hidden overflow-x-auto rounded-md border border-line sm:block">
                <table className="w-full text-left text-sm">
                  <thead className="bg-surface-2 text-[11px] uppercase tracking-wide text-ink-2">
                    <tr>
                      <th className="px-3 py-2 font-medium">#</th>
                      <th className="px-3 py-2 font-medium">Player</th>
                      <th className="px-3 py-2 text-center font-medium">Matchdays</th>
                      <th className="px-3 py-2 text-center font-medium">Matches</th>
                      <th className="px-3 py-2 text-center font-medium">W</th>
                      <th className="px-3 py-2 text-center font-medium">L</th>
                      <th className="px-3 py-2 text-center font-medium">Titles</th>
                      <th className="px-3 py-2 text-center font-medium">Points</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-soft">
                    {standings.table.map((r) => (
                      <tr key={r.playerId}>
                        <td className="px-3 py-2 text-ink-3">{r.position}</td>
                        <td className="px-3 py-2">
                          <Link to={`/p/${r.playerId}`} className="font-medium text-ink hover:text-accent-teal hover:underline">
                            {r.player.name}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-center font-mono text-ink-2">{r.matchdays}</td>
                        <td className="px-3 py-2 text-center font-mono text-ink-2">{r.matches}</td>
                        <td className="px-3 py-2 text-center font-mono font-semibold text-ink">{r.won}</td>
                        <td className="px-3 py-2 text-center font-mono text-ink-2">{r.lost}</td>
                        <td className="px-3 py-2 text-center font-mono text-accent-yellow">{r.titles || "—"}</td>
                        <td className="px-3 py-2 text-center font-mono font-bold text-accent-teal">{r.points}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {standings.excludedBelowMinimum > 0 && (
                <p className="text-[11px] text-ink-3">
                  {standings.excludedBelowMinimum} player{standings.excludedBelowMinimum === 1 ? " is" : "s are"} not
                  listed yet — this scoring model needs {standings.config.minMatchdays} matchdays.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Settings ──────────────────────────────────────────────────── */}
      {tab === "settings" && canManage && (
        <div className="max-w-lg space-y-4">
          <Card className="space-y-3 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-2">Series details</div>
            <Field label="Name" required>
              <input className={inputCls} defaultValue={series.name}
                onBlur={(e) => e.target.value.trim() && e.target.value !== series.name &&
                  guarded(() => updateSeries(series.id, { name: e.target.value.trim() }), "Series updated.")} />
            </Field>
            <Field label="Description">
              <textarea rows={3} className={inputCls} defaultValue={series.description || ""}
                onBlur={(e) => e.target.value !== (series.description || "") &&
                  guarded(() => updateSeries(series.id, { description: e.target.value || null }), "Series updated.")} />
            </Field>
          </Card>

          <Card className="space-y-2 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-2">Danger zone</div>
            <p className="text-[11px] text-ink-3">
              Deleting the series does not delete its tournaments — they simply become standalone again, with every
              draw, schedule and result intact.
            </p>
            <Btn size="sm" variant="danger" icon={Trash2}
              onClick={() => confirm("Delete this series? The tournaments in it are kept.") &&
                guarded(async () => { await deleteSeries(series.id); navigate("/organizer"); })}>
              Delete series
            </Btn>
          </Card>
        </div>
      )}

      <Toasts toasts={toasts} />
    </div>
  );
}
