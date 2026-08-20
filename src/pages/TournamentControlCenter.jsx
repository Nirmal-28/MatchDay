import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ChevronLeft, MapPin, Calendar, Home, Users, Swords, LayoutGrid, Radio, Trophy, Settings, Play, ArrowRight,
} from "lucide-react";
import { fmtDateRange, inr, CATEGORY_META, TOURNAMENT_STATUS_META, EVENT_STATUS_META, FORMAT_META, divisionLabel } from "../lib/engines";
import {
  getTournament, listEvents, listCourts, listEntries, listMatches, listNotifications, markNotificationsRead,
  publishTournament, closeRegistration, startTournament, completeTournament, cancelTournament, updateTournament,
  addCourt, updateCourt, removeCourt,
  updateEntryStatus, removeEntry, devSimulatePayment, markRefunded, registerEntry,
  generateDraw, generateSchedule, generateRoundRobin, generateGroupStage, generateKnockoutFromGroups, setSeeds,
  startMatch, scorePoint, undoLastGame, retireMatch,
  subscribeToEvent,
} from "../lib/repository";
import { Btn, Badge, Card, Field, inputCls, useToasts, Toasts } from "../components/ui/primitives";
import { BrandLoader, LivePulse } from "../components/ui/motion";
import ParticipantsPanel from "../components/ParticipantsPanel";
import SeedingPanel from "../components/SeedingPanel";
import StandingsPanel from "../components/StandingsPanel";
import BracketView from "../components/BracketView";
import ScheduleTable from "../components/ScheduleTable";
import CourtsPanel from "../components/CourtsPanel";
import LiveScoringBoard from "../components/LiveScoringBoard";
import ResultsPanel from "../components/ResultsPanel";
import NotificationBell from "../components/NotificationBell";

