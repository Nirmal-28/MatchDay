import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion, useScroll, useTransform, useInView } from "motion/react";
import {
  Trophy, MapPin, Calendar, Radio, ArrowRight, Compass, Search, SlidersHorizontal, IndianRupee, Users,
} from "lucide-react";
import {
  cx, fmtDate, fmtDateRange, inr, divisionLabel, TOURNAMENT_STATUS_META,
  CATEGORY_META, AGE_GROUPS, SKILL_GRADES,
} from "../lib/engines";
import { listDiscoverableTournaments, listEvents, listMatches, listCourts } from "../lib/repository";
import { useAuth } from "../lib/AuthContext";
import { tournamentRegistrationState } from "../lib/lifecycle";
import { Badge, EmptyState, inputCls } from "../components/ui/primitives";
import { BrandLoader, Reveal, StaggerList, StaggerItem, SportIcon, LogoAssembly, LivePulse, SPORT_KEYS } from "../components/ui/motion";
import { CourtGeometry } from "../components/ui/atmosphere";
import logo from "../assets/logo.png";
import { useDocumentMeta } from "../lib/useDocumentMeta";

const JOURNEY = ["Discover", "Register", "Draw", "Schedule", "Compete", "Score", "Advance", "Win"];

// Badminton is the only sport with real data today; the rest are shown as
// genuine (dimmed) sports rather than fabricated ones, so the multi-sport
// intent is visible without implying they're usable yet.
const SPORTS = [
  { key: "badminton", name: "Badminton", angle: -90, active: true },
  { key: "tennis", name: "Tennis", angle: -38 },
  { key: "tableTennis", name: "Table Tennis", angle: 12 },
  { key: "volleyball", name: "Volleyball", angle: 64 },
  { key: "basketball", name: "Basketball", angle: 116 },
  { key: "football", name: "Football", angle: 168 },
  { key: "cricket", name: "Cricket", angle: -142 },
];

