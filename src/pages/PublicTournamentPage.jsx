import { useEffect, useMemo, useState, useCallback } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ChevronLeft, MapPin, Calendar, Building2, Share2, Lock, Search, Megaphone,
  Users, ExternalLink, Trophy, Radio,
} from "lucide-react";
import {
  cx, fmtDateRange, fmtDateTime, fmtTime, inr, entryName, entryShort, matchStageLabel,
  BadmintonScoringEngine, toAB, divisionLabel, EVENT_STATUS_META,
  TOURNAMENT_STATUS_META, accentTheme,
} from "../lib/engines";
import { getTournament, getTournamentBySlug, listEvents, listEntriesPublic, listMatches, registerEntry, subscribeToEvent } from "../lib/repository";
import { registrationState } from "../lib/lifecycle";
import { Badge, Btn, EmptyState, inputCls } from "../components/ui/primitives";
import { BrandLoader, SportIcon } from "../components/ui/motion";
import {
  SectionHeader, Tabs, MatchCard, StatusPill, CapacityBar, sportAccent, StatTile,
} from "../components/ui/md";
import { MaskText, Rise } from "../components/ui/reveal";
import { sportMeta } from "../lib/sports";
import RegistrationModal from "../components/RegistrationModal";
import FollowButton from "../components/FollowButton";
import BracketView from "../components/BracketView";
import StandingsPanel from "../components/StandingsPanel";
import ScheduleTable from "../components/ScheduleTable";
import ResultsPanel from "../components/ResultsPanel";
import { useDocumentMeta } from "../lib/useDocumentMeta";

/* ═══════════════════════════════════════════════════════════════════════
   PUBLIC TOURNAMENT PAGE
   ═══════════════════════════════════════════════════════════════════════

   The most-shared surface in the product: a link dropped into a WhatsApp
   group is how most people meet MatchDay. It has to read as a professional
   sports event site to a parent, a spectator and a sponsor — none of whom
   have an account and none of whom will hunt through tabs.

   So it is built in two states:

     BEFORE / AFTER   the hero leads with identity and the entry CTA.
     TOURNAMENT DAY   a LIVE band is injected directly under the hero, above
                      the tab strip, showing every match currently on court.
                      A spectator arriving mid-event sees scores without
                      touching the navigation at all.

   Everything below that band is unchanged in behaviour: same queries, same
   realtime subscription per event, same registration path through
   registerEntry(), same public-projection entry list (names only — contact
   details live on entry_players, which is organizer-only).
   ══════════════════════════════════════════════════════════════════════ */

// On tournament day LIVE leads; the rest of the time Overview does. The tab
// list is built per-tournament so a section only exists when it has something
// to show (no empty Standings tab on a pure knockout, no Sponsors tab when
// none are configured).
function buildTabs({ isLive, hasStandings, hasSponsors }) {
  return [
    ...(isLive ? [{ key: "live", label: "Live" }] : []),
    { key: "overview", label: "Overview" },
    { key: "categories", label: "Enter" },
    { key: "schedule", label: "Schedule" },
    ...(isLive ? [] : [{ key: "live", label: "Live" }]),
    { key: "bracket", label: "Draw" },
    ...(hasStandings ? [{ key: "standings", label: "Standings" }] : []),
    { key: "results", label: "Results" },
    { key: "players", label: "Players" },
    ...(hasSponsors ? [{ key: "sponsors", label: "Sponsors" }] : []),
  ];
}

