import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, MapPin, Calendar, Building2, Radio, Share2, Lock, Search, Megaphone, Users, ExternalLink, Trophy } from "lucide-react";
import { cx, fmtDateRange, fmtDateTime, inr, entryName, entryShort, matchStageLabel, BadmintonScoringEngine, toAB, CATEGORY_META, divisionLabel, EVENT_STATUS_META, TOURNAMENT_STATUS_META, accentTheme } from "../lib/engines";
import { getTournament, getTournamentBySlug, listEvents, listEntriesPublic, listMatches, registerEntry, subscribeToEvent } from "../lib/repository";
import { registrationState } from "../lib/lifecycle";
import { Badge, Btn, Card, EmptyState, inputCls } from "../components/ui/primitives";
import { BrandLoader, LivePulse } from "../components/ui/motion";
import RegistrationModal from "../components/RegistrationModal";
import FollowButton from "../components/FollowButton";
import BracketView from "../components/BracketView";
import StandingsPanel from "../components/StandingsPanel";
import ScheduleTable from "../components/ScheduleTable";
import ResultsPanel from "../components/ResultsPanel";
import { useDocumentMeta } from "../lib/useDocumentMeta";

/* A horizontally scrollable strip that says so.

   The tab row overflows on a phone — Bracket, Results and Players sit past
   the right edge, which are exactly the tabs a spectator wants on tournament
   day. Previously it clipped mid-label with no fade, no chevron and no
   scrollbar, so the last visible thing was a sliced glyph that reads as a
   rendering bug rather than an invitation to swipe (audit finding F3).

   The fade is applied as a mask on the scroller itself, so it costs no
   vertical space, and it tracks the real scroll position: it appears on the
   right only while there is more to reach, on the left once you have moved,
   and disappears entirely when everything already fits. A static fade would
   keep implying hidden tabs at the end of the strip, which is its own small
   lie. The border sits on the outer wrapper so the mask does not fade it. */
function ScrollFade({ children, className, innerClassName }) {
  const ref = useRef(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      // 1px of slack: sub-pixel layout means scrollLeft rarely lands exactly
      // on scrollWidth - clientWidth, which would leave the fade stuck on.
      const max = el.scrollWidth - el.clientWidth;
      setEdges({ left: el.scrollLeft > 1, right: el.scrollLeft < max - 1 });
    };
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    // Catches viewport resizes and tab-list changes alike (a tournament going
    // live adds a Live tab, which can push the row into overflow).
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", measure); ro.disconnect(); };
  }, [children]);

  const mask =
    edges.left && edges.right
      ? "linear-gradient(to right, transparent 0, #000 28px, #000 calc(100% - 28px), transparent 100%)"
      : edges.right
        ? "linear-gradient(to right, #000 calc(100% - 28px), transparent 100%)"
        : edges.left
          ? "linear-gradient(to right, transparent 0, #000 28px)"
          : undefined;

  return (
    <div className={className}>
      <div
        ref={ref}
        className={cx("overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", innerClassName)}
        style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
      >
        {children}
      </div>
    </div>
  );
}

// On tournament day LIVE leads; the rest of the time Overview does. The tab
// list is built per-tournament so a section only exists when it has something
// to show (no empty Standings tab on a pure knockout, no Sponsors tab when
// none are configured).
function buildTabs({ isLive, hasStandings, hasSponsors }) {
  return [
    ...(isLive ? [{ key: "live", label: "Live" }] : []),
    { key: "overview", label: "Overview" },
    { key: "categories", label: "Categories" },
    { key: "schedule", label: "Schedule" },
    ...(isLive ? [] : [{ key: "live", label: "Live" }]),
    { key: "bracket", label: "Bracket" },
    ...(hasStandings ? [{ key: "standings", label: "Standings" }] : []),
    { key: "results", label: "Results" },
    { key: "players", label: "Players" },
    ...(hasSponsors ? [{ key: "sponsors", label: "Sponsors" }] : []),
  ];
}

