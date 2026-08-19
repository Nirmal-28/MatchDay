import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, MapPin, Calendar, Building2, Radio } from "lucide-react";
import { cx, fmtDateRange, inr, entryShort, roundLabel, BadmintonScoringEngine, toAB, CATEGORY_META, EVENT_STATUS_META, TOURNAMENT_STATUS_META } from "../lib/engines";
import { getTournament, getTournamentBySlug, listEvents, listEntries, listMatches, registerEntry, subscribeToEvent } from "../lib/repository";
import { Badge, Btn, Card, EmptyState } from "../components/ui/primitives";
import RegistrationModal from "../components/RegistrationModal";
import BracketView from "../components/BracketView";
import ScheduleTable from "../components/ScheduleTable";
import ResultsPanel from "../components/ResultsPanel";

const PUB_TABS = [
  { key: "overview", label: "Overview" },
  { key: "categories", label: "Categories" },
  { key: "schedule", label: "Schedule" },
  { key: "live", label: "Live" },
  { key: "bracket", label: "Bracket" },
  { key: "results", label: "Results" },
];

export default function PublicTournamentPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [tournament, setTournament] = useState(null);
  const [events, setEvents] = useState([]);
  const [entriesByEvent, setEntriesByEvent] = useState({});
  const [matchesByEvent, setMatchesByEvent] = useState({});
  const [tab, setTab] = useState("overview");
  const [eventId, setEventId] = useState(null);
  const [regEvent, setRegEvent] = useState(null);
  const [notFound, setNotFound] = useState(false);

  const loadEventData = useCallback(async (evs) => {
    const results = await Promise.all(evs.map(async (e) => ({
      id: e.id, entries: await listEntries(e.id), matches: await listMatches(e.id),
    })));
    const eb = {}, mb = {};
    results.forEach((r) => { eb[r.id] = r.entries; mb[r.id] = r.matches; });
    setEntriesByEvent(eb);
    setMatchesByEvent(mb);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const t = await getTournamentBySlug(slug);
        if (cancelled) return;
        setTournament(t);
        const evs = await listEvents(t.id);
        if (cancelled) return;
        setEvents(evs);
        setEventId(evs[0]?.id ?? null);
        await loadEventData(evs);
      } catch {
        if (!cancelled) setNotFound(true);
      }
    })();
    return () => { cancelled = true; };
  }, [slug, loadEventData]);

  const refreshAll = useCallback(async () => {
    if (!tournament) return;
    const [t, evs] = await Promise.all([getTournament(tournament.id), listEvents(tournament.id)]);
    setTournament(t);
    setEvents(evs);
    await loadEventData(evs);
  }, [tournament, loadEventData]);

  useEffect(() => {
    if (events.length === 0) return;
    const unsubs = events.map((e) => subscribeToEvent(e.id, refreshAll));
    return () => unsubs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events.map((e) => e.id).join(",")]);

  const entriesById = useMemo(() => {
    const m = {};
    Object.values(entriesByEvent).forEach((list) => list.forEach((e) => (m[e.id] = e)));
    return m;
  }, [entriesByEvent]);

  const event = events.find((e) => e.id === eventId);
  const eventMatches = matchesByEvent[eventId] || [];
  const allMatches = Object.values(matchesByEvent).flat();
  const liveMatches = allMatches.filter((m) => m.status === "LIVE");

  const handleRegister = async (eid, players) => {
    const ev = events.find((e) => e.id === eid);
    await registerEntry(eid, players, ev?.fee_inr);
    await loadEventData(events);
  };

  if (notFound) return <EmptyState icon={MapPin} title="Tournament not found" hint="This link may be wrong or the tournament isn't published yet." />;
  if (!tournament) return <div className="py-14 text-center text-sm text-stone-400">Loading…</div>;

  return (
    <div>
      <button className="mb-3 flex items-center gap-1 text-xs font-medium text-stone-500 hover:text-stone-800" onClick={() => navigate("/")}><ChevronLeft size={14} /> All tournaments</button>

      <div className="mb-5 rounded-lg border border-stone-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-stone-900">{tournament.name}</h1>
              <Badge tone={TOURNAMENT_STATUS_META[tournament.status].tone}>{tournament.status === "LIVE" ? <><Radio size={10} className="animate-pulse" /> Live</> : TOURNAMENT_STATUS_META[tournament.status].label}</Badge>
            </div>
            <p className="mt-1 max-w-xl text-sm text-stone-500">{tournament.description}</p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-500">
              <span className="flex items-center gap-1"><MapPin size={12} />{tournament.venue}{tournament.location ? `, ${tournament.location}` : ""}</span>
              <span className="flex items-center gap-1"><Calendar size={12} />{fmtDateRange(tournament.start_date, tournament.end_date)}</span>
              <span className="flex items-center gap-1"><Building2 size={12} />{tournament.organizer_name}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-stone-200">
        {PUB_TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={cx("flex-shrink-0 border-b-2 px-3 py-2 text-sm font-medium", tab === t.key ? "border-teal-700 text-teal-800" : "border-transparent text-stone-500 hover:text-stone-800")}>{t.label}</button>
        ))}
      </div>

      {["categories", "schedule", "bracket", "results"].includes(tab) && events.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {events.map((e) => (
            <button key={e.id} onClick={() => setEventId(e.id)} className={cx("rounded-full border px-3 py-1 text-xs font-medium", eventId === e.id ? "border-teal-600 bg-teal-600 text-white" : "border-stone-200 text-stone-600 hover:bg-stone-50")}>{CATEGORY_META[e.category].label}</button>
          ))}
        </div>
      )}

      {tab === "overview" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card className="p-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">Format</div>
            <p className="text-sm text-stone-600">{tournament.settings?.rules}</p>
          </Card>
          <Card className="p-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">Contact</div>
            <p className="text-sm text-stone-600">{tournament.contact_email}<br />{tournament.contact_phone}</p>
          </Card>
        </div>
      )}

      {tab === "categories" && (
        <div className="grid gap-3 sm:grid-cols-2">
          {events.map((e) => {
            const list = entriesByEvent[e.id] || [];
            const count = list.filter((en) => en.reg_status !== "REJECTED" && en.reg_status !== "CANCELLED").length;
            const open = e.status === "REGISTRATION_OPEN";
            return (
              <Card key={e.id} className="p-4">
                <div className="mb-1 flex items-center justify-between">
                  <div className="font-medium text-stone-900">{CATEGORY_META[e.category].label}</div>
                  <Badge tone={EVENT_STATUS_META[e.status].tone}>{EVENT_STATUS_META[e.status].label}</Badge>
                </div>
                <div className="mb-3 text-xs text-stone-500">{count} / {e.max_entries} registered · {inr(e.fee_inr)} entry fee</div>
                <Btn size="sm" disabled={!open || count >= e.max_entries} onClick={() => setRegEvent(e)}>{count >= e.max_entries ? "Category full" : "Register"}</Btn>
              </Card>
            );
          })}
        </div>
      )}

      {tab === "schedule" && event && <ScheduleTable matches={eventMatches} entriesById={entriesById} event={event} />}

      {tab === "live" && (
        liveMatches.length === 0 ? <EmptyState icon={Radio} title="No live matches right now" /> : (
          <div className="grid gap-3 sm:grid-cols-2">
            {liveMatches.map((m) => {
              const ev = events.find((e) => e.id === m.event_id);
              const a = entriesById[m.entry_a], b = entriesById[m.entry_b];
              const games = [...(m.games || [])].sort((x, y) => x.game_number - y.game_number);
              const tally = BadmintonScoringEngine.gameTally(toAB(games));
              const current = games[games.length - 1];
              return (
                <Card key={m.id} className="p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <Badge tone="slate">{m.court}</Badge>
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-red-600"><Radio size={10} className="animate-pulse" />LIVE</span>
                  </div>
                  <div className="mb-2 text-[11px] uppercase tracking-wide text-stone-400">{CATEGORY_META[ev.category].label} · {roundLabel(m.round, ev.total_rounds)}</div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm"><span className="font-medium text-stone-800">{entryShort(a)}</span><span className="font-mono text-lg font-bold">{current?.score_a ?? 0}</span></div>
                    <div className="flex items-center justify-between text-sm"><span className="font-medium text-stone-800">{entryShort(b)}</span><span className="font-mono text-lg font-bold">{current?.score_b ?? 0}</span></div>
                  </div>
                  <div className="mt-2 text-[11px] text-stone-400">Games {tally.a}–{tally.b}</div>
                </Card>
              );
            })}
          </div>
        )
      )}

      {tab === "bracket" && event && <BracketView event={event} matches={eventMatches} entriesById={entriesById} />}
      {tab === "results" && event && <ResultsPanel event={event} matches={eventMatches} entriesById={entriesById} />}

      <RegistrationModal open={!!regEvent} onClose={() => setRegEvent(null)} event={regEvent} onSubmit={handleRegister} />
    </div>
  );
}
