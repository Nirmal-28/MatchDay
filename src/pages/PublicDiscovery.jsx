import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Trophy, ArrowRight, Search, SlidersHorizontal, X, Radio, Flame, Timer, ChevronDown,
} from "lucide-react";
import {
  cx, fmtDateRange, inr, TOURNAMENT_STATUS_META,
  CATEGORY_META, AGE_GROUPS, SKILL_GRADES, todayLocal,
} from "../lib/engines";
import { listDiscoverableTournaments, listEvents, listMatches, listCourts } from "../lib/repository";
import { useAuth } from "../lib/AuthContext";
import { tournamentRegistrationState } from "../lib/lifecycle";
import { EmptyState, inputCls } from "../components/ui/primitives";
import { SportIcon, SPORT_KEYS } from "../components/ui/motion";
import {
  SectionHeader, TournamentCard, CardSkeletonGrid, StatusPill, sportAccent,
} from "../components/ui/md";
import { MaskText, Rise, Magnetic, Stagger, StaggerChild, Counter } from "../components/ui/reveal";
import { sportMeta } from "../lib/sports";
import logo from "../assets/logo.png";
import { useDocumentMeta } from "../lib/useDocumentMeta";

/* ═══════════════════════════════════════════════════════════════════════
   DISCOVERY
   ═══════════════════════════════════════════════════════════════════════

   Rebuilt around the five questions a visitor actually arrives with:

     What can I play?      → sport chips, first control on the page
     What's happening?     → LIVE NOW, above everything else, when real
     What's open?          → OPEN FOR ENTRY rail
     What's closing soon?  → CLOSING SOON rail, computed from the real
                             registration deadline
     What's nearly gone?   → ALMOST FULL rail, computed from real capacity

   Every rail is derived from data the database already returns. There is no
   popularity, trending, attendance or "hot right now" signal anywhere on
   this page: MatchDay does not have that data, and inventing it on the most
   public screen in the product would be a lie.

   The hero used to be an 85vh column that played a 1.3-second logo assembly
   before the headline appeared, with the first tournament roughly two
   screens down. It is now a single screen-top block that carries the
   headline, the live counts and the search field — a visitor reaches real
   tournaments without scrolling on a laptop, and after one swipe on a phone.
   ══════════════════════════════════════════════════════════════════════ */

const EMPTY_FILTERS = {
  q: "", sport: "ALL", status: "ALL", category: "ALL", age: "ALL",
  gender: "ALL", grade: "ALL", maxFee: "", fromDate: "", toDate: "", openOnly: false,
};

// Days out from today, or null when there is no date. Used for "closing soon".
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const today = todayLocal();
  const ms = new Date(`${dateStr}T00:00:00`) - new Date(`${today}T00:00:00`);
  return Math.round(ms / 86400000);
}

// One tournament row → the shape <TournamentCard/> renders. Kept in one place
// so discovery, a player's list and an organizer's list cannot drift apart.
function toCardModel(t) {
  const reg = tournamentRegistrationState(t, t.events);
  const meta = TOURNAMENT_STATUS_META[t.status];
  const live = t.status === "LIVE";

  const status = live ? "live"
    : reg.canRegister ? "open"
    : t.status === "COMPLETED" ? "done"
    : "full";

  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    sport: t.sport || "badminton",
    sportLabel: sportMeta(t.sport).label,
    dateLabel: fmtDateRange(t.start_date, t.end_date),
    venue: t.venue,
    location: t.location,
    live,
    status,
    statusLabel: live ? "Live" : reg.canRegister ? reg.label : meta?.label || t.status,
    capacity: t.capacity,
    filled: t.capacity ? t.capacity - t.spotsLeft : null,
    fee: t.maxFee === 0 ? "Free entry"
      : t.minFee === t.maxFee ? inr(t.minFee)
      : `${inr(t.minFee)}–${inr(t.maxFee)}`,
    reg,
  };
}

/* ── Ticker ───────────────────────────────────────────────────────────────
   A scoreboard ticker running under the hero. It carries REAL content: live
   scores when anything is on court, otherwise the sports the platform
   actually runs and the open-entry count.

   This is the one continuously moving element in the product and it is a
   deliberate exception, not a relapse: a ticker is how a venue board and a
   broadcast lower-third have always shown a run of results. It is content
   in motion rather than decoration behind content — it never sits under
   text, it pauses on hover so a score can be read, and reduced motion stops
   it dead with the first run still legible. */