// A public live/upcoming match row → the shared <MatchCard/> model. Sides
// stay in draw order here (unlike the player dashboard, which puts "you"
// first) because a spectator has no side.
function toCardModel(m, ev, entriesById, tournament) {
  const a = entriesById[m.entry_a], b = entriesById[m.entry_b];
  const games = [...(m.games || [])].sort((x, y) => x.game_number - y.game_number);
  const current = games[games.length - 1];
  const tally = BadmintonScoringEngine.gameTally(toAB(games));
  const live = m.status === "LIVE";
  const done = ["COMPLETED", "WALKOVER"].includes(m.status);

  return {
    id: m.id,
    status: live ? "live" : done ? "completed" : "scheduled",
    sport: tournament?.sport,
    round: ev ? matchStageLabel(m, ev) : null,
    event: ev ? divisionLabel(ev) : null,
    court: m.court || m.courts?.name || null,
    time: m.scheduled_at ? fmtTime(m.scheduled_at) : null,
    sideA: {
      name: entryShort(a) || "TBD",
      score: live ? (current?.score_a ?? 0) : done ? tally.a : null,
      won: done ? m.winner_entry_id === m.entry_a : undefined,
    },
    sideB: {
      name: entryShort(b) || "TBD",
      score: live ? (current?.score_b ?? 0) : done ? tally.b : null,
      won: done ? m.winner_entry_id === m.entry_b : undefined,
    },
    note: live && games.length > 1 ? `Games ${tally.a}–${tally.b}` : null,
  };
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

  // The matches due on court next — the second thing a spectator wants after
  // "what is live", and the thing a player at the venue is listening for.
  const upNext = useMemo(() => allMatches
    .filter((m) => m.scheduled_at && !["COMPLETED", "WALKOVER", "LIVE"].includes(m.status))
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
    .slice(0, 4), [allMatches]);

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

  const accent = theme.isCustom ? theme.accent : sportAccent(tournament.sport);
  // Whether any category is still taking entries — decides the hero's CTA.
  const openEvent = events.find((e) => {
    const list = entriesByEvent[e.id] || [];
    const taken = list.filter((en) => ["PENDING", "CONFIRMED"].includes(en.reg_status)).length;
    return registrationState(tournament, e, taken).canRegister;
  });

  const tabsWithCounts = tabs.map((t) =>
    t.key === "live" && liveMatches.length > 0 ? { ...t, count: liveMatches.length } : t
  );

  return (
    <div>
      <button className="mb-3 flex items-center gap-1 text-xs font-medium text-ink-2 hover:text-ink" onClick={() => navigate("/")}>
        <ChevronLeft size={14} /> All tournaments
      </button>

      {/* ── Event hero ───────────────────────────────────────────────────
          A poster, not a record. The organizer's cover art runs full-bleed
          behind the title with a scrim heavy enough that any uploaded image
          — bright, busy or low-contrast — still leaves the name legible. */}
      <header className="md-bleed md-court-texture relative -mt-2 overflow-hidden border-b border-line bg-gradient-to-b from-navy-800 to-surface">
        {tournament.cover_image_url && (
          <div className="absolute inset-0">
            <img src={tournament.cover_image_url} alt="" className="h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/85 to-surface/55" />
          </div>
        )}

        <div className="relative mx-auto max-w-6xl px-4 py-9 sm:py-12">
          <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
            <span className="flex items-center gap-1.5">
              <SportIcon sport={tournament.sport} className="h-4 w-4" style={{ color: accent }} />
              <span className="md-eyebrow" style={{ color: accent }}>{sportMeta(tournament.sport).label}</span>
            </span>
            {isLive ? (
              <StatusPill status="live" />
            ) : (
              <Badge tone={TOURNAMENT_STATUS_META[tournament.status].tone}>
                {TOURNAMENT_STATUS_META[tournament.status].label}
              </Badge>
            )}
          </div>

          <div className="flex flex-wrap items-start gap-4">
            {tournament.logo_url && (
              <img src={tournament.logo_url} alt="" className="h-16 w-16 shrink-0 rounded-xl border border-line object-cover" />
            )}
            <div className="min-w-0 flex-1">
              <MaskText
                as="h1"
                className="md-poster-sm text-ink"
                lines={[tournament.name]}
              />
              {tournament.description && (
                <Rise delay={0.12}>
                  <p className="mt-2.5 max-w-xl text-[15px] leading-relaxed text-ink-2">{tournament.description}</p>
                </Rise>
              )}
            </div>
          </div>

          {/* The four facts every visitor needs, in one row. */}
          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-ink-2">
            <span className="flex items-center gap-1.5">
              <Calendar size={14} className="text-ink-3" />
              {fmtDateRange(tournament.start_date, tournament.end_date)}
            </span>
            <span className="flex items-center gap-1.5">
              <MapPin size={14} className="text-ink-3" />
              {tournament.venue}{tournament.location ? `, ${tournament.location}` : ""}
            </span>
            {tournament.organizer_name && (
              <span className="flex items-center gap-1.5">
                <Building2 size={14} className="text-ink-3" />
                {tournament.organizer_name}
              </span>
            )}
          </div>

          <Rise delay={0.2} className="mt-6 flex flex-wrap items-center gap-2.5">
            {/* One unmistakable primary action, chosen by real state: enter
                if anything is open, otherwise watch if anything is live. */}
            {openEvent ? (
              <button
                onClick={() => { setTab("categories"); setRegEvent(openEvent); }}
                className="inline-flex h-11 items-center gap-2 rounded-lg px-6 text-sm font-bold uppercase tracking-wide text-navy-950 transition-[filter] hover:brightness-110"
                style={{ background: accent }}
              >
                Enter this tournament
              </button>
            ) : liveMatches.length > 0 ? (
              <button
                onClick={() => setTab("live")}
                className="inline-flex h-11 items-center gap-2 rounded-lg px-6 text-sm font-bold uppercase tracking-wide text-white"
                style={{ background: "var(--color-live)" }}
              >
                <Radio size={15} /> Watch live
              </button>
            ) : null}
            <FollowButton subjectType="TOURNAMENT" subjectId={tournament.id} />
            <Btn
              size="lg" variant="secondary" icon={Share2}
              onClick={() => {
                const text = `${tournament.name} — ${tournament.venue}, ${fmtDateRange(tournament.start_date, tournament.end_date)}. Live draws, schedule and scores on MatchDay: ${window.location.href}`;
                window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
              }}
            >
              Share
            </Btn>
          </Rise>

          {/* At a glance. Four counts straight off the rows already loaded —
              categories, live entries, matches, completed. It gives the hero
              substance above the tab strip and answers "how big is this
              event?" without a click. Nothing here is estimated, and the
              strip is dropped entirely before a draw exists rather than
              showing a row of zeroes. */}
          {allMatches.length > 0 && (
            <Rise delay={0.28} className="mt-8 grid max-w-2xl grid-cols-2 gap-2.5 sm:grid-cols-4">
              <StatTile label="Categories" value={events.length} />
              <StatTile
                label="Entries"
                value={Object.values(entriesByEvent).flat()
                  .filter((e) => !["REJECTED", "CANCELLED"].includes(e.reg_status)).length}
              />
              <StatTile label="Matches" value={allMatches.length} />
              <StatTile
                label="Completed"
                value={allMatches.filter((m) => ["COMPLETED", "WALKOVER"].includes(m.status)).length}
                tone="done"
              />
            </Rise>
          )}
        </div>
      </header>

      {tournament.announcement && (
        <div
          className="md-edge mt-4 flex items-start gap-2.5 rounded-lg border border-line bg-surface px-4 py-3 pl-5 text-sm"
          style={{ "--md-edge": accent }}
        >
          <Megaphone size={15} className="mt-px shrink-0" style={{ color: accent }} />
          <span className="text-ink">{tournament.announcement}</span>
        </div>
      )}

      {/* ── Tournament-day band ──────────────────────────────────────────
          Injected above the tab strip, so a spectator who opens the link
          mid-event sees court, players and score without navigating. It
          disappears entirely the moment nothing is on court. */}
      {liveMatches.length > 0 && (
        <section className="mt-6">
          <SectionHeader
            eyebrow="On court right now"
            title={
              <span className="flex items-center gap-2.5">
                <span className="md-live-dot" /> Live
              </span>
            }
            action={
              <span className="text-xs text-ink-3">
                {liveMatches.length} match{liveMatches.length === 1 ? "" : "es"}
              </span>
            }
          />
          <div className="grid gap-2.5 sm:grid-cols-2">
            {liveMatches.map((m) => (
              <MatchCard
                key={m.id}
                match={toCardModel(m, events.find((e) => e.id === m.event_id), entriesById, tournament)}
                to={`/m/${m.id}`}
                size="hero"
              />
            ))}
          </div>

          {upNext.length > 0 && (
            <div className="mt-5">
              <div className="md-eyebrow mb-2">Up next</div>
              <div className="grid gap-2 sm:grid-cols-2">
                {upNext.map((m) => (
                  <MatchCard
                    key={m.id}
                    match={toCardModel(m, events.find((e) => e.id === m.event_id), entriesById, tournament)}
                    to={`/m/${m.id}`}
                    size="compact"
                  />
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      <div className="mt-7">
        <Tabs tabs={tabsWithCounts} value={activeTab} onChange={setTab} ariaLabel="Tournament sections" />
      </div>

      {["categories", "schedule", "bracket", "standings", "results", "players"].includes(activeTab) && events.length > 1 && (
        <div className="md-rail -mx-4 mt-4 px-4">
          {events.map((e) => (
            <button
              key={e.id}
              onClick={() => setEventId(e.id)}
              aria-pressed={eventId === e.id}
              className={cx(
                "rounded-lg border px-3.5 py-2 text-xs font-semibold transition-colors",
                eventId === e.id
                  ? "border-transparent text-navy-950"
                  : "border-line bg-surface text-ink-2 hover:border-accent-teal/50 hover:text-ink"
              )}
              style={eventId === e.id ? { background: accent } : undefined}
            >
              {divisionLabel(e)}
            </button>
          ))}
        </div>
      )}

      <div className="pt-5">
        {activeTab === "overview" && (
          <div className="space-y-5">
            {/* Real counts from real rows — no attendance or popularity. */}
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <StatTile label="Categories" value={events.length} />
              <StatTile
                label="Entries"
                value={Object.values(entriesByEvent).flat().filter((e) => !["REJECTED", "CANCELLED"].includes(e.reg_status)).length}
              />
              <StatTile label="Matches" value={allMatches.length} />
              <StatTile
                label="Completed"
                value={allMatches.filter((m) => ["COMPLETED", "WALKOVER"].includes(m.status)).length}
                tone="done"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {tournament.settings?.rules && (
                <div className="md-card p-4">
                  <div className="md-eyebrow mb-2">Format &amp; rules</div>
                  <p className="text-sm leading-relaxed text-ink-2">{tournament.settings.rules}</p>
                </div>
              )}
              {(tournament.contact_email || tournament.contact_phone) && (
                <div className="md-card p-4">
                  <div className="md-eyebrow mb-2">Contact the organizer</div>
                  <p className="text-sm leading-relaxed text-ink-2">
                    {tournament.contact_email}
                    {tournament.contact_email && tournament.contact_phone && <br />}
                    {tournament.contact_phone}
                  </p>
                </div>
              )}
            </div>
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
                <div
                  key={e.id}
                  className="md-card md-edge flex flex-col p-4 pl-5"
                  style={{ "--md-edge": reg.canRegister ? "var(--color-open)" : "var(--color-line)" }}
                >
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div className="md-display text-xl text-ink">{divisionLabel(e)}</div>
                    <Badge tone={reg.tone}>{reg.label}</Badge>
                  </div>

                  <div className="text-sm font-semibold text-ink">
                    {Number(e.fee_inr) > 0 ? `${inr(e.fee_inr)} entry` : "Free entry"}
                  </div>

                  <CapacityBar filled={taken} capacity={e.max_entries} className="mt-3.5" />

                  <div className="mt-2 text-[11px] text-ink-3">
                    {reg.key === "WAITLIST" ? `Full — ${waitlisted} waiting`
                      : reg.key === "NOT_OPEN" && tournament.registration_opens_at ? `Opens ${fmtDateTime(tournament.registration_opens_at)}`
                      : reg.key === "OPEN" || reg.key === "ALMOST_FULL" ? `${left} place${left === 1 ? "" : "s"} available`
                      : EVENT_STATUS_META[e.status]?.label}
                  </div>

                  <div className="flex-1" />
                  <Btn size="md" className="mt-3.5 w-full" disabled={!reg.canRegister} onClick={() => setRegEvent(e)}>
                    {reg.key === "WAITLIST" ? "Join waitlist"
                      : reg.canRegister ? "Register"
                      : reg.key === "COMPLETED" ? "Tournament finished"
                      : reg.key === "NOT_OPEN" ? "Not open yet" : "Registration closed"}
                  </Btn>
                </div>
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
          liveMatches.length === 0 ? (
            <EmptyState icon={Radio} title="No live matches right now"
              hint="Scores appear here the moment a scorer starts a match." />
          ) : (
            <div className="grid gap-2.5 sm:grid-cols-2">
              {liveMatches.map((m) => (
                <MatchCard
                  key={m.id}
                  match={toCardModel(m, events.find((e) => e.id === m.event_id), entriesById, tournament)}
                  to={`/m/${m.id}`}
                  size="hero"
                />
              ))}
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
                hint="Standings come from round-robin and group formats. This category is a straight knockout — see the Draw tab." />
        )}

        {activeTab === "results" && event && <ResultsPanel event={event} matches={eventMatches} entriesById={entriesById} />}

        {/* Players — the public entry list, name-only by design. Contact
            details live on entry_players, which is organizer-only; this reads
            the public_entry_names projection instead. */}
        {activeTab === "players" && event && (() => {
          const list = (entriesByEvent[event.id] || [])
            .filter((e) => !["REJECTED", "CANCELLED"].includes(e.reg_status))
            .sort((a, b) => (a.seed ?? 999) - (b.seed ?? 999) || entryName(a).localeCompare(entryName(b)));
          if (!list.length) return <EmptyState icon={Users} title="No entries yet" hint="Registered players appear here once the organizer confirms them." />;
          return (
            <div>
              <div className="md-eyebrow mb-3">
                {list.length} {list.length === 1 ? "entry" : "entries"} in {divisionLabel(event)}
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {list.map((en) => (
                  <div key={en.id} className="md-card flex items-center justify-between gap-2 p-3.5">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-ink">{entryName(en)}</div>
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
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {activeTab === "sponsors" && (
          <div>
            <div className="md-eyebrow mb-3">This tournament is supported by</div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {sponsors.map((s, i) => {
                const inner = (
                  <div className="md-card md-card-link flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
                    {s.logoUrl && <img src={s.logoUrl} alt={s.name || "Sponsor"} className="max-h-16 max-w-full object-contain" />}
                    {s.name && <div className="text-sm font-semibold text-ink">{s.name}</div>}
                    {s.url && <span className="flex items-center gap-1 text-[11px] text-ink-3"><ExternalLink size={10} /> Visit</span>}
                  </div>
                );
                return s.url
                  ? <a key={i} href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="block">{inner}</a>
                  : <div key={i}>{inner}</div>;
              })}
            </div>
          </div>
        )}
      </div>

      {/* Sponsor strip under every tab, so backers get visibility without
          needing the visitor to open a dedicated section. Deliberately quiet:
          a sponsor must never outweigh a live score. */}
      {sponsors.length > 0 && activeTab !== "sponsors" && (
        <div className="mt-10 border-t border-line-soft pt-5">
          <div className="md-eyebrow mb-3">Supported by</div>
          <div className="flex flex-wrap items-center gap-x-7 gap-y-3 opacity-70">
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

/* "Your next match" lookup by name — searches every category in the
   tournament (a player can be in Singles + Doubles + Mixed at once) and
   surfaces the soonest upcoming match with report-by time and opponent.

   This is the single most-used control at a real venue: a player who does
   not have the app, standing in a hall, wanting to know when and where. */
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
    <div className="md-card md-edge p-4 pl-5">
      <div className="md-eyebrow mb-2.5">Find your next match</div>
      <div className="flex gap-2">
        <input
          className={inputCls} placeholder="Enter your name" value={query}
          aria-label="Your name"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
        />
        <Btn size="md" icon={Search} onClick={search}>Search</Btn>
      </div>
      {result === "none" && <div className="mt-3 text-sm text-ink-2">No upcoming match found for that name.</div>}
      {result && result !== "none" && (
        <div className="mt-3.5 rounded-xl border border-accent-teal/40 bg-accent-teal/[0.07] p-4">
          <div className="md-eyebrow text-accent-teal">Your next match</div>
          <div className="md-display mt-1.5 text-4xl text-ink">{fmtTime(result.match.scheduled_at)}</div>
          <div className="mt-0.5 text-sm text-ink-2">{fmtDateTime(result.match.scheduled_at)}</div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <div className="md-eyebrow">Court</div>
              <div className="md-display mt-0.5 text-2xl text-ink">{result.match.court || "TBD"}</div>
            </div>
            <div className="min-w-0">
              <div className="md-eyebrow">Opponent</div>
              <div className="mt-1 truncate text-sm font-semibold text-ink">{entryShort(result.opponent) || "TBD"}</div>
            </div>
          </div>
          <div className="mt-3 text-xs text-ink-3">
            {matchStageLabel(result.match, result.event)} · {divisionLabel(result.event)}
          </div>
        </div>
      )}
    </div>
  );
}