const ORG_TABS = [
  { key: "overview", label: "Overview", icon: Home },
  { key: "participants", label: "Participants", icon: Users },
  { key: "draw", label: "Draw", icon: Swords },
  { key: "schedule", label: "Schedule", icon: Calendar },
  { key: "courts", label: "Courts", icon: LayoutGrid },
  { key: "live", label: "Live scoring", icon: Radio },
  { key: "results", label: "Results", icon: Trophy },
  { key: "settings", label: "Settings", icon: Settings },
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

  if (!tournament) return <BrandLoader />;

  const event = events.find((e) => e.id === eventId);
  const eventEntries = entriesByEvent[eventId] || [];
  const eventMatches = matchesByEvent[eventId] || [];
  const allMatches = Object.values(matchesByEvent).flat();
  const confirmedCount = eventEntries.filter((e) => e.reg_status === "CONFIRMED").length;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <button className="flex items-center gap-1 text-xs font-medium text-stone-500 hover:text-stone-800" onClick={() => navigate("/organizer")}><ChevronLeft size={14} /> All tournaments</button>
        <NotificationBell notifications={notifications} onMarkRead={() => guarded(async () => { await markNotificationsRead(id); setNotifications((n) => n.map((x) => ({ ...x, read: true }))); })} />
      </div>

      <div className="relative mb-5 overflow-hidden rounded-2xl bg-navy-900 p-5 sm:p-6">
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-widest text-accent-teal">Matchday control center</div>
            <div className="mt-1 flex items-center gap-2">
              <h1 className="text-xl font-bold text-white">{tournament.name}</h1>
              <Badge tone={TOURNAMENT_STATUS_META[tournament.status].tone}>{TOURNAMENT_STATUS_META[tournament.status].label}</Badge>
              {tournament.status === "LIVE" && <LivePulse />}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-stone-400">
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
            {tournament.status === "REGISTRATION_CLOSED" && (
              <Btn size="sm" icon={Play} onClick={() => guarded(async () => { await startTournament(tournament.id); await loadAll(); })}>Start tournament</Btn>
            )}
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
              <div className="text-[11px] uppercase tracking-wide text-stone-400">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-5 lg:flex-row">
        <div className="flex gap-1 overflow-x-auto lg:w-48 lg:flex-none lg:flex-col lg:overflow-visible">
          {ORG_TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} className={`flex flex-shrink-0 items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors ${tab === t.key ? "bg-teal-50 text-teal-800" : "text-stone-600 hover:bg-stone-100"}`}>
              <t.icon size={15} />{t.label}
            </button>
          ))}
        </div>

        <div className="min-w-0 flex-1">
          {["participants", "draw", "schedule", "results"].includes(tab) && events.length > 1 && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {events.map((e) => (
                <button key={e.id} onClick={() => setEventId(e.id)} className={`rounded-full border px-3 py-1 text-xs font-medium ${eventId === e.id ? "border-teal-600 bg-teal-600 text-white" : "border-stone-200 text-stone-600 hover:bg-stone-50"}`}>
                  {divisionLabel(e)}
                </button>
              ))}
            </div>
          )}

          {tab === "overview" && (
            <div className="space-y-4">
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">Categories</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {events.map((e) => {
                    const c = (entriesByEvent[e.id] || []).length;
                    return (
                      <Card key={e.id} className="flex items-center justify-between p-3">
                        <div>
                          <div className="text-sm font-medium text-stone-800">{divisionLabel(e)}</div>
                          <div className="text-xs text-stone-500">{c} / {e.max_entries} registered · {inr(e.fee_inr)}</div>
                        </div>
                        <Badge tone={EVENT_STATUS_META[e.status].tone}>{EVENT_STATUS_META[e.status].label}</Badge>
                      </Card>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {tab === "participants" && event && (
            <ParticipantsPanel
              event={event} entries={eventEntries}
              onApprove={(eid) => guarded(async () => { await updateEntryStatus(eid, "CONFIRMED"); await loadEventData(events); })}
              onReject={(eid) => guarded(async () => { await updateEntryStatus(eid, "REJECTED"); await loadEventData(events); })}
              onRemove={(eid) => guarded(async () => { await removeEntry(eid); await loadEventData(events); })}
              onSimPay={(eid) => guarded(async () => { await devSimulatePayment(eid, true); await loadEventData(events); })}
              onRefund={(eid) => guarded(async () => { await markRefunded(eid); await loadEventData(events); })}
              onAddManual={(eid, players) => guarded(async () => { await registerEntry(eid, players, event.fee_inr); await loadEventData(events); })}
            />
          )}

          {tab === "draw" && event && (() => {
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
              const minEntries = format === "ROUND_ROBIN" ? 3 : format === "GROUP_KO" ? (event.group_count || 2) * 2 : 2;
              return (
                <div className="space-y-4">
                  <SeedingPanel
                    entries={eventEntries}
                    disabled={hasDraw}
                    onSave={(map) => guarded(async () => { await setSeeds(map); await loadEventData(events); }, "Seeds saved.")}
                  />
                  <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-stone-300 px-6 py-10 text-center">
                    <Badge tone="teal">{FORMAT_META[format].label}</Badge>
                    <div className="text-sm font-semibold text-stone-700">Generate the draw</div>
                    <div className="max-w-sm text-sm text-stone-500">
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
                {format === "GROUP_KO" && !koExists && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-stone-200 bg-stone-50 px-3 py-2.5">
                    <span className="text-xs text-stone-600">
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

          {tab === "schedule" && event && (
            <div>
              {event.status === "DRAW_READY" && (
                <div className="mb-3"><Btn size="sm" icon={Calendar} onClick={() => guarded(async () => { await generateSchedule(eventId); await loadAll(); }, "Schedule generated.")}>Generate schedule</Btn></div>
              )}
              <ScheduleTable matches={eventMatches} entriesById={entriesById} event={event} />
            </div>
          )}

          {tab === "courts" && (
            <CourtsPanel courts={courts}
              onAdd={(name) => guarded(async () => { await addCourt(tournament.id, name); const c = await listCourts(tournament.id); setCourts(c); })}
              onUpdate={(cid, patch) => guarded(async () => { await updateCourt(cid, patch); const c = await listCourts(tournament.id); setCourts(c); })}
              onRemove={(cid) => guarded(async () => { await removeCourt(cid); const c = await listCourts(tournament.id); setCourts(c); })} />
          )}

          {tab === "live" && (
            <LiveScoringBoard matches={allMatches} events={events} entriesById={entriesById}
              onStart={(mid) => guarded(async () => { await startMatch(mid); await loadEventData(events); })}
              onScore={(mid, side, delta) => guarded(async () => { await scorePoint(mid, side, delta); await loadEventData(events); })}
              onUndo={(mid) => guarded(async () => { await undoLastGame(mid); await loadEventData(events); })}
              onRetire={(mid, side) => guarded(async () => { await retireMatch(mid, side); await loadEventData(events); })} />
          )}

          {tab === "results" && event && <ResultsPanel event={event} matches={eventMatches} entriesById={entriesById} />}

          {tab === "settings" && (
            <div className="max-w-lg space-y-4">
              <Card className="p-4 space-y-3">
                <Field label="Tournament name"><input className={inputCls} defaultValue={tournament.name} onBlur={(e) => e.target.value !== tournament.name && guarded(async () => { await updateTournament(tournament.id, { name: e.target.value }); await loadAll(); })} /></Field>
                <Field label="Venue"><input className={inputCls} defaultValue={tournament.venue} onBlur={(e) => e.target.value !== tournament.venue && guarded(async () => { await updateTournament(tournament.id, { venue: e.target.value }); await loadAll(); })} /></Field>
                <Field label="Contact email"><input className={inputCls} defaultValue={tournament.contact_email || ""} onBlur={(e) => e.target.value !== tournament.contact_email && guarded(async () => { await updateTournament(tournament.id, { contact_email: e.target.value }); await loadAll(); })} /></Field>
              </Card>
              <Card className="space-y-2 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">Lifecycle</div>
                <div className="flex flex-wrap gap-2">
                  {tournament.status !== "COMPLETED" && tournament.status !== "CANCELLED" && events.length > 0 && events.every((e) => e.status === "COMPLETED") && (
                    <Btn size="sm" icon={Trophy} onClick={() => guarded(async () => { await completeTournament(tournament.id); await loadAll(); })}>Mark tournament completed</Btn>
                  )}
                  {tournament.status !== "COMPLETED" && tournament.status !== "CANCELLED" && (
                    <Btn size="sm" variant="danger" onClick={() => { if (confirm("Cancel this tournament? This cannot be undone.")) guarded(async () => { await cancelTournament(tournament.id); await loadAll(); }); }}>Cancel tournament</Btn>
                  )}
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
