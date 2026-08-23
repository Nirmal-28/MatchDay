import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ChevronLeft, MapPin, Calendar, Home, Users, Swords, LayoutGrid, Radio, Trophy, Settings, Play, ArrowRight,
  UserCheck, ClipboardList, ShieldAlert, Shield, IndianRupee, BarChart3, Download, Palette,
} from "lucide-react";
import { fmtDateRange, inr, EVENT_STATUS_META, FORMAT_META, divisionLabel } from "../lib/engines";
import {
  getTournament, listEvents, listCourts, listEntries, listMatches, listNotifications, markNotificationsRead,
  publishTournament, closeRegistration, startTournament, completeTournament, cancelTournament, updateTournament,
  addCourt, updateCourt, removeCourt, updateCourtAvailability,
  updateEntryStatus, removeEntry, devSimulatePayment, markRefunded, registerEntry,
  importEntries, promoteNextWaitlisted, updateEvent,
  generateDraw, generateRoundRobin, generateGroupStage, generateKnockoutFromGroups, setSeeds,
  startMatch, scorePoint, undoLastGame, retireMatch,
  subscribeToEvent,
  setCheckInStatus, checkInByCode,
  getMyRole, listPayments,
} from "../lib/repository";
import { Btn, Badge, Card, Field, inputCls, useToasts, Toasts } from "../components/ui/primitives";
import { BrandLoader, LivePulse } from "../components/ui/motion";
import ParticipantsPanel from "../components/ParticipantsPanel";
import SeedingPanel from "../components/SeedingPanel";
import StandingsPanel from "../components/StandingsPanel";
import BracketView from "../components/BracketView";
import SchedulingPanel from "../components/SchedulingPanel";
import CourtsPanel from "../components/CourtsPanel";
import LiveScoringBoard from "../components/LiveScoringBoard";
import ResultsPanel from "../components/ResultsPanel";
import NotificationBell from "../components/NotificationBell";
import CheckInPanel from "../components/CheckInPanel";
import AuditLogPanel from "../components/AuditLogPanel";
import DisputesPanel from "../components/DisputesPanel";
import CommandCenterPanel from "../components/CommandCenterPanel";
import StaffPanel from "../components/StaffPanel";
import FinancePanel from "../components/FinancePanel";
import AnalyticsPanel from "../components/AnalyticsPanel";
import ExportsPanel from "../components/ExportsPanel";
import BrandingPanel from "../components/BrandingPanel";
import FormatBuilder, { minEntriesFor } from "../components/FormatBuilder";
import { tournamentStage, canAct } from "../lib/lifecycle";

// <input type="datetime-local"> speaks local wall-clock time with no zone;
// the column is timestamptz. Convert explicitly in both directions rather
// than letting the browser guess.
const toLocalInput = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);

// `roles` gates a tab to those tournament roles; omit it for tabs everyone
// with any access may open. OWNER is the tournament creator.
const ORG_TABS = [
  { key: "overview", label: "Command center", icon: Home },
  { key: "participants", label: "Participants", icon: Users, roles: ["OWNER", "ORGANIZER", "ADMIN"] },
  { key: "draw", label: "Draw", icon: Swords, roles: ["OWNER", "ORGANIZER", "ADMIN"] },
  { key: "schedule", label: "Schedule", icon: Calendar, roles: ["OWNER", "ORGANIZER", "ADMIN"] },
  { key: "courts", label: "Courts", icon: LayoutGrid, roles: ["OWNER", "ORGANIZER", "ADMIN"] },
  { key: "checkin", label: "Check-in", icon: UserCheck, roles: ["OWNER", "ORGANIZER", "ADMIN", "VOLUNTEER"] },
  { key: "live", label: "Live scoring", icon: Radio, roles: ["OWNER", "ORGANIZER", "ADMIN", "REFEREE", "SCORER"] },
  { key: "results", label: "Results", icon: Trophy },
  { key: "staff", label: "Staff", icon: Shield, roles: ["OWNER", "ORGANIZER", "ADMIN"] },
  { key: "finance", label: "Finance", icon: IndianRupee, roles: ["OWNER", "ORGANIZER"] },
  { key: "analytics", label: "Analytics", icon: BarChart3, roles: ["OWNER", "ORGANIZER", "ADMIN"] },
  { key: "exports", label: "Exports", icon: Download, roles: ["OWNER", "ORGANIZER", "ADMIN"] },
  { key: "branding", label: "Branding", icon: Palette, roles: ["OWNER"] },
  { key: "disputes", label: "Disputes", icon: ShieldAlert, roles: ["OWNER", "ORGANIZER", "ADMIN", "REFEREE", "SCORER"] },
  { key: "audit", label: "Audit log", icon: ClipboardList, roles: ["OWNER", "ORGANIZER", "ADMIN"] },
  { key: "settings", label: "Settings", icon: Settings, roles: ["OWNER", "ORGANIZER"] },
];

