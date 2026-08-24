import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Radio, Megaphone, WifiOff } from "lucide-react";
import {
  cx, entryShort, matchStageLabel, fmtTime, divisionLabel, accentTheme,
  BadmintonScoringEngine, toAB, displayTitle, displaySentence,
} from "../lib/engines";
import { getTournamentBySlug, listEvents, listEntriesPublic, listMatches, listCourts, subscribeToEvent } from "../lib/repository";
import { courtBoard } from "../lib/analytics";
import { BrandLoader } from "../components/ui/motion";
import { EmptyState } from "../components/ui/primitives";
import logo from "../assets/logo.png";

/* Public, no-login TV/projector view. Optimised for being read across a hall:
   very large type, high contrast, no interaction, no chrome. It rotates
   between panes on a timer so a single screen can cover live scores, what is
   coming up, and recent results without anyone touching it.

   Everything is sized in viewport units so the same page fills a 1080p TV, a
   4K screen and a projector without a per-venue tweak. */

const ROTATE_MS = 12000;

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000 * 20);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="text-right">
      <div className="font-display text-[2.6vw] font-bold leading-none text-white">
        {now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
      </div>
      <div className="text-[1vw] text-white/50">
        {now.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}
      </div>
    </div>
  );
}

function LiveCard({ m, event, entriesById, accent }) {
  const games = [...(m.games || [])].sort((x, y) => x.game_number - y.game_number);
  const current = games[games.length - 1];
  const tally = BadmintonScoringEngine.gameTally(toAB(games));
  const a = current?.score_a ?? 0;
  const b = current?.score_b ?? 0;
  const lead = a === b ? null : a > b ? "A" : "B";
  return (
    <div className="rounded-[1.2vw] border-2 bg-white/[0.06] p-[1.6vw]" style={{ borderColor: `${accent}66` }}>
      <div className="mb-[0.8vw] flex items-baseline justify-between">
        <span className="font-display text-[2vw] font-bold leading-none" style={{ color: accent }}>{m.court || "Court"}</span>
        <span className="text-[1vw] uppercase tracking-wide text-white/50">
          {divisionLabel(event)} · {matchStageLabel(m, event)}
        </span>
      </div>
      <div className="space-y-[0.5vw]">
        {[["A", m.entry_a, a], ["B", m.entry_b, b]].map(([side, entryId, score]) => (
          <div key={side} className="flex items-center justify-between gap-[1vw]">
            <span className={cx("truncate text-[2.1vw] font-semibold leading-tight", lead === side ? "text-white" : "text-white/75")}>
              {entryShort(entriesById[entryId]) || "TBD"}
            </span>
            <span className={cx("font-display text-[3.4vw] font-bold leading-none tabular-nums", lead === side ? "text-white" : "text-white/60")}>
              {score}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-[0.8vw] text-[1vw] text-white/45">Games {tally.a}–{tally.b}</div>
    </div>
  );
}

export default function VenueDisplay() {
  const { slug } = useParams();
  const [tournament, setTournament] = useState(null);
  const [events, setEvents] = useState([]);
  const [entriesById, setEntriesById] = useState({});
  const [matches, setMatches] = useState([]);
  const [courts, setCourts] = useState([]);
  const [notFound, setNotFound] = useState(false);
  const [pane, setPane] = useState(0);
  // A venue TV showing a stale score is worse than one showing nothing,
  // because everyone in the hall believes it. This records when data last
  // actually arrived so the board can say so when it goes quiet.
  const [lastSync, setLastSync] = useState(null);
  const [stale, setStale] = useState(false);

  const loadAll = useCallback(async (t) => {
    const evs = await listEvents(t.id);
    setEvents(evs);
    const results = await Promise.all(evs.map(async (e) => ({ entries: await listEntriesPublic(e.id), matches: await listMatches(e.id) })));
    const eb = {};
    results.forEach((r) => r.entries.forEach((en) => (eb[en.id] = en)));
    setEntriesById(eb);
    setMatches(results.flatMap((r) => r.matches));
    setCourts(await listCourts(t.id));
    setLastSync(Date.now());
    setStale(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const t = await getTournamentBySlug(slug);
        if (cancelled) return;
        setTournament(t);
        await loadAll(t);
      } catch { if (!cancelled) setNotFound(true); }
    })();
    return () => { cancelled = true; };
  }, [slug, loadAll]);

  useEffect(() => {
    if (events.length === 0 || !tournament) return;
    const unsubs = events.map((e) => subscribeToEvent(e.id, () => loadAll(tournament)));
    return () => unsubs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events.map((e) => e.id).join(","), tournament]);

  // Rotate the lower half between "coming up" and "recent results".
  useEffect(() => {
    const t = setInterval(() => setPane((p) => (p + 1) % 2), ROTATE_MS);
    return () => clearInterval(t);
  }, []);

  // Realtime is the primary path, but a websocket can die quietly — on a TV
  // that nobody is touching, that failure is invisible. This re-reads on a
  // slow timer as a safety net, and flags the board as stale if even that
  // fails, so the hall is never told a score that is no longer true.
  useEffect(() => {
    if (!tournament) return;
    const poll = setInterval(() => {
      loadAll(tournament).catch(() => setStale(true));
    }, 60_000);
    return () => clearInterval(poll);
  }, [tournament, loadAll]);

  useEffect(() => {
    const tick = setInterval(() => {
      if (lastSync && Date.now() - lastSync > 150_000) setStale(true);
    }, 15_000);
    return () => clearInterval(tick);
  }, [lastSync]);

  if (notFound) return <EmptyState icon={Radio} title="Tournament not found" />;
  if (!tournament) return <BrandLoader />;

  const theme = accentTheme(tournament.accent_color);
  const accent = theme.isCustom ? theme.accent : "#2DD4BF";
  const eventById = Object.fromEntries(events.map((e) => [e.id, e]));
  const real = matches.filter((m) => !m.is_bye);
  const live = real.filter((m) => m.status === "LIVE");
  const board = courtBoard(courts, real);
  const sponsors = Array.isArray(tournament.sponsors) ? tournament.sponsors.filter((s) => s?.logoUrl || s?.name) : [];

  const next = real
    .filter((m) => (m.status === "READY" || m.status === "SCHEDULED") && m.scheduled_at)
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
    .slice(0, 8);

  const recent = real
    .filter((m) => ["COMPLETED", "WALKOVER"].includes(m.status))
    .sort((a, b) => (b.completed_at || "").localeCompare(a.completed_at || ""))
    .slice(0, 8);

  // With nothing finished yet there is no second pane worth rotating to.
  const showResults = pane === 1 && recent.length > 0;

  return (
    <div className="flex min-h-screen flex-col bg-navy-950 p-[2vw] text-white">
      {/* ── Header: organizer branding, MatchDay stays the platform mark ── */}
      <header className="mb-[1.5vw] flex items-center justify-between gap-[2vw]">
        <div className="flex min-w-0 items-center gap-[1.2vw]">
          {tournament.logo_url
            ? <img src={tournament.logo_url} alt="" className="h-[5vw] w-[5vw] shrink-0 rounded-[0.8vw] object-cover" />
            : <img src={logo} alt="" className="h-[5vw] w-[5vw] shrink-0 rounded-[0.8vw]" />}
          <div className="min-w-0">
            {/* Display casing only — the stored name is untouched. This is a
                broadcast surface read across a hall, where "chennai premier
                league" in lower case reads as unfinished. Acronyms the
                organizer typed (CSK) survive intact; see displayTitle. */}
            <h1 className="truncate font-display text-[3.2vw] font-bold leading-none">{displayTitle(tournament.name)}</h1>
            <div className="mt-[0.4vw] text-[1.2vw] text-white/50">
              {displayTitle(tournament.venue)}{tournament.location ? `, ${displayTitle(tournament.location)}` : ""}
            </div>
          </div>
        </div>
        <Clock />
      </header>

      {/* Sized in vw like everything else on this board so it reads from the
          back of a hall, not just from a desk. */}
      {stale && (
        <div className="mb-[1.2vw] flex items-center gap-[1vw] rounded-[0.8vw] border-2 border-amber-500/60 bg-amber-500/15 px-[1.4vw] py-[0.9vw]">
          <WifiOff className="shrink-0 text-amber-300" style={{ width: "2vw", height: "2vw" }} />
          <span className="text-[1.5vw] font-semibold text-amber-100">
            Connection lost — scores below may be out of date
          </span>
        </div>
      )}

      {tournament.announcement && (
        <div className="mb-[1.2vw] flex items-center gap-[1vw] rounded-[0.8vw] px-[1.4vw] py-[0.9vw]"
          style={{ background: `${accent}1f`, border: `2px solid ${accent}55` }}>
          <Megaphone className="shrink-0" style={{ color: accent, width: "2vw", height: "2vw" }} />
          {/* Sentence case, not title case — an announcement is prose, and
              "Courts 3 And 4 Are In 1st Floor" would read as a headline. */}
          <span className="text-[1.6vw] font-medium">{displaySentence(tournament.announcement)}</span>
        </div>
      )}

      {/* ── Live ─────────────────────────────────────────────────────── */}
      <div className="mb-[1vw] flex items-center gap-[0.8vw]">
        <span className="inline-block rounded-full bg-red-500" style={{ width: "1vw", height: "1vw", animation: "pulse 1.6s ease-in-out infinite" }} />
        <span className="text-[1.6vw] font-bold uppercase tracking-widest text-red-300">Live now</span>
      </div>
      {live.length === 0 ? (
        <div className="mb-[1.5vw] rounded-[1.2vw] border-2 border-white/10 bg-white/[0.04] py-[3vw] text-center text-[1.8vw] text-white/40">
          No match is being played right now
        </div>
      ) : (
        <div className={cx("mb-[1.5vw] grid gap-[1.2vw]", live.length <= 2 ? "grid-cols-2" : live.length <= 4 ? "grid-cols-2" : "grid-cols-3")}>
          {live.slice(0, 6).map((m) => (
            <LiveCard key={m.id} m={m} event={eventById[m.event_id]} entriesById={entriesById} accent={accent} />
          ))}
        </div>
      )}

      {/* ── Court status strip ───────────────────────────────────────── */}
      {courts.length > 0 && (
        <div className="mb-[1.5vw] grid gap-[0.8vw]" style={{ gridTemplateColumns: `repeat(${Math.min(courts.length, 8)}, minmax(0, 1fr))` }}>
          {board.slice(0, 8).map((c) => (
            <div key={c.court.id} className="rounded-[0.6vw] border-2 px-[0.8vw] py-[0.6vw]"
              style={{
                borderColor: c.state === "LIVE" ? "#f8717166" : c.state === "AVAILABLE" ? "#34d39966" : "#ffffff1a",
                background: c.state === "LIVE" ? "#f871711a" : "#ffffff08",
              }}>
              <div className="truncate text-[1.2vw] font-bold">{c.court.name}</div>
              <div className={cx("text-[0.95vw]",
                c.state === "LIVE" ? "text-red-300" : c.state === "AVAILABLE" ? "text-emerald-300" : "text-white/45")}>
                {c.state === "LIVE" ? "In play" : c.state === "NEXT" ? fmtTime(c.nextMatch.scheduled_at) : c.state === "AVAILABLE" ? "Free" : "Closed"}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Rotating lower pane ──────────────────────────────────────── */}
      <div className="flex-1">
        <div className="mb-[0.8vw] flex items-center justify-between">
          <span className="text-[1.6vw] font-bold uppercase tracking-widest text-white/70">
            {showResults ? "Recent results" : "Coming up"}
          </span>
          {recent.length > 0 && (
            <div className="flex gap-[0.5vw]">
              {[0, 1].map((i) => (
                <span key={i} className="rounded-full"
                  style={{ width: "0.7vw", height: "0.7vw", background: (showResults ? 1 : 0) === i ? accent : "#ffffff33" }} />
              ))}
            </div>
          )}
        </div>

        {showResults ? (
          <div className="grid grid-cols-2 gap-[0.8vw]">
            {recent.map((m) => {
              const games = [...(m.games || [])].sort((x, y) => x.game_number - y.game_number);
              const tally = BadmintonScoringEngine.gameTally(toAB(games));
              const winnerIsA = m.winner_entry_id === m.entry_a;
              return (
                <div key={m.id} className="rounded-[0.8vw] border-2 border-white/10 bg-white/[0.03] px-[1.2vw] py-[0.9vw]">
                  <div className="text-[1vw] uppercase tracking-wide text-white/40">
                    {divisionLabel(eventById[m.event_id])} · {matchStageLabel(m, eventById[m.event_id])}
                  </div>
                  <div className="mt-[0.3vw] flex items-center justify-between gap-[1vw]">
                    <span className="truncate text-[1.6vw] font-semibold" style={{ color: accent }}>
                      {entryShort(entriesById[m.winner_entry_id]) || "—"}
                    </span>
                    <span className="shrink-0 font-display text-[1.6vw] font-bold tabular-nums text-white/80">
                      {winnerIsA ? `${tally.a}–${tally.b}` : `${tally.b}–${tally.a}`}
                    </span>
                  </div>
                  <div className="truncate text-[1.3vw] text-white/45">
                    beat {entryShort(entriesById[winnerIsA ? m.entry_b : m.entry_a]) || "—"}
                    {m.retired ? " (retired)" : ""}
                  </div>
                </div>
              );
            })}
          </div>
        ) : next.length === 0 ? (
          <div className="rounded-[1.2vw] border-2 border-white/10 bg-white/[0.04] py-[3vw] text-center text-[1.8vw] text-white/40">
            Nothing scheduled next
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-[0.8vw]">
            {next.map((m) => (
              <div key={m.id} className="flex items-center gap-[1.2vw] rounded-[0.8vw] border-2 border-white/10 bg-white/[0.03] px-[1.2vw] py-[0.9vw]">
                <div className="shrink-0 text-center">
                  <div className="font-display text-[2vw] font-bold leading-none tabular-nums" style={{ color: accent }}>
                    {fmtTime(m.scheduled_at)}
                  </div>
                  <div className="text-[1vw] text-white/45">{m.court || "TBD"}</div>
                </div>
                <div className="min-w-0">
                  <div className="text-[1vw] uppercase tracking-wide text-white/40">
                    {divisionLabel(eventById[m.event_id])} · {matchStageLabel(m, eventById[m.event_id])}
                  </div>
                  <div className="truncate text-[1.7vw] font-semibold">
                    {entryShort(entriesById[m.entry_a])} <span className="text-white/35">vs</span> {entryShort(entriesById[m.entry_b])}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Sponsors + MatchDay mark ─────────────────────────────────── */}
      <footer className="mt-[1.5vw] flex items-center justify-between gap-[2vw] border-t-2 border-white/10 pt-[1vw]">
        <div className="flex min-w-0 flex-wrap items-center gap-x-[2vw] gap-y-[0.5vw]">
          {sponsors.length > 0 && <span className="text-[0.9vw] uppercase tracking-widest text-white/35">Supported by</span>}
          {sponsors.map((s, i) => (
            s.logoUrl
              ? <img key={i} src={s.logoUrl} alt={s.name || ""} className="max-h-[3vw] object-contain" />
              : <span key={i} className="text-[1.3vw] font-medium text-white/60">{s.name}</span>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-[0.6vw] opacity-60">
          <img src={logo} alt="" className="h-[2vw] w-[2vw] rounded" />
          <span className="wordmark text-[1.4vw] uppercase leading-none">Matchday</span>
        </div>
      </footer>
    </div>
  );
}