export default function PublicTournamentPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [tournament, setTournament] = useState(null);
  useDocumentMeta({ title: tournament?.name, description: tournament ? [tournament.venue, tournament.city].filter(Boolean).join(", ") || undefined : undefined });
  const [events, setEvents] = useState([]);
  const [entriesByEvent, setEntriesByEvent] = useState({});
  const [matchesByEvent, setMatchesByEvent] = useState({});
  // null until the visitor picks one, so the default can follow the
  // tournament's state (Live on tournament day, Overview otherwise).
  const [tab, setTab] = useState(null);
  const [eventId, setEventId] = useState(null);
  const [regEvent, setRegEvent] = useState(null);
  const [notFound, setNotFound] = useState(false);

  const loadEventData = useCallback(async (evs) => {
    const results = await Promise.all(evs.map(async (e) => ({
      id: e.id, entries: await listEntriesPublic(e.id), matches: await listMatches(e.id),
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

  const isLive = tournament?.status === "LIVE";
  const sponsors = Array.isArray(tournament?.sponsors) ? tournament.sponsors.filter((s) => s?.name || s?.logoUrl) : [];
  const hasStandings = allMatches.some((m) => m.group_label);
  const tabs = buildTabs({ isLive, hasStandings, hasSponsors: sponsors.length > 0 });
  const activeTab = tab && tabs.some((t) => t.key === tab) ? tab : tabs[0].key;

  // Organizer accent, clamped by accentTheme() so a bad colour can never
  // destroy contrast. Used only for accents — never as a page background.
  const theme = accentTheme(tournament?.accent_color);

  // Returns the created entry so the confirmation can report what the
  // database actually did — PENDING, or WAITLISTED when the capacity trigger
  // moved them — instead of assuming success.
  const handleRegister = async (eid, players, customAnswers) => {
    const ev = events.find((e) => e.id === eid);
    const entry = await registerEntry(eid, players, ev?.fee_inr, customAnswers);
    await loadEventData(events);
    return entry;
  };

  if (notFound) return <EmptyState icon={MapPin} title="Tournament not found" hint="This link may be wrong or the tournament isn't published yet." />;
  if (!tournament) return <BrandLoader />;

  return (
    <div>
      <button className="mb-3 flex items-center gap-1 text-xs font-medium text-ink-2 hover:text-ink" onClick={() => navigate("/")}><ChevronLeft size={14} /> All tournaments</button>

      <div className="mb-5 overflow-hidden rounded-lg border border-line bg-surface">
        {/* Cover art sits behind a scrim so the title stays legible over any
            image the organizer uploads. */}
        {tournament.cover_image_url && (
          <div className="relative h-32 w-full sm:h-44">
            <img src={tournament.cover_image_url} alt="" className="h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/40 to-transparent" />
          </div>
        )}
        <div className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 gap-3">
              {tournament.logo_url && (
                <img src={tournament.logo_url} alt="" className="h-14 w-14 shrink-0 rounded-lg border border-line object-cover" />
              )}
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-bold text-ink">{tournament.name}</h1>
                  <Badge tone={TOURNAMENT_STATUS_META[tournament.status].tone}>{isLive ? <><Radio size={10} className="animate-pulse" /> Live</> : TOURNAMENT_STATUS_META[tournament.status].label}</Badge>
                </div>
                <p className="mt-1 max-w-xl text-sm text-ink-2">{tournament.description}</p>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
                  <span className="flex items-center gap-1"><MapPin size={12} />{tournament.venue}{tournament.location ? `, ${tournament.location}` : ""}</span>
                  <span className="flex items-center gap-1"><Calendar size={12} />{fmtDateRange(tournament.start_date, tournament.end_date)}</span>
                  <span className="flex items-center gap-1"><Building2 size={12} />{tournament.organizer_name}</span>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <FollowButton subjectType="TOURNAMENT" subjectId={tournament.id} />
              <Btn
                size="sm" variant="secondary" icon={Share2}
                onClick={() => {
                  const text = `${tournament.name} — ${tournament.venue}, ${fmtDateRange(tournament.start_date, tournament.end_date)}. Live draws, schedule and scores on MatchDay: ${window.location.href}`;
                  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
                }}
              >
                Share
              </Btn>
            </div>
          </div>
        </div>
      </div>

      {tournament.announcement && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border px-3.5 py-2.5 text-sm"
          style={{ borderColor: `${theme.accent}55`, background: `${theme.isCustom ? theme.accent : "#2DD4BF"}12` }}>
          <Megaphone size={15} className="mt-px shrink-0" style={{ color: theme.accent }} />
          <span className="text-ink">{tournament.announcement}</span>
        </div>
      )}

      <ScrollFade className="mb-4 border-b border-line" innerClassName="flex gap-1">
        {tabs.map((t) => {
          const on = activeTab === t.key;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={cx("flex flex-shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium",
                on ? "text-ink" : "border-transparent text-ink-2 hover:text-ink")}
              style={on ? { borderColor: theme.accent, color: theme.accent } : undefined}>
              {t.key === "live" && liveMatches.length > 0 && <Radio size={11} className="animate-pulse text-red-400" />}
              {t.label}
              {t.key === "live" && liveMatches.length > 0 && (
                <span className="rounded-full bg-red-500/20 px-1.5 text-[10px] font-bold text-red-300">{liveMatches.length}</span>
              )}
            </button>
          );
        })}
      </ScrollFade>

      {["categories", "schedule", "bracket", "standings", "results", "players"].includes(activeTab) && events.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {events.map((e) => (
            <button key={e.id} onClick={() => setEventId(e.id)} className={cx("rounded-full border px-3 py-1 text-xs font-medium", eventId === e.id ? "border-accent-teal bg-accent-teal text-white" : "border-line text-ink-2 hover:bg-surface-2")}>{divisionLabel(e)}</button>
          ))}
        </div>
      )}

      {activeTab === "overview" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card className="p-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-2">Format</div>
            <p className="text-sm text-ink-2">{tournament.settings?.rules}</p>
          </Card>
          <Card className="p-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-2">Contact</div>
            <p className="text-sm text-ink-2">{tournament.contact_email}<br />{tournament.contact_phone}</p>
          </Card>
        </div>
      )}

      {activeTab === "categories" && (
        <div className="grid gap-3 sm:grid-cols-2">
          {events.map((e) => {
            const list = entriesByEvent[e.id] || [];
            // "Taken" means holding a place: waitlisted entries are queued
            // behind capacity, not occupying it.
            const taken = list.filter((en) => ["PENDING", "CONFIRMED"].includes(en.reg_status)).length;
            const waitlisted = list.filter((en) => en.reg_status === "WAITLISTED").length;
            const reg = registrationState(tournament, e, taken);
            const left = Math.max(0, (e.max_entries || 0) - taken);
            return (
              <Card key={e.id} className="p-4">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <div className="font-medium text-ink">{divisionLabel(e)}</div>
                  <Badge tone={reg.tone}>{reg.label}</Badge>
                </div>
                <div className="mb-1 text-xs text-ink-2">
                  {taken} / {e.max_entries} registered · {Number(e.fee_inr) > 0 ? `${inr(e.fee_inr)} entry fee` : "Free entry"}
                </div>
                <div className="mb-3 text-[11px] text-ink-3">
                  {reg.key === "WAITLIST" ? `Full — ${waitlisted} waiting`
                    : reg.key === "ALMOST_FULL" ? `Only ${left} place${left === 1 ? "" : "s"} left`
                    : reg.key === "OPEN" ? `${left} place${left === 1 ? "" : "s"} available`
                    : reg.key === "NOT_OPEN" && tournament.registration_opens_at ? `Opens ${fmtDateTime(tournament.registration_opens_at)}`
                    : EVENT_STATUS_META[e.status]?.label}
                </div>
                <Btn size="sm" disabled={!reg.canRegister} onClick={() => setRegEvent(e)}>
                  {reg.key === "WAITLIST" ? "Join waitlist"
                    : reg.canRegister ? "Register"
                    : reg.key === "COMPLETED" ? "Tournament finished"
                    : reg.key === "NOT_OPEN" ? "Not open yet" : "Registration closed"}
                </Btn>
              </Card>
            );
          })}
        </div>
      )}

      {activeTab === "schedule" && event && (
        tournament.schedule_published ? (
          <div className="space-y-4">
            <NextMatchFinder events={events} entriesByEvent={entriesByEvent} matchesByEvent={matchesByEvent} />
            <ScheduleTable matches={eventMatches} entriesById={entriesById} event={event} />
          </div>
        ) : (
          <EmptyState icon={Lock} title="Schedule not published yet"
            hint="The organizer is still finalizing court and time assignments. Check back soon." />
        )
      )}

      {activeTab === "live" && (
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
                    <div className="flex items-center gap-2">
                      <LivePulse />
                      <Link to={`/m/${m.id}`} className="text-[11px] font-medium text-accent-teal hover:underline">Details</Link>
                    </div>
                  </div>
                  <div className="mb-2 text-[11px] uppercase tracking-wide text-ink-3">{CATEGORY_META[ev.category].label} · {matchStageLabel(m, ev)}</div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm"><span className="font-medium text-ink">{entryShort(a)}</span><span className="font-mono text-lg font-bold">{current?.score_a ?? 0}</span></div>
                    <div className="flex items-center justify-between text-sm"><span className="font-medium text-ink">{entryShort(b)}</span><span className="font-mono text-lg font-bold">{current?.score_b ?? 0}</span></div>
                  </div>
                  <div className="mt-2 text-[11px] text-ink-3">Games {tally.a}–{tally.b}</div>
                </Card>
              );
            })}
          </div>
        )
      )}

      {activeTab === "bracket" && event && (
        <div className="space-y-5">
          {eventMatches.some((m) => m.group_label) && (
            <StandingsPanel event={event} matches={eventMatches} entriesById={entriesById} />
          )}
          {event.format !== "ROUND_ROBIN" && event.total_rounds && (
            <BracketView event={event} matches={eventMatches.filter((m) => !m.group_label)} entriesById={entriesById} />
          )}
        </div>
      )}
      {activeTab === "standings" && event && (
        eventMatches.some((m) => m.group_label)
          ? <StandingsPanel event={event} matches={eventMatches} entriesById={entriesById} />
          : <EmptyState icon={Trophy} title="No table for this category"
              hint="Standings come from round-robin and group formats. This category is a straight knockout — see the Bracket tab." />
      )}

      {activeTab === "results" && event && <ResultsPanel event={event} matches={eventMatches} entriesById={entriesById} />}

      {/* Players — the public entry list, name-only by design. Contact details
          live on entry_players, which is organizer-only; this reads the
          public_entry_names projection instead. */}
      {activeTab === "players" && event && (() => {
        const list = (entriesByEvent[event.id] || [])
          .filter((e) => !["REJECTED", "CANCELLED"].includes(e.reg_status))
          .sort((a, b) => (a.seed ?? 999) - (b.seed ?? 999) || entryName(a).localeCompare(entryName(b)));
        if (!list.length) return <EmptyState icon={Users} title="No entries yet" hint="Registered players appear here once the organizer confirms them." />;
        return (
          <div>
            <div className="mb-2 text-xs text-ink-3">{list.length} {list.length === 1 ? "entry" : "entries"} in {divisionLabel(event)}</div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((en) => (
                <Card key={en.id} className="flex items-center justify-between gap-2 p-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-ink">{entryName(en)}</div>
                    <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-ink-3">
                      {(en.entry_players || []).map((p) => (
                        p.player_id
                          ? <Link key={p.id || p.name} to={`/p/${p.player_id}`} className="hover:text-accent-teal">{p.name}</Link>
                          : <span key={p.name}>{p.name}</span>
                      ))}
                    </div>
                  </div>
                  {en.seed && <Badge tone="teal">Seed {en.seed}</Badge>}
                  {!en.seed && en.reg_status === "WAITLISTED" && <Badge tone="amber">Waitlist</Badge>}
                </Card>
              ))}
            </div>
          </div>
        );
      })()}

      {activeTab === "sponsors" && (
        <div>
          <div className="mb-3 text-sm text-ink-2">This tournament is supported by:</div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sponsors.map((s, i) => {
              const inner = (
                <Card className="flex h-full flex-col items-center justify-center gap-2 p-5 text-center transition-colors hover:border-accent-teal/40">
                  {s.logoUrl && <img src={s.logoUrl} alt={s.name || "Sponsor"} className="max-h-16 max-w-full object-contain" />}
                  {s.name && <div className="text-sm font-medium text-ink">{s.name}</div>}
                  {s.url && <span className="flex items-center gap-1 text-[11px] text-ink-3"><ExternalLink size={10} /> Visit</span>}
                </Card>
              );
              return s.url
                ? <a key={i} href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="block">{inner}</a>
                : <div key={i}>{inner}</div>;
            })}
          </div>
        </div>
      )}

      {/* Sponsor strip under every tab, so backers get visibility without
          needing the visitor to open a dedicated section. */}
      {sponsors.length > 0 && activeTab !== "sponsors" && (
        <div className="mt-8 border-t border-line-soft pt-4">
          <div className="mb-2 text-[10px] uppercase tracking-widest text-ink-3">Supported by</div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 opacity-70">
            {sponsors.map((s, i) => (
              s.logoUrl
                ? <img key={i} src={s.logoUrl} alt={s.name || "Sponsor"} className="max-h-8 object-contain" />
                : <span key={i} className="text-xs font-medium text-ink-2">{s.name}</span>
            ))}
          </div>
        </div>
      )}

      <RegistrationModal
        open={!!regEvent} onClose={() => setRegEvent(null)}
        event={regEvent} tournament={tournament} onSubmit={handleRegister}
      />
    </div>
  );
}