function HowItWorks() {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 0.8", "end 0.3"] });
  const fillWidth = useTransform(scrollYProgress, [0, 1], ["2%", "100%"]);

  return (
    <section ref={ref} className="my-16">
      <Reveal className="mb-10 text-center">
        <h2 className="text-2xl font-bold text-ink sm:text-3xl">How MatchDay works</h2>
        <p className="mt-1 text-sm text-ink-2">From first click to champion — one connected journey.</p>
      </Reveal>
      <div className="relative">
        <div className="absolute left-4 right-4 top-4 hidden h-0.5 bg-line sm:block" />
        <motion.div className="absolute left-4 top-4 hidden h-0.5 bg-gradient-to-r from-accent-teal via-accent-blue to-accent-purple sm:block" style={{ width: fillWidth }} />
        <div className="grid grid-cols-2 gap-y-8 sm:grid-cols-4 lg:grid-cols-8">
          {JOURNEY.map((stage, i) => (
            <Reveal key={stage} delay={i * 0.05} className="flex flex-col items-center gap-2 text-center">
              <div className="relative z-10 flex h-9 w-9 items-center justify-center rounded-full border-2 border-accent-teal bg-surface text-xs font-bold text-accent-teal">{i + 1}</div>
              <div className="text-xs font-semibold text-ink-2">{stage}</div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function LiveShowcase({ tournament, matches, courts }) {
  const live = matches.filter((m) => m.status === "LIVE");
  const completed = matches.filter((m) => m.status === "COMPLETED" || m.status === "WALKOVER");
  return (
    <Reveal className="relative my-16 overflow-hidden rounded-2xl border border-line bg-surface/70 p-6 backdrop-blur-sm sm:p-8">
      <CourtGeometry />
      <div className="relative">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-widest text-accent-teal">Tournament live</div>
            <h3 className="text-xl font-bold text-ink">{tournament.name}</h3>
          </div>
          <LivePulse />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Courts", value: courts.length },
            { label: "Matches", value: matches.length },
            { label: "Live now", value: live.length },
            { label: "Completed", value: completed.length },
          ].map((s) => (
            <div key={s.label} className="rounded-lg border border-line bg-surface-2/60 p-3 text-center">
              <div className="font-display text-3xl font-bold text-ink">{s.value}</div>
              <div className="text-[11px] uppercase tracking-wide text-ink-3">{s.label}</div>
            </div>
          ))}
        </div>
        <Link to={`/t/${tournament.slug}`} className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-accent-teal hover:underline">
          Watch it live <ArrowRight size={14} />
        </Link>
      </div>
    </Reveal>
  );
}

function NoLiveTournament() {
  return (
    <Reveal className="relative my-16 overflow-hidden rounded-2xl border border-line bg-surface p-8 text-center">
      <div className="mb-2 text-sm font-semibold uppercase tracking-widest text-accent-teal">Tournament live</div>
      <h3 className="text-xl font-bold text-ink">No tournament is live right now</h3>
      <p className="mx-auto mt-1 max-w-md text-sm text-ink-2">Browse what's upcoming, or start your own — the next live match could be yours.</p>
    </Reveal>
  );
}

function EveryoneCanPlay() {
  const figures = [0.6, 0.85, 1, 0.75, 0.9, 0.65, 0.8];
  return (
    <section className="relative my-16 overflow-hidden rounded-2xl border border-line bg-surface/70 px-6 py-16 text-center backdrop-blur-sm">
      <div className="relative mx-auto mb-6 flex h-20 items-end justify-center gap-3">
        {figures.map((scale, i) => (
          <motion.svg
            key={i}
            viewBox="0 0 24 24"
            fill="none"
            style={{ height: 56 * scale, width: 28 * scale }}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 0.5 + scale * 0.3, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: i * 0.08 }}
          >
            <circle cx="12" cy="5" r="3.2" stroke="var(--color-accent-teal)" strokeWidth="1.5" />
            <path d="M6 21c0-4 2.5-7 6-7s6 3 6 7" stroke="var(--color-accent-teal)" strokeWidth="1.5" strokeLinecap="round" />
          </motion.svg>
        ))}
      </div>
      <Reveal>
        <h2 className="text-2xl font-bold text-ink sm:text-3xl">Everyone can play.</h2>
        <p className="mx-auto mt-2 max-w-lg text-sm text-ink-2">
          No matter your age, background, or skill level — there's a place for you on the court. Different people, different sports, one competition.
        </p>
      </Reveal>
      <Reveal delay={0.15} className="mt-6 flex justify-center">
        <img src={logo} alt="MatchDay" className="h-14 w-14 rounded-xl" />
      </Reveal>
    </section>
  );
}

function SportsUniverse() {
  return (
    <section className="my-16 text-center">
      <Reveal className="mb-8">
        <h2 className="text-2xl font-bold text-ink sm:text-3xl">One platform. Every sport.</h2>
        <p className="mt-1 text-sm text-ink-2">Badminton is live today. More sports are on the way.</p>
      </Reveal>
      <Reveal className="relative mx-auto aspect-square w-full max-w-md">
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-line bg-surface shadow-lg">
            <img src={logo} alt="" className="h-14 w-14 rounded-lg" />
          </div>
        </div>
        {SPORTS.map((s) => {
          const rad = (s.angle * Math.PI) / 180;
          const x = 50 + Math.cos(rad) * 38;
          const y = 50 + Math.sin(rad) * 38;
          return (
            <div
              key={s.name}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${x}%`, top: `${y}%` }}
              title={s.active ? s.name : `${s.name} — coming soon`}
            >
              {s.active ? (
                <a href="#tournaments" className="group flex flex-col items-center gap-1.5 rounded-lg border border-accent-teal/30 bg-accent-teal/10 px-2.5 py-2 transition-all hover:border-accent-teal/60 hover:bg-accent-teal/20">
                  <SportIcon sport={s.key} className="h-6 w-6 text-accent-teal transition-transform group-hover:scale-110" />
                  <span className="text-xs font-semibold text-ink">{s.name}</span>
                </a>
              ) : (
                <div className="flex cursor-default flex-col items-center gap-1.5 px-2.5 py-2 opacity-40 transition-opacity hover:opacity-70">
                  <SportIcon sport={s.key} className="h-6 w-6 text-ink-3" />
                  <span className="text-xs font-medium text-ink-3">{s.name}</span>
                  <span className="text-[9px] uppercase tracking-wide text-ink-3">Soon</span>
                </div>
              )}
            </div>
          );
        })}
      </Reveal>
    </section>
  );
}

export default function PublicDiscovery() {
  const [tournaments, setTournaments] = useState(null);
  useDocumentMeta();
  const [liveData, setLiveData] = useState(undefined); // undefined = loading, null = none live
  const { session } = useAuth();
  // Discovery filters. Every one of these reads a real column or a real
  // per-category aggregate — nothing filters on a field the data doesn't have.
  const [filters, setFilters] = useState({
    q: "", sport: "ALL", status: "ALL", category: "ALL", age: "ALL",
    gender: "ALL", grade: "ALL", maxFee: "", fromDate: "", toDate: "", openOnly: false,
  });
  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }));
  const resetFilters = () => setFilters({
    q: "", sport: "ALL", status: "ALL", category: "ALL", age: "ALL",
    gender: "ALL", grade: "ALL", maxFee: "", fromDate: "", toDate: "", openOnly: false,
  });
  const [showAllFilters, setShowAllFilters] = useState(false);

  // Replay the hero's entrance animation every time it scrolls back into
  // view, not just on first page load — bump a key to force a remount.
  const heroRef = useRef(null);
  const heroInView = useInView(heroRef, { amount: 0.6 });
  const [heroPlay, setHeroPlay] = useState(0);
  useEffect(() => { if (heroInView) setHeroPlay((k) => k + 1); }, [heroInView]);

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

  const liveCount = tournaments?.filter((t) => t.status === "LIVE").length ?? 0;
  const openCount = tournaments?.filter((t) => t.status === "REGISTRATION_OPEN").length ?? 0;

  return (
    <div>
      {/* ── Hero ───────────────────────────────────────────────────────── */}
      {/* The app-wide <SportsBackground/> already paints the court, rally arcs
          and motes behind everything, so the hero stays transparent rather
          than stacking a second set of the same artwork on top of it. */}
      <div ref={heroRef} className="relative -mx-4 -mt-6 flex min-h-[85vh] flex-col items-center justify-center overflow-hidden px-6 py-20 text-center sm:px-10">
        <div key={heroPlay} className="relative flex flex-col items-center">
          <LogoAssembly size={140} />
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 1.3 }}
            className="wordmark mt-4 text-3xl uppercase leading-none text-white sm:text-4xl"
          >
            Matchday
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 1.45 }}
            className="mx-auto mt-5 max-w-3xl text-3xl font-bold leading-tight text-white sm:text-5xl"
          >
            Everyone can play.
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 1.55 }}
            className="mx-auto mt-3 max-w-xl text-sm text-ink-2 sm:text-base"
          >
            One platform for every match, every tournament, and every competitor.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 1.65 }}
            className="mt-7 flex flex-wrap items-center justify-center gap-3"
          >
            <Link to={session ? "/organizer" : "/signup"} className="inline-flex items-center gap-1.5 rounded-md bg-accent-teal px-5 py-2.5 text-sm font-semibold text-navy-950 hover:brightness-110">
              Create a Tournament <ArrowRight size={15} />
            </Link>
            <a href="#tournaments" className="inline-flex items-center gap-1.5 rounded-md border border-white/20 bg-white/5 px-5 py-2.5 text-sm font-semibold text-white hover:bg-white/10">
              <Compass size={15} /> Explore Tournaments
            </a>
          </motion.div>
          {tournaments && (liveCount > 0 || openCount > 0) && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 1.8 }}
              className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs font-medium uppercase tracking-wide text-ink-3"
            >
              {liveCount > 0 && <span className="flex items-center gap-1.5 text-white"><LivePulse label={`${liveCount} live now`} /></span>}
              {openCount > 0 && <span>{openCount} open for registration</span>}
            </motion.div>
          )}
        </div>
      </div>

      <HowItWorks />

      {liveData ? <LiveShowcase tournament={liveData.tournament} matches={liveData.matches} courts={liveData.courts} /> : liveData === null ? <NoLiveTournament /> : null}

      <EveryoneCanPlay />
      <SportsUniverse />

      {/* ── Tournament listing ────────────────────────────────────────── */}
      <div id="tournaments" className="mb-5 scroll-mt-20">
        <h2 className="text-lg font-bold text-ink">Find a tournament</h2>
        <p className="mt-0.5 text-sm text-ink-2">Browse live and upcoming tournaments — no account needed to follow along.</p>
      </div>

      {tournaments && tournaments.length > 0 && (
        <div className="mb-4 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[180px] flex-1">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
              <input className={`${inputCls} pl-8`} placeholder="Search by name, venue or city"
                value={filters.q} onChange={(e) => setFilter("q", e.target.value)} />
            </div>
            <select className={`${inputCls} w-auto`} value={filters.sport} onChange={(e) => setFilter("sport", e.target.value)}>
              <option value="ALL">All sports</option>
              {SPORT_KEYS.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
            </select>
            <select className={`${inputCls} w-auto`} value={filters.status} onChange={(e) => setFilter("status", e.target.value)}>
              <option value="ALL">Any status</option>
              <option value="LIVE">Live</option>
              <option value="REGISTRATION_OPEN">Registration open</option>
              <option value="REGISTRATION_CLOSED">Registration closed</option>
              <option value="COMPLETED">Completed</option>
            </select>
            <button onClick={() => setShowAllFilters((s) => !s)}
              className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-3 py-2 text-xs font-medium text-ink-2 hover:text-ink">
              <SlidersHorizontal size={13} /> {showAllFilters ? "Fewer filters" : "More filters"}
            </button>
          </div>

          {showAllFilters && (
            <div className="grid gap-2 rounded-lg border border-line bg-surface p-3 sm:grid-cols-3 lg:grid-cols-4">
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-ink-2">Category</span>
                <select className={inputCls} value={filters.category} onChange={(e) => setFilter("category", e.target.value)}>
                  <option value="ALL">Any category</option>
                  {Object.entries(CATEGORY_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-ink-2">Age group</span>
                <select className={inputCls} value={filters.age} onChange={(e) => setFilter("age", e.target.value)}>
                  <option value="ALL">Any age</option>
                  {AGE_GROUPS.map((a) => <option key={a} value={a}>{a === "OPEN" ? "Open" : a}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-ink-2">Gender</span>
                <select className={inputCls} value={filters.gender} onChange={(e) => setFilter("gender", e.target.value)}>
                  <option value="ALL">Any</option>
                  <option value="M">Men&apos;s events</option>
                  <option value="W">Women&apos;s events</option>
                  <option value="X">Mixed events</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-ink-2">Skill grade</span>
                <select className={inputCls} value={filters.grade} onChange={(e) => setFilter("grade", e.target.value)}>
                  <option value="ALL">Any grade</option>
                  {SKILL_GRADES.map((g) => <option key={g} value={g}>Grade {g}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-ink-2">Starting on or after</span>
                <input type="date" className={inputCls} value={filters.fromDate} onChange={(e) => setFilter("fromDate", e.target.value)} />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-ink-2">Starting on or before</span>
                <input type="date" className={inputCls} value={filters.toDate} onChange={(e) => setFilter("toDate", e.target.value)} />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-ink-2">Max entry fee (₹)</span>
                <input type="number" min="0" placeholder="Any" className={inputCls}
                  value={filters.maxFee} onChange={(e) => setFilter("maxFee", e.target.value)} />
              </label>
              <label className="flex items-end gap-2 pb-2">
                <input type="checkbox" className="h-4 w-4 accent-[var(--color-accent-teal)]"
                  checked={filters.openOnly} onChange={(e) => setFilter("openOnly", e.target.checked)} />
                <span className="text-xs text-ink-2">Only with spots available</span>
              </label>
              <div className="flex items-end sm:col-span-3 lg:col-span-4">
                <button onClick={resetFilters} className="text-xs font-medium text-accent-teal hover:underline">Clear all filters</button>
              </div>
            </div>
          )}
        </div>
      )}

      {(() => {
        // Category codes carry the gender split: MS/MD are men's, WS/WD are
        // women's, XD is mixed. That is the only gender information a
        // tournament actually has, so the filter reads it from there.
        const genderOf = (code) => (code === "XD" ? "X" : code.startsWith("M") ? "M" : "W");

        const filtered = (tournaments || []).filter((t) => {
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

          // The remaining filters are about the categories a tournament
          // offers, so a tournament matches when at least one of its
          // categories satisfies all of them together.
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

        if (!tournaments) return <BrandLoader />;
        if (tournaments.length === 0) return <EmptyState icon={Trophy} title="Your next match starts here" hint="No tournaments published yet — check back soon." />;
        if (filtered.length === 0) return <EmptyState icon={Search} title="No tournaments match those filters" hint="Try widening the date range, category or fee." action={<button onClick={resetFilters} className="mt-2 text-sm font-medium text-accent-teal hover:underline">Clear all filters</button>} />;

        return (
        <>
          <div className="mb-2 text-xs text-ink-3">
            {filtered.length} of {tournaments.length} tournament{tournaments.length === 1 ? "" : "s"}
          </div>
          <StaggerList className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((t) => {
              const deadlinePassed = t.registration_deadline && t.registration_deadline < new Date().toISOString().slice(0, 10);
              // Best availability across this tournament's categories, using
              // the same rules the registration form and RLS apply.
              const reg = tournamentRegistrationState(t, t.events);
              return (
                <StaggerItem key={t.id}>
                  <Link to={`/t/${t.slug}`} className="flex h-full flex-col rounded-lg border border-line bg-surface p-4 text-left shadow-sm transition-all hover:border-accent-teal/50 hover:shadow-md">
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div className="flex items-center gap-1.5 font-semibold text-ink">
                        <SportIcon sport={t.sport} className="h-4 w-4 shrink-0 text-accent-teal" />
                        {t.name}
                      </div>
                      <Badge tone={TOURNAMENT_STATUS_META[t.status].tone}>{t.status === "LIVE" ? <><Radio size={10} className="animate-pulse" /> Live</> : TOURNAMENT_STATUS_META[t.status].label}</Badge>
                    </div>

                    {t.description && <p className="mb-2 line-clamp-2 text-xs text-ink-2">{t.description}</p>}

                    <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-2">
                      <span className="flex items-center gap-1"><MapPin size={11} />{t.location || t.venue}</span>
                      <span className="flex items-center gap-1"><Calendar size={11} />{fmtDateRange(t.start_date, t.end_date)}</span>
                    </div>

                    {/* Categories offered */}
                    {t.events.length > 0 && (
                      <div className="mb-2 flex flex-wrap gap-1">
                        {t.events.slice(0, 4).map((ev) => (
                          <span key={ev.id} className="rounded border border-line bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-ink-2">
                            {divisionLabel(ev)}
                          </span>
                        ))}
                        {t.events.length > 4 && (
                          <span className="rounded border border-line bg-surface-2 px-1.5 py-0.5 text-[10px] text-ink-3">
                            +{t.events.length - 4} more
                          </span>
                        )}
                      </div>
                    )}

                    <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-line-soft pt-2 text-xs">
                      <span className="flex items-center gap-1 font-medium text-ink">
                        <IndianRupee size={11} />
                        {t.maxFee === 0 ? "Free entry" : t.minFee === t.maxFee ? inr(t.minFee) : `${inr(t.minFee)}–${inr(t.maxFee)}`}
                      </span>
                      <span className={cx("flex items-center gap-1",
                        reg.key === "OPEN" ? "text-accent-teal"
                          : reg.key === "ALMOST_FULL" || reg.key === "WAITLIST" ? "text-amber-300" : "text-ink-3")}>
                        <Users size={11} />
                        {reg.key === "OPEN" || reg.key === "ALMOST_FULL"
                          ? `${t.spotsLeft} spot${t.spotsLeft === 1 ? "" : "s"} left`
                          : reg.key === "WAITLIST" ? "Waitlist only"
                          : reg.label}
                      </span>
                    </div>

                    {reg.canRegister && t.registration_deadline && (
                      <div className={cx("mt-1 text-[11px]", deadlinePassed ? "text-red-300" : "text-ink-3")}>
                        {deadlinePassed ? "Deadline passed" : `Register by ${fmtDate(t.registration_deadline)}`}
                      </div>
                    )}

                    {/* Every card ends in an unambiguous action. */}
                    <div className={cx(
                      "mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold",
                      reg.canRegister ? "bg-accent-teal text-navy-950"
                        : t.status === "LIVE" ? "border border-red-400/40 bg-red-400/10 text-red-300"
                        : "border border-line bg-surface-2 text-ink-2"
                    )}>
                      {reg.key === "WAITLIST" ? "Join the waitlist"
                        : reg.canRegister ? "Register now"
                        : t.status === "LIVE" ? <><Radio size={11} className="animate-pulse" /> Watch live</>
                        : "View tournament"}
                      <ArrowRight size={12} />
                    </div>
                  </Link>
                </StaggerItem>
              );
            })}
          </StaggerList>
        </>
        );
      })()}
    </div>
  );
}