function Ticker({ items }) {
  if (!items.length) return null;
  // Duration scales with content so a long run does not sprint past.
  const duration = Math.max(28, items.length * 5);
  const run = (
    <>
      {items.map((it, i) => (
        <span key={i} className="flex items-center gap-2.5 whitespace-nowrap">
          {it.live && <span className="md-live-dot" />}
          <span className={cx("md-display text-2xl", it.live ? "text-ink" : "text-ink-3")}>
            {it.label}
          </span>
          {it.value && <span className="md-score text-2xl text-accent-teal">{it.value}</span>}
          <span className="text-ink-3/40" aria-hidden="true">/</span>
        </span>
      ))}
    </>
  );

  return (
    <div
      className="md-bleed border-y border-line bg-surface/40 py-3"
      style={{ "--marquee-duration": `${duration}s` }}
    >
      {/* One accessible copy; the duplicated visual runs are hidden so a
          screen reader does not read the same scores twice. */}
      <span className="sr-only">
        {items.map((i) => `${i.label} ${i.value || ""}`).join(", ")}
      </span>
      <div className="md-marquee" aria-hidden="true">
        <div>{run}</div>
        {/* The second run is what makes the loop seamless — it slides in
            behind the first as that one leaves. */}
        <div>{run}</div>
      </div>
    </div>
  );
}

/* ── Hero ───────────────────────────────────────────────────────────────
   A poster, not a page header.

   This is deliberately built to break the app's 72rem reading column and
   take the whole viewport, with type at a scale that fills the measure edge
   to edge. The previous version sat politely inside the container at
   heading size, which is why the redesign read as "same layout, nicer
   fonts" — the composition, not the palette, is what makes a landing feel
   like a product worth entering.

   The three lines alternate solid and outlined weight so the block reads as
   one shape. Everything below is still. */
function Hero({ liveCount, openCount, query, onQuery, session }) {
  return (
    <section className="md-bleed md-court-texture relative -mt-6 overflow-hidden border-b border-line">
      <div className="mx-auto flex min-h-[88vh] max-w-[110rem] flex-col justify-center px-5 pb-14 pt-24 sm:px-10">
        <Rise className="mb-7 flex flex-wrap items-center gap-x-4 gap-y-2">
          {liveCount > 0 && (
            <span className="md-status md-status-live">
              <span className="md-live-dot" />
              {liveCount} tournament{liveCount === 1 ? "" : "s"} live
            </span>
          )}
          {openCount > 0 && (
            <span className="md-status md-status-open">{openCount} open for entry</span>
          )}
          <span className="md-eyebrow">Multi-sport competition platform</span>
        </Rise>

        {/* The statement. Line by line from behind its own mask, then still
            forever. The middle line is outlined so the block has internal
            rhythm rather than three identical bars of type. */}
        <MaskText
          as="h1"
          className="md-poster text-ink"
          lines={["Play.", "Compete.", "Belong."]}
          lineClassName={(i) => (i === 1 ? "md-outline" : undefined)}
          stagger={0.09}
        />

        <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-end">
          <Rise delay={0.3}>
            <p className="max-w-md text-base leading-relaxed text-ink-2 sm:text-lg">
              Anyone can enter the arena — any age, any level, any sport. Find a
              tournament, enter it, and follow every point live.
            </p>
            <div className="mt-4 text-[13px] text-ink-3">
              Running one yourself?{" "}
              <Link to={session ? "/organizer" : "/host"} className="md-underline font-semibold text-accent-teal">
                Host a tournament
              </Link>
            </div>
          </Rise>

          {/* Search sits in the hero because "what can I play" is the first
              question, and burying the field below marketing sections made
              people scroll past the thing they came for. */}
          <Rise delay={0.38} className="flex flex-col gap-2.5">
            <div className="relative">
              <Search size={17} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-3" />
              <label className="sr-only" htmlFor="discover-search">Search tournaments</label>
              <input
                id="discover-search"
                className="h-14 w-full rounded-xl border border-line bg-surface/70 pl-12 pr-4 text-[15px] text-ink placeholder-ink-3 backdrop-blur focus:border-accent-teal focus:outline-none"
                placeholder="Search tournaments, venues, cities"
                value={query}
                onChange={(e) => onQuery(e.target.value)}
              />
            </div>
            {/* The one magnetic control in the product — a small reward for
                aiming at the primary action, and one that would stop meaning
                anything if every button did it. */}
            <Magnetic>
              <a
                href="#tournaments"
                className="md-group flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-accent-teal text-sm font-bold uppercase tracking-widest text-navy-950 transition-[filter] hover:brightness-110"
              >
                Browse every event <ArrowRight size={16} className="md-arrow" />
              </a>
            </Magnetic>
          </Rise>
        </div>

        <div className="mt-14 flex items-center gap-2 text-ink-3">
          <ChevronDown size={16} className="md-cue" aria-hidden="true" />
          <span className="md-eyebrow">Scroll</span>
        </div>
      </div>
    </section>
  );
}