export default function TournamentControlCenter() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [tournament, setTournament] = useState(null);
  const [events, setEvents] = useState([]);
  const [courts, setCourts] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [entriesByEvent, setEntriesByEvent] = useState({});
  const [matchesByEvent, setMatchesByEvent] = useState({});
  const [tab, setTab] = useState("overview");
  const [eventId, setEventId] = useState(null);
  const [role, setRole] = useState(undefined); // undefined = still checking
  const [payments, setPayments] = useState([]);
  const { toasts, notify } = useToasts();

  const loadEventData = useCallback(async (evs) => {
    const results = await Promise.all(evs.map(async (e) => ({
      id: e.id, entries: await listEntries(e.id), matches: await listMatches(e.id),
    })));
    const eb = {}, mb = {};
    results.forEach((r) => { eb[r.id] = r.entries; mb[r.id] = r.matches; });
    setEntriesByEvent(eb);
    setMatchesByEvent(mb);
  }, []);

  const loadAll = useCallback(async () => {
    const t = await getTournament(id);
    setTournament(t);
    const [evs, crts, notifs] = await Promise.all([listEvents(id), listCourts(id), listNotifications(id)]);
    setEvents(evs);
    setCourts(crts);
    setNotifications(notifs);
    setEventId((prev) => (evs.find((e) => e.id === prev) ? prev : evs[0]?.id ?? null));
    await loadEventData(evs);
  }, [id, loadEventData]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // A tournament can be opened by its owner or by staff. The role decides
  // which tabs exist at all; RLS enforces the same boundary on the server, so
  // hiding a tab is a usability choice, not the security control.
  useEffect(() => { getMyRole(id).then((r) => setRole(r || null)); }, [id]);

  // Payments only matter to the finance/analytics tabs and are owner-only by
  // RLS, so they are fetched lazily rather than on every load.
  useEffect(() => {
    if (tab !== "finance" && tab !== "analytics") return;
    listPayments(id).then(setPayments).catch(() => setPayments([]));
  }, [tab, id]);

  useEffect(() => {
    if (events.length === 0) return;
    const unsubs = events.map((e) => subscribeToEvent(e.id, loadAll));
    return () => unsubs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events.map((e) => e.id).join(",")]);

  const guarded = async (fn, okMsg) => {
    try { await fn(); if (okMsg) notify(okMsg); }
    catch (e) { notify(e.message, "error"); }
  };

  const entriesById = useMemo(() => {
    const m = {};
    Object.values(entriesByEvent).forEach((list) => list.forEach((e) => (m[e.id] = e)));
    return m;
  }, [entriesByEvent]);

  if (!tournament || role === undefined) return <BrandLoader />;

  const event = events.find((e) => e.id === eventId);
  const eventEntries = entriesByEvent[eventId] || [];
  const eventMatches = matchesByEvent[eventId] || [];
  const allMatches = Object.values(matchesByEvent).flat();
  const allEntries = Object.values(entriesByEvent).flat();
  const confirmedCount = eventEntries.filter((e) => e.reg_status === "CONFIRMED").length;
  const isOwner = role === "OWNER";
  // Derived from tournament status + event statuses + schedule_published, so
  // DRAW_READY and SCHEDULE_PUBLISHED never become a second source of truth.
  const stage = tournamentStage(tournament, events);
  const visibleTabs = ORG_TABS.filter((t) => !t.roles || t.roles.includes(role));
  const activeTab = visibleTabs.some((t) => t.key === tab) ? tab : "overview";

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <button className="flex items-center gap-1 text-xs font-medium text-ink-2 hover:text-ink" onClick={() => navigate("/organizer")}><ChevronLeft size={14} /> All tournaments</button>
        <div className="flex items-center gap-3">
          <button className="text-xs font-medium text-ink-2 hover:text-accent-teal" onClick={() => window.open(`/organizer/${tournament.id}/score`, "_blank")}>Scorer mode ↗</button>
          {tournament.slug && (
            <button className="text-xs font-medium text-ink-2 hover:text-accent-teal" onClick={() => window.open(`/t/${tournament.slug}/display`, "_blank")}>Venue display ↗</button>
          )}
          <NotificationBell notifications={notifications} onMarkRead={() => guarded(async () => { await markNotificationsRead(id); setNotifications((n) => n.map((x) => ({ ...x, read: true }))); })} />
        </div>
      </div>

      <div className="relative mb-5 overflow-hidden rounded-2xl bg-navy-900 p-5 sm:p-6">
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-widest text-accent-teal">Matchday control center</div>
            <div className="mt-1 flex items-center gap-2">
              <h1 className="text-xl font-bold text-white">{tournament.name}</h1>
              <Badge tone={stage.tone}>{stage.label}</Badge>
              {tournament.status === "LIVE" && <LivePulse />}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-3">
              <span className="flex items-center gap-1"><MapPin size={11} />{tournament.venue}</span>
              <span className="flex items-center gap-1"><Calendar size={11} />{fmtDateRange(tournament.start_date, tournament.end_date)}</span>
              {tournament.slug && <span className="flex items-center gap-1 text-accent-teal">/t/{tournament.slug}</span>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {tournament.status === "DRAFT" && (
              <Btn size="sm" icon={ArrowRight} onClick={() => guarded(async () => {
                await publishTournament(tournament.id, tournament.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
                await loadAll();
              }, "Published.")}>Publish</Btn>
            )}
            {tournament.status === "REGISTRATION_OPEN" && (
              <Btn size="sm" variant="secondary" onClick={() => guarded(async () => { await closeRegistration(tournament.id); await loadAll(); })}>Close registration</Btn>
            )}
            {tournament.status === "REGISTRATION_CLOSED" && (() => {
              const start = canAct("startTournament", { tournament, events, matches: allMatches, role });
              return (
                <Btn size="sm" icon={Play} disabled={!start.ok} title={start.reason || ""}
                  onClick={() => guarded(async () => { await startTournament(tournament.id); await loadAll(); }, "Tournament is live.")}>
                  Start tournament
                </Btn>
              );
            })()}
          </div>
        </div>
        <div className="relative mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Entries", value: Object.values(entriesByEvent).flat().length },
            { label: "Matches", value: allMatches.length },
            { label: "Courts", value: courts.length },
            { label: "Live now", value: allMatches.filter((m) => m.status === "LIVE").length },
          ].map((s) => (
            <div key={s.label} className="rounded-lg border border-white/10 bg-white/5 p-3 text-center sm:text-left">
              <div className="font-display text-3xl font-bold text-white">{s.value}</div>
              <div className="text-[11px] uppercase tracking-wide text-ink-3">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-5 lg:flex-row">
        <div className="flex gap-1 overflow-x-auto lg:w-48 lg:flex-none lg:flex-col lg:overflow-visible">
          {visibleTabs.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} className={`flex flex-shrink-0 items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors ${activeTab === t.key ? "bg-accent-teal/10 text-accent-teal" : "text-ink-2 hover:bg-surface-2"}`}>
              <t.icon size={15} />{t.label}
            </button>
          ))}
        </div>

        <div className="min-w-0 flex-1">
          {["participants", "draw", "results"].includes(activeTab) && events.length > 1 && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {events.map((e) => (
                <button key={e.id} onClick={() => setEventId(e.id)} className={`rounded-full border px-3 py-1 text-xs font-medium ${eventId === e.id ? "border-accent-teal bg-accent-teal text-white" : "border-line text-ink-2 hover:bg-surface-2"}`}>
                  {divisionLabel(e)}
                </button>
              ))}
            </div>
          )}

          {activeTab === "overview" && (
            <div className="space-y-5">
              <CommandCenterPanel
                tournament={tournament} events={events} courts={courts}
                entries={allEntries} matches={allMatches} entriesById={entriesById}
                onGoToTab={setTab}
              />
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-2">Categories</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {events.map((e) => {
                    const c = (entriesByEvent[e.id] || []).length;
                    return (
                      <Card key={e.id} className="flex items-center justify-between p-3">
                        <div>
                          <div className="text-sm font-medium text-ink">{divisionLabel(e)}</div>
                          <div className="text-xs text-ink-2">{c} / {e.max_entries} registered · {inr(e.fee_inr)}</div>
                        </div>
                        <Badge tone={EVENT_STATUS_META[e.status].tone}>{EVENT_STATUS_META[e.status].label}</Badge>
                      </Card>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {activeTab === "staff" && (
            <StaffPanel
              tournament={tournament} events={events} matches={allMatches}
              entriesById={entriesById} isOwner={isOwner} notify={notify}
              onChanged={() => loadEventData(events)}
            />
          )}

          {activeTab === "finance" && (
            <FinancePanel tournament={tournament} events={events} entries={allEntries} notify={notify} />
          )}

          {activeTab === "analytics" && (
            <AnalyticsPanel
              tournament={tournament} events={events} courts={courts}
              entries={allEntries} matches={allMatches} payments={payments}
            />
          )}

          {activeTab === "exports" && (
            <ExportsPanel
              tournament={tournament} events={events} courts={courts}
              entriesByEvent={entriesByEvent} matchesByEvent={matchesByEvent}
              entriesById={entriesById} notify={notify}
            />
          )}

          {activeTab === "branding" && (
            <BrandingPanel tournament={tournament} notify={notify} onChanged={loadAll} />
          )}

          {activeTab === "participants" && event && (
            <ParticipantsPanel
              event={event} entries={eventEntries}
              onApprove={(eid) => guarded(async () => { await updateEntryStatus(eid, "CONFIRMED"); await loadEventData(events); })}
              onReject={(eid) => guarded(async () => { await updateEntryStatus(eid, "REJECTED"); await loadEventData(events); })}
              onRemove={(eid) => guarded(async () => { await removeEntry(eid); await loadEventData(events); })}
              onSimPay={(eid) => guarded(async () => { await devSimulatePayment(eid, true); await loadEventData(events); })}
              onRefund={(eid) => guarded(async () => { await markRefunded(eid); await loadEventData(events); })}
              onAddManual={(eid, players) => guarded(async () => { await registerEntry(eid, players, event.fee_inr); await loadEventData(events); })}
              onImport={async (eid, rows) => {
                const res = await importEntries(eid, event.fee_inr, rows);
                await loadEventData(events);
                return res;
              }}
              onPromoteWaitlist={() => guarded(async () => {
                const id = await promoteNextWaitlisted(event.id);
                await loadEventData(events);
                return id ? notify("Next waitlisted participant promoted to pending.") : notify("Waitlist is empty.", "error");
              })}
              onToggleAutoPromote={(checked) => guarded(async () => { await updateEvent(event.id, { auto_promote_waitlist: checked }); await loadEventData(events); })}
            />
          )}

          {activeTab === "draw" && event && (() => {
            const format = event.format || "SINGLE_ELIM";
            const hasDraw = eventMatches.length > 0;
            const regLocked = tournament.status !== "REGISTRATION_OPEN" && tournament.status !== "DRAFT";
            const groupMatches = eventMatches.filter((m) => m.group_label && m.group_label !== "RR");
            const groupsDone = groupMatches.length > 0 &&
              groupMatches.every((m) => m.status === "COMPLETED" || m.status === "WALKOVER");
            const koExists = eventMatches.some((m) => !m.group_label);

            const generate = () => guarded(async () => {
              if (format === "ROUND_ROBIN") await generateRoundRobin(eventId);
              else if (format === "GROUP_KO") await generateGroupStage(eventId, event.group_count || 2, event.advance_per_group || 2);
              else await generateDraw(eventId);
              await loadAll();
            }, "Draw generated.");

            if (!hasDraw) {
              const minEntries = minEntriesFor(event);
              return (
                <div className="space-y-4">
                  <FormatBuilder
                    event={event} confirmedCount={confirmedCount} locked={hasDraw}
                    notify={notify} onChanged={loadAll}
                  />
                  <SeedingPanel
                    entries={eventEntries}
                    disabled={hasDraw}
                    onSave={(map) => guarded(async () => { await setSeeds(map); await loadEventData(events); }, "Seeds saved.")}
                  />
                  <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line px-6 py-10 text-center">
                    <Badge tone="teal">{FORMAT_META[format].label}</Badge>
                    <div className="text-sm font-semibold text-ink-2">Generate the draw</div>
                    <div className="max-w-sm text-sm text-ink-2">
                      {confirmedCount} confirmed {confirmedCount === 1 ? "entry" : "entries"}
                      {confirmedCount < minEntries && ` — need at least ${minEntries}`}.
                      {!regLocked && " Registration must be closed first."}
                    </div>
                    <Btn size="sm" className="mt-2" disabled={!regLocked || confirmedCount < minEntries} onClick={generate}>
                      Generate draw
                    </Btn>
                  </div>
                </div>
              );
            }

            return (
              <div className="space-y-5">
                <FormatBuilder event={event} confirmedCount={confirmedCount} locked notify={notify} onChanged={loadAll} />
                {format === "GROUP_KO" && !koExists && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-surface-2 px-3 py-2.5">
                    <span className="text-xs text-ink-2">
                      {groupsDone ? "All group matches are done — build the knockout." : "Knockout unlocks once every group match is played."}
                    </span>
                    <Btn size="sm" disabled={!groupsDone}
                      onClick={() => guarded(async () => { await generateKnockoutFromGroups(eventId); await loadAll(); }, "Knockout generated.")}>
                      Generate knockout
                    </Btn>
                  </div>
                )}
                {(format === "ROUND_ROBIN" || format === "GROUP_KO") && (
                  <StandingsPanel event={event} matches={eventMatches} entriesById={entriesById} />
                )}
                {format !== "ROUND_ROBIN" && event.total_rounds && (
                  <BracketView
                    event={event}
                    matches={eventMatches.filter((m) => !m.group_label)}
                    entriesById={entriesById}
                  />
                )}
              </div>
            );
          })()}

          {activeTab === "schedule" && (
            <SchedulingPanel
              tournament={tournament} events={events} entriesById={entriesById}
              notify={notify} onChanged={loadAll}
            />
          )}

          {activeTab === "courts" && (
            <CourtsPanel courts={courts}
              onAdd={(name) => guarded(async () => { await addCourt(tournament.id, name); const c = await listCourts(tournament.id); setCourts(c); })}
              onUpdate={(cid, patch) => guarded(async () => { await updateCourt(cid, patch); const c = await listCourts(tournament.id); setCourts(c); })}
              onRemove={(cid) => guarded(async () => { await removeCourt(cid); const c = await listCourts(tournament.id); setCourts(c); })}
              onUpdateAvailability={(cid, patch) => guarded(async () => { await updateCourtAvailability(cid, patch); const c = await listCourts(tournament.id); setCourts(c); })} />
          )}

          {activeTab === "checkin" && event && (
            <CheckInPanel
              entries={eventEntries.filter((e) => e.reg_status === "CONFIRMED" || e.reg_status === "PENDING")}
              onSetStatus={(eid, status) => guarded(async () => { await setCheckInStatus(eid, status); await loadEventData(events); })}
              onCheckInByCode={async (code) => { const entry = await checkInByCode(code); await loadEventData(events); return entry; }}
            />
          )}

          {activeTab === "live" && (
            <LiveScoringBoard matches={allMatches} events={events} entriesById={entriesById}
              onStart={(mid) => guarded(async () => { await startMatch(mid); await loadEventData(events); })}
              onScore={(mid, side, delta) => guarded(async () => { await scorePoint(mid, side, delta); await loadEventData(events); })}
              onUndo={(mid) => guarded(async () => { await undoLastGame(mid); await loadEventData(events); })}
              onRetire={(mid, side) => guarded(async () => { await retireMatch(mid, side); await loadEventData(events); })} />
          )}

          {activeTab === "results" && event && <ResultsPanel event={event} matches={eventMatches} entriesById={entriesById} />}

          {activeTab === "disputes" && (
            <DisputesPanel tournamentId={tournament.id} entriesById={entriesById} events={events}
              matches={allMatches} notify={notify} />
          )}

          {activeTab === "audit" && <AuditLogPanel tournamentId={tournament.id} allMatches={allMatches} />}

          {activeTab === "settings" && (
            <div className="max-w-lg space-y-4">
              <Card className="p-4 space-y-3">
                <Field label="Tournament name"><input className={inputCls} defaultValue={tournament.name} onBlur={(e) => e.target.value !== tournament.name && guarded(async () => { await updateTournament(tournament.id, { name: e.target.value }); await loadAll(); })} /></Field>
                <Field label="Venue"><input className={inputCls} defaultValue={tournament.venue} onBlur={(e) => e.target.value !== tournament.venue && guarded(async () => { await updateTournament(tournament.id, { venue: e.target.value }); await loadAll(); })} /></Field>
                <Field label="Contact email"><input className={inputCls} defaultValue={tournament.contact_email || ""} onBlur={(e) => e.target.value !== tournament.contact_email && guarded(async () => { await updateTournament(tournament.id, { contact_email: e.target.value }); await loadAll(); })} /></Field>
              </Card>
              {/* Registration window. These two timestamps are what actually
                  gate public entry — the RLS insert policy checks them — so
                  registration opens and closes on its own. */}
              <Card className="space-y-3 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-ink-2">Registration window</div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Opens at" hint="Leave blank to open as soon as you publish.">
                    <input
                      type="datetime-local" className={inputCls}
                      defaultValue={toLocalInput(tournament.registration_opens_at)}
                      onBlur={(e) => guarded(async () => {
                        await updateTournament(tournament.id, { registration_opens_at: fromLocalInput(e.target.value) });
                        await loadAll();
                      }, "Registration window updated.")}
                    />
                  </Field>
                  <Field label="Closes at" hint="Entries are refused after this, by the database — not just the button.">
                    <input
                      type="datetime-local" className={inputCls}
                      defaultValue={toLocalInput(tournament.registration_closes_at)}
                      onBlur={(e) => guarded(async () => {
                        await updateTournament(tournament.id, { registration_closes_at: fromLocalInput(e.target.value) });
                        await loadAll();
                      }, "Registration window updated.")}
                    />
                  </Field>
                </div>
              </Card>

              <Card className="space-y-2 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-ink-2">Lifecycle</div>
                <div className="mb-1 flex items-center gap-2">
                  <Badge tone={stage.tone}>{stage.label}</Badge>
                  {stage.hint && <span className="text-[11px] text-ink-3">{stage.hint}</span>}
                </div>
                <div className="flex flex-wrap gap-2">
                  {(() => {
                    const complete = canAct("complete", { tournament, events, matches: allMatches, role });
                    const archive = canAct("archive", { tournament, events, matches: allMatches, role });
                    return (
                      <>
                        {tournament.status === "LIVE" && (
                          <Btn size="sm" icon={Trophy} disabled={!complete.ok} title={complete.reason || ""}
                            onClick={() => guarded(async () => { await completeTournament(tournament.id); await loadAll(); }, "Tournament completed.")}>
                            Mark tournament completed
                          </Btn>
                        )}
                        {archive.ok && (
                          <Btn size="sm" variant="secondary"
                            onClick={() => confirm("Archive this tournament? It stays readable but drops out of active lists.") && guarded(async () => {
                              await updateTournament(tournament.id, { status: "ARCHIVED" }); await loadAll();
                            }, "Tournament archived.")}>
                            Archive
                          </Btn>
                        )}
                        {!["COMPLETED", "CANCELLED", "ARCHIVED"].includes(tournament.status) && (
                          <Btn size="sm" variant="danger" onClick={() => { if (confirm("Cancel this tournament? This cannot be undone.")) guarded(async () => { await cancelTournament(tournament.id); await loadAll(); }); }}>Cancel tournament</Btn>
                        )}
                        {!complete.ok && tournament.status === "LIVE" && (
                          <span className="w-full text-[11px] text-ink-3">{complete.reason}</span>
                        )}
                        {["COMPLETED", "CANCELLED", "ARCHIVED"].includes(tournament.status) && (
                          <span className="w-full text-[11px] text-ink-3">
                            This tournament is finished. Results stay published and cannot be reopened — the database
                            refuses the transition, so a stray click cannot undo it.
                          </span>
                        )}
                      </>
                    );
                  })()}
                </div>
              </Card>
            </div>
          )}
        </div>
      </div>
      <Toasts toasts={toasts} />
    </div>
  );
}