// "Your next match" lookup by name — searches every category in the
// tournament (a player can be in Singles + Doubles + Mixed at once) and
// surfaces the soonest upcoming match with report-by time and opponent.
function NextMatchFinder({ events, entriesByEvent, matchesByEvent }) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState(null);

  const search = () => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) { setResult(null); return; }

    const hits = [];
    for (const ev of events) {
      const entries = entriesByEvent[ev.id] || [];
      const matches = matchesByEvent[ev.id] || [];
      for (const entry of entries) {
        const names = (entry.entry_players || []).map((p) => p.name || "");
        if (!names.some((n) => n.toLowerCase().includes(q))) continue;
        const upcoming = matches
          .filter((m) => (m.entry_a === entry.id || m.entry_b === entry.id) && m.scheduled_at &&
            !["COMPLETED", "WALKOVER"].includes(m.status))
          .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))[0];
        if (upcoming) {
          const opponentId = upcoming.entry_a === entry.id ? upcoming.entry_b : upcoming.entry_a;
          const opponent = entries.find((e) => e.id === opponentId);
          hits.push({ event: ev, match: upcoming, playerName: names.join(" / "), opponent });
        }
      }
    }
    hits.sort((a, b) => a.match.scheduled_at.localeCompare(b.match.scheduled_at));
    setResult(hits[0] || "none");
  };

  return (
    <Card className="p-4">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-2">Find your next match</div>
      <div className="flex gap-2">
        <input className={inputCls} placeholder="Enter your name" value={query}
          onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} />
        <Btn size="sm" icon={Search} onClick={search}>Search</Btn>
      </div>
      {result === "none" && <div className="mt-3 text-sm text-ink-2">No upcoming match found for that name.</div>}
      {result && result !== "none" && (
        <div className="mt-3 rounded-md border border-accent-teal/40 bg-accent-teal/5 p-3">
          <div className="text-[11px] uppercase tracking-wide text-accent-teal">Your next match</div>
          <div className="mt-1 text-sm font-semibold text-ink">{matchStageLabel(result.match, result.event)} · {divisionLabel(result.event)}</div>
          <div className="mt-1 text-lg font-bold text-ink">{fmtDateTime(result.match.scheduled_at)}</div>
          <div className="text-sm text-ink-2">Court {result.match.court || "TBD"}</div>
          <div className="mt-2 text-sm text-ink-2">Opponent: <span className="text-ink">{entryShort(result.opponent) || "TBD"}</span></div>
        </div>
      )}
    </Card>
  );
}