/* ── Live strip ─────────────────────────────────────────────────────────
   Only rendered when a tournament really is live. The counts are actual
   row counts from the live tournament's matches and courts. */
function LiveStrip({ tournament, matches, courts }) {
  const live = matches.filter((m) => m.status === "LIVE");
  const completed = matches.filter((m) => m.status === "COMPLETED" || m.status === "WALKOVER");
  const accent = sportAccent(tournament.sport);

  return (
    <section className="md-section">
      <SectionHeader
        eyebrow="Happening now"
        title="Live on court"
        action={
          <Link to={`/t/${tournament.slug}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent-teal hover:underline">
            Watch <ArrowRight size={14} />
          </Link>
        }
      />
      <Link to={`/t/${tournament.slug}`} className="block">
        <div
          className="md-card md-card-link md-edge md-live-surface p-5 pl-6"
          style={{ "--md-edge": "var(--color-live)" }}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="mb-1.5 flex items-center gap-2">
                <SportIcon sport={tournament.sport} className="h-4 w-4" style={{ color: accent }} />
                <span className="md-eyebrow" style={{ color: accent }}>{sportMeta(tournament.sport).label}</span>
              </div>
              <h3 className="md-display text-2xl text-ink sm:text-3xl">{tournament.name}</h3>
              <div className="mt-1 text-[13px] text-ink-2">
                {[tournament.venue, tournament.location].filter(Boolean).join(" · ")}
              </div>
            </div>
            <StatusPill status="live" />
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "On court now", value: live.length, live: true },
              { label: "Courts", value: courts.length },
              { label: "Completed", value: completed.length },
              { label: "Total matches", value: matches.length },
            ].map((s) => (
              <div key={s.label} className="rounded-lg border border-line bg-surface-2/60 px-3 py-2.5">
                <div
                  className="md-score text-3xl"
                  style={{ color: s.live && s.value > 0 ? "var(--color-live)" : "var(--color-ink)" }}
                >
                  {/* Counts up once on arrival. Only ever applied to real
                      row counts — a count-up implies a tally that actually
                      happened, so it must never dress a derived figure. */}
                  <Counter value={s.value} />
                </div>
                <div className="md-eyebrow mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </Link>
    </section>
  );
}

/* ── Curated rail ───────────────────────────────────────────────────────
   A horizontally scrolling row on a phone, a grid on a laptop. Renders
   nothing at all when its list is empty — an empty "Closing soon" shelf
   would be a worse signal than no shelf. */
function Rail({ eyebrow, title, icon: Icon, tone, tournaments }) {
  if (!tournaments.length) return null;
  return (
    <section className="md-section">
      <SectionHeader
        eyebrow={eyebrow}
        title={
          <span className="flex items-center gap-2">
            {Icon && <Icon size={20} style={{ color: tone }} aria-hidden="true" />}
            {title}
          </span>
        }
      />
      {/* One markup path, two layouts: the rail scrolls below `sm`, and the
          same children lay out as a grid from `sm` up. */}
      <Stagger className="md-rail -mx-4 px-4 sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-3 sm:overflow-visible sm:px-0 lg:grid-cols-3">
        {tournaments.map((t) => (
          <StaggerChild key={t.id} className="w-[78vw] max-w-[320px] sm:w-auto sm:max-w-none">
            <TournamentCard t={t} variant="featured" />
          </StaggerChild>
        ))}
      </Stagger>
    </section>
  );
}

/* ── Sport chips ───────────────────────────────────────────────────────
   The primary filter, and the clearest statement that MatchDay is not a
   badminton app. A sport with no tournaments is shown disabled with its
   real count rather than hidden — that is honest about coverage without
   pretending the sport does not exist. */
function SportChips({ value, onChange, counts }) {
  const all = ["ALL", ...SPORT_KEYS];
  return (
    <div className="md-rail -mx-4 px-4 pb-1" role="group" aria-label="Filter by sport">
      {all.map((key) => {
        const on = value === key;
        const count = key === "ALL"
          ? Object.values(counts).reduce((a, b) => a + b, 0)
          : counts[key] || 0;
        const accent = key === "ALL" ? "var(--color-accent-teal)" : sportAccent(key);
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            disabled={count === 0 && key !== "ALL" && !on}
            aria-pressed={on}
            className={cx(
              "flex items-center gap-2 rounded-lg border px-3.5 py-2.5 text-[13px] font-semibold transition-colors",
              on
                ? "border-transparent text-navy-950"
                : count === 0
                  ? "border-line-soft text-ink-3 opacity-45"
                  : "border-line bg-surface text-ink-2 hover:border-accent-teal/50 hover:text-ink"
            )}
            style={on ? { background: accent } : undefined}
          >
            {key !== "ALL" && <SportIcon sport={key} className="h-4 w-4" />}
            {key === "ALL" ? "All sports" : sportMeta(key).label}
            <span className={cx("text-[11px] tabular-nums", on ? "opacity-70" : "text-ink-3")}>{count}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ── Brand statement ────────────────────────────────────────────────────
   Was a row of seven human figures animating in on scroll. It is now a
   still composition — the sentence is the point, and it reads better
   without seven things sliding underneath it. */
function EveryoneCanPlay() {
  return (
    // The one inverted block in the product. Coming out of a long dark
    // scroll onto a light ground is the strongest section transition
    // available without a single frame of animation — and it is spent here,
    // once, on the sentence the whole platform exists for. A second inverted
    // section would turn a statement into a stripe pattern.
    <section className="md-bleed md-invert md-section md-hatch relative mt-16 overflow-hidden">
      <div className="mx-auto max-w-[110rem] px-5 sm:px-10">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-end">
          <div>
            <div className="md-eyebrow mb-6">The whole point</div>
            <MaskText
              as="h2"
              className="md-poster-sm text-ink"
              lines={["Anyone", "can compete."]}
              lineClassName={(i) => (i === 1 ? "md-outline" : undefined)}
            />
          </div>
          <Rise delay={0.15}>
            <p className="max-w-md text-lg leading-relaxed text-ink-2">
              No matter your age, background or skill level, there is a place for you
              on the court. Different people, different sports, one competition.
            </p>
            <div className="mt-7 flex items-center gap-3">
              <img src={logo} alt="" className="h-11 w-11 rounded-xl" width="44" height="44" />
              <span className="wordmark text-2xl uppercase leading-none text-ink">
                Match<span className="wordmark-accent">day</span>
              </span>
            </div>
          </Rise>
        </div>
      </div>
    </section>
  );
}

/* ── Sport coverage ─────────────────────────────────────────────────────
   Reads its truth from the sport registry rather than a hardcoded list, so
   the moment a sport gains a real scoring engine it moves out of "coming
   soon" here with no edit to this file. */
function SportCoverage() {
  const sports = SPORT_KEYS.map((k) => ({ key: k, ...sportMeta(k) }));
  return (
    <section className="md-section">
      <SectionHeader eyebrow="Built for every sport" title="One platform. Every competition." />
      <p className="-mt-1 mb-5 max-w-xl text-sm text-ink-2">
        Draws, seeding, scheduling, check-in and rankings are sport-agnostic and work
        today. Scoring is the part that differs per sport, and it ships one sport at a time.
      </p>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
        {sports.map((s) => {
          const ready = s.hasScoringEngine;
          return (
            <div
              key={s.key}
              className={cx(
                "md-card md-edge flex items-center gap-3 px-3.5 py-3 pl-5",
                !ready && "opacity-55"
              )}
              style={{ "--md-edge": ready ? sportAccent(s.key) : "var(--color-line)" }}
            >
              <SportIcon
                sport={s.key}
                className="h-6 w-6 shrink-0"
                style={{ color: ready ? sportAccent(s.key) : "var(--color-ink-3)" }}
              />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-ink">{s.label}</div>
                <div className="md-eyebrow mt-0.5" style={ready ? { color: "var(--color-open)" } : undefined}>
                  {ready ? "Live" : "Scoring soon"}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function PublicDiscovery() {
  const [tournaments, setTournaments] = useState(null);
  useDocumentMeta();
  const [liveData, setLiveData] = useState(undefined); // undefined = loading, null = none live
  const { session } = useAuth();

  // Discovery filters. Every one reads a real column or a real per-category
  // aggregate — nothing filters on a field the data does not have.
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }));
  const resetFilters = () => setFilters(EMPTY_FILTERS);
  const [showAllFilters, setShowAllFilters] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listDiscoverableTournaments().then(async (t) => {
      if (cancelled) return;
      setTournaments(t);
      const live = t.find((x) => x.status === "LIVE");
      if (!live) { setLiveData(null); return; }
      const events = await listEvents(live.id);
      const [matches, courts] = await Promise.all([
        Promise.all(events.map((e) => listMatches(e.id))).then((r) => r.flat()),
        listCourts(live.id),
      ]);
      if (!cancelled) setLiveData({ tournament: live, matches, courts });
    });
    return () => { cancelled = true; };
  }, []);

  // Memoised so the derived rails below have a stable dependency — a fresh
  // [] each render would recompute every rail on every keystroke in search.
  const all = useMemo(() => tournaments || [], [tournaments]);
  const liveCount = all.filter((t) => t.status === "LIVE").length;
  const openCount = all.filter((t) => t.status === "REGISTRATION_OPEN").length;

  /* What the ticker carries. Live match scores when anything is on court —
     the genuinely broadcast-worthy content — otherwise the sports that are
     actually playable and the real open-entry tournaments. Never a
     fabricated headline: if there is nothing true to say, the ticker does
     not render at all. */
  const tickerItems = useMemo(() => {
    if (liveData?.matches?.length) {
      const onCourt = liveData.matches.filter((m) => m.status === "LIVE");
      if (onCourt.length) {
        return onCourt.map((m) => {
          const games = [...(m.games || [])].sort((a, b) => a.game_number - b.game_number);
          const cur = games[games.length - 1];
          return {
            live: true,
            label: m.court || "Court",
            value: cur ? `${cur.score_a}–${cur.score_b}` : null,
          };
        });
      }
    }
    const open = all.filter((t) => tournamentRegistrationState(t, t.events).canRegister);
    if (open.length) return open.slice(0, 10).map((t) => ({ label: t.name, value: null }));
    return [];
  }, [liveData, all]);

  const sportCounts = useMemo(() => {
    const c = {};
    all.forEach((t) => { const k = t.sport || "badminton"; c[k] = (c[k] || 0) + 1; });
    return c;
  }, [all]);

  /* The curated rails. Each is a straightforward derivation of real fields:
       closing soon → registration_deadline within the next 7 days, and
                      registration actually still open
       almost full  → the registration state engine already classifies this
       open now     → can register, and not in either rail above  */
  const rails = useMemo(() => {
    const open = all.filter((t) => tournamentRegistrationState(t, t.events).canRegister);

    const closingSoon = open
      .filter((t) => {
        const d = daysUntil(t.registration_deadline);
        return d != null && d >= 0 && d <= 7;
      })
      .sort((a, b) => (a.registration_deadline || "").localeCompare(b.registration_deadline || ""));

    const almostFull = open
      .filter((t) => !closingSoon.includes(t))
      .filter((t) => {
        const key = tournamentRegistrationState(t, t.events).key;
        return key === "ALMOST_FULL" || key === "WAITLIST";
      });

    const openNow = open
      .filter((t) => !closingSoon.includes(t) && !almostFull.includes(t))
      .sort((a, b) => (a.start_date || "").localeCompare(b.start_date || ""));

    return {
      // The only urgency cue on the page, and it is a real date: the
      // tournament's own registration_deadline, counted in whole days.
      closingSoon: closingSoon.slice(0, 3).map((t) => {
        const d = daysUntil(t.registration_deadline);
        return {
          ...toCardModel(t),
          note: d === 0 ? "Entries close today" : `Entries close in ${d} day${d === 1 ? "" : "s"}`,
        };
      }),
      almostFull: almostFull.slice(0, 3).map(toCardModel),
      openNow: openNow.slice(0, 3).map(toCardModel),
    };
  }, [all]);

  // Category codes carry the gender split: MS/MD are men's, WS/WD are
  // women's, XD is mixed. That is the only gender information a tournament
  // actually has, so the filter reads it from there.
  const genderOf = (code) => (code === "XD" ? "X" : code.startsWith("M") ? "M" : "W");

  const filtered = all.filter((t) => {
    if (filters.sport !== "ALL" && (t.sport || "badminton") !== filters.sport) return false;
    if (filters.status !== "ALL" && t.status !== filters.status) return false;
    if (filters.openOnly && !tournamentRegistrationState(t, t.events).canRegister) return false;
    if (filters.q) {
      const q = filters.q.toLowerCase();
      const hay = `${t.name} ${t.location || ""} ${t.venue || ""} ${t.organizer_name || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (filters.fromDate && (!t.start_date || t.start_date < filters.fromDate)) return false;
    if (filters.toDate && (!t.start_date || t.start_date > filters.toDate)) return false;
    if (filters.maxFee !== "" && t.minFee > Number(filters.maxFee)) return false;

    // The remaining filters are about the categories a tournament offers, so
    // a tournament matches when at least one of its categories satisfies all
    // of them together.
    const catFilters = ["category", "age", "gender", "grade"].some((k) => filters[k] !== "ALL");
    if (catFilters) {
      const ok = (t.events || []).some((ev) =>
        (filters.category === "ALL" || ev.category === filters.category) &&
        (filters.age === "ALL" || (ev.age_group || "OPEN") === filters.age) &&
        (filters.gender === "ALL" || genderOf(ev.category) === filters.gender) &&
        (filters.grade === "ALL" || ev.skill_grade === filters.grade)
      );
      if (!ok) return false;
    }
    return true;
  });

  const activeFilterCount = Object.entries(filters).filter(([k, v]) => {
    if (k === "sport" || k === "q") return false;
    return v !== EMPTY_FILTERS[k];
  }).length;

  return (
    <div>
      <Hero
        liveCount={liveCount}
        openCount={openCount}
        query={filters.q}
        onQuery={(v) => setFilter("q", v)}
        session={session}
      />

      <Ticker items={tickerItems} />

      {liveData && (
        <LiveStrip tournament={liveData.tournament} matches={liveData.matches} courts={liveData.courts} />
      )}

      <Rail
        eyebrow="Enter before it closes"
        title="Closing soon"
        icon={Timer}
        tone="var(--color-closing)"
        tournaments={rails.closingSoon}
      />
      <Rail
        eyebrow="Filling up"
        title="Almost full"
        icon={Flame}
        tone="var(--color-closing)"
        tournaments={rails.almostFull}
      />
      <Rail
        eyebrow="Take your pick"
        title="Open for entry"
        icon={Radio}
        tone="var(--color-open)"
        tournaments={rails.openNow}
      />

      {/* ── Full listing ─────────────────────────────────────────────── */}
      <section id="tournaments" className="md-section scroll-mt-20">
        <SectionHeader
          eyebrow="Every event"
          title="Find a tournament"
          action={
            tournaments ? (
              <span className="text-xs text-ink-3 tabular-nums">
                {filtered.length} of {all.length}
              </span>
            ) : null
          }
        />

        {tournaments && all.length > 0 && (
          <div className="mb-5 space-y-3">
            <SportChips
              value={filters.sport}
              onChange={(v) => setFilter("sport", v)}
              counts={sportCounts}
            />

            <div className="flex flex-wrap items-center gap-2">
              <select
                className={`${inputCls} sm:w-auto`}
                aria-label="Tournament status"
                value={filters.status}
                onChange={(e) => setFilter("status", e.target.value)}
              >
                <option value="ALL">Any status</option>
                <option value="LIVE">Live</option>
                <option value="REGISTRATION_OPEN">Registration open</option>
                <option value="REGISTRATION_CLOSED">Registration closed</option>
                <option value="COMPLETED">Completed</option>
              </select>

              <label className="flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-xs font-medium text-ink-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[var(--color-accent-teal)]"
                  checked={filters.openOnly}
                  onChange={(e) => setFilter("openOnly", e.target.checked)}
                />
                Spots available
              </label>

              <button
                onClick={() => setShowAllFilters((s) => !s)}
                aria-expanded={showAllFilters}
                className={cx(
                  "inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-semibold transition-colors",
                  activeFilterCount > 0
                    ? "border-accent-teal/50 bg-accent-teal/10 text-accent-teal"
                    : "border-line bg-surface text-ink-2 hover:text-ink"
                )}
              >
                <SlidersHorizontal size={13} />
                Filters
                {activeFilterCount > 0 && <span className="tabular-nums">({activeFilterCount})</span>}
              </button>

              {(activeFilterCount > 0 || filters.sport !== "ALL" || filters.q) && (
                <button
                  onClick={resetFilters}
                  className="inline-flex items-center gap-1 text-xs font-medium text-ink-3 hover:text-ink"
                >
                  <X size={12} /> Clear
                </button>
              )}
            </div>

            {showAllFilters && (
              <div className="md-card grid gap-3 p-4 sm:grid-cols-3 lg:grid-cols-4">
                <label className="block">
                  <span className="md-eyebrow mb-1.5 block">Category</span>
                  <select className={inputCls} value={filters.category} onChange={(e) => setFilter("category", e.target.value)}>
                    <option value="ALL">Any category</option>
                    {Object.entries(CATEGORY_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="md-eyebrow mb-1.5 block">Age group</span>
                  <select className={inputCls} value={filters.age} onChange={(e) => setFilter("age", e.target.value)}>
                    <option value="ALL">Any age</option>
                    {AGE_GROUPS.map((a) => <option key={a} value={a}>{a === "OPEN" ? "Open" : a}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="md-eyebrow mb-1.5 block">Gender</span>
                  <select className={inputCls} value={filters.gender} onChange={(e) => setFilter("gender", e.target.value)}>
                    <option value="ALL">Any</option>
                    <option value="M">Men&apos;s events</option>
                    <option value="W">Women&apos;s events</option>
                    <option value="X">Mixed events</option>
                  </select>
                </label>
                <label className="block">
                  <span className="md-eyebrow mb-1.5 block">Skill grade</span>
                  <select className={inputCls} value={filters.grade} onChange={(e) => setFilter("grade", e.target.value)}>
                    <option value="ALL">Any grade</option>
                    {SKILL_GRADES.map((g) => <option key={g} value={g}>Grade {g}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="md-eyebrow mb-1.5 block">Starting on or after</span>
                  <input type="date" className={inputCls} value={filters.fromDate} onChange={(e) => setFilter("fromDate", e.target.value)} />
                </label>
                <label className="block">
                  <span className="md-eyebrow mb-1.5 block">Starting on or before</span>
                  <input type="date" className={inputCls} value={filters.toDate} onChange={(e) => setFilter("toDate", e.target.value)} />
                </label>
                <label className="block">
                  <span className="md-eyebrow mb-1.5 block">Max entry fee (₹)</span>
                  <input type="number" min="0" placeholder="Any" className={inputCls}
                    value={filters.maxFee} onChange={(e) => setFilter("maxFee", e.target.value)} />
                </label>
                <div className="flex items-end sm:col-span-3 lg:col-span-4">
                  <button onClick={resetFilters} className="text-xs font-semibold text-accent-teal hover:underline">
                    Clear all filters
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {!tournaments ? (
          <CardSkeletonGrid count={6} />
        ) : all.length === 0 ? (
          <EmptyState icon={Trophy} title="Your next match starts here" hint="No tournaments published yet — check back soon." />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Search}
            title="No tournaments match those filters"
            hint="Try widening the date range, category or fee."
            action={<button onClick={resetFilters} className="mt-2 text-sm font-semibold text-accent-teal hover:underline">Clear all filters</button>}
          />
        ) : (
          <Stagger className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((t) => {
              const model = toCardModel(t);
              return (
                <StaggerChild key={t.id}>
                  <TournamentCard
                    t={model}
                    footer={
                      <span
                        className={cx(
                          "inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wide",
                          model.reg.canRegister ? "text-accent-teal"
                            : model.live ? "text-[color:var(--color-live)]"
                            : "text-ink-3"
                        )}
                      >
                        {model.reg.key === "WAITLIST" ? "Join waitlist"
                          : model.reg.canRegister ? "Enter now"
                          : model.live ? "Watch live"
                          : "View"}
                        <ArrowRight size={12} className="md-arrow" />
                      </span>
                    }
                  />
                </StaggerChild>
              );
            })}
          </Stagger>
        )}

        {/* Category chips and deadlines are detail a card should not carry —
            they live on the tournament page. The one exception kept here is
            the deadline warning, and only while it is genuinely imminent. */}
      </section>

      <EveryoneCanPlay />
      <SportCoverage />
    </div>
  );
}
