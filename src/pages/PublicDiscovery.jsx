import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion, useScroll, useTransform, useInView } from "motion/react";
import { Trophy, MapPin, Calendar, Radio, ArrowRight, Compass } from "lucide-react";
import { fmtDateRange, TOURNAMENT_STATUS_META } from "../lib/engines";
import { listPublishedTournaments, listEvents, listMatches, listCourts } from "../lib/repository";
import { useAuth } from "../lib/AuthContext";
import { Badge, EmptyState } from "../components/ui/primitives";
import { BrandLoader, Reveal, StaggerList, StaggerItem, SportIcon, LogoAssembly, LivePulse } from "../components/ui/motion";
import { CourtGeometry, Trajectories, FloatingObjects } from "../components/ui/atmosphere";
import logo from "../assets/logo.png";

const JOURNEY = ["Discover", "Register", "Draw", "Schedule", "Compete", "Score", "Advance", "Win"];

const SPORTS = [
  { name: "Badminton", angle: -90, active: true },
  { name: "Tennis", angle: -38 },
  { name: "Table Tennis", angle: 12 },
  { name: "Volleyball", angle: 64 },
  { name: "Basketball", angle: 116 },
  { name: "Football", angle: 168 },
  { name: "Cricket", angle: -142 },
];

function HowItWorks() {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 0.8", "end 0.3"] });
  const fillWidth = useTransform(scrollYProgress, [0, 1], ["2%", "100%"]);

  return (
    <section ref={ref} className="my-16">
      <Reveal className="mb-10 text-center">
        <h2 className="text-2xl font-bold text-stone-900 sm:text-3xl">How MatchDay works</h2>
        <p className="mt-1 text-sm text-stone-500">From first click to champion — one connected journey.</p>
      </Reveal>
      <div className="relative">
        <div className="absolute left-4 right-4 top-4 hidden h-0.5 bg-stone-200 sm:block" />
        <motion.div className="absolute left-4 top-4 hidden h-0.5 bg-gradient-to-r from-accent-teal via-accent-blue to-accent-purple sm:block" style={{ width: fillWidth }} />
        <div className="grid grid-cols-2 gap-y-8 sm:grid-cols-4 lg:grid-cols-8">
          {JOURNEY.map((stage, i) => (
            <Reveal key={stage} delay={i * 0.05} className="flex flex-col items-center gap-2 text-center">
              <div className="relative z-10 flex h-9 w-9 items-center justify-center rounded-full border-2 border-accent-teal bg-white text-xs font-bold text-teal-800">{i + 1}</div>
              <div className="text-xs font-semibold text-stone-700">{stage}</div>
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
    <Reveal className="relative my-16 overflow-hidden rounded-2xl bg-navy-900 p-6 sm:p-8">
      <CourtGeometry />
      <div className="relative">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-widest text-accent-teal">Tournament live</div>
            <h3 className="text-xl font-bold text-white">{tournament.name}</h3>
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
            <div key={s.label} className="rounded-lg border border-white/10 bg-white/5 p-3 text-center">
              <div className="font-display text-3xl font-bold text-white">{s.value}</div>
              <div className="text-[11px] uppercase tracking-wide text-stone-400">{s.label}</div>
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
    <Reveal className="relative my-16 overflow-hidden rounded-2xl border border-stone-200 bg-white p-8 text-center">
      <div className="mb-2 text-sm font-semibold uppercase tracking-widest text-accent-teal">Tournament live</div>
      <h3 className="text-xl font-bold text-stone-900">No tournament is live right now</h3>
      <p className="mx-auto mt-1 max-w-md text-sm text-stone-500">Browse what's upcoming, or start your own — the next live match could be yours.</p>
    </Reveal>
  );
}

function EveryoneCanPlay() {
  const figures = [0.6, 0.85, 1, 0.75, 0.9, 0.65, 0.8];
  return (
    <section className="relative my-16 overflow-hidden rounded-2xl bg-navy-950 px-6 py-16 text-center">
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
        <h2 className="text-2xl font-bold text-white sm:text-3xl">Everyone can play.</h2>
        <p className="mx-auto mt-2 max-w-lg text-sm text-stone-400">
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
        <h2 className="text-2xl font-bold text-stone-900 sm:text-3xl">One platform. Every sport.</h2>
        <p className="mt-1 text-sm text-stone-500">Badminton is live today. More sports are on the way.</p>
      </Reveal>
      <Reveal className="relative mx-auto aspect-square w-full max-w-md">
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-navy-900 shadow-lg">
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
                <a href="#tournaments" className="flex flex-col items-center gap-1.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-teal-50">
                  <SportIcon className="h-6 w-6 text-accent-teal" />
                  <span className="text-xs font-semibold text-stone-800">{s.name}</span>
                </a>
              ) : (
                <div className="flex cursor-default flex-col items-center gap-1.5 px-2 py-1.5 opacity-35">
                  <span className="h-6 w-6 rounded-full border-2 border-dashed border-stone-400" />
                  <span className="text-xs font-medium text-stone-500">{s.name}</span>
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
  const [liveData, setLiveData] = useState(undefined); // undefined = loading, null = none live
  const { session } = useAuth();

  // Replay the hero's entrance animation every time it scrolls back into
  // view, not just on first page load — bump a key to force a remount.
  const heroRef = useRef(null);
  const heroInView = useInView(heroRef, { amount: 0.6 });
  const [heroPlay, setHeroPlay] = useState(0);
  useEffect(() => { if (heroInView) setHeroPlay((k) => k + 1); }, [heroInView]);

  useEffect(() => {
    let cancelled = false;
    listPublishedTournaments().then(async (t) => {
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
      <div ref={heroRef} className="relative -mx-4 -mt-6 flex min-h-[85vh] flex-col items-center justify-center overflow-hidden bg-navy-900 px-6 py-20 text-center sm:px-10">
        <div className="absolute inset-0 bg-gradient-to-b from-navy-900 via-navy-900 to-navy-950" />
        <CourtGeometry />
        <Trajectories />
        <FloatingObjects />
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
            className="mx-auto mt-3 max-w-xl text-sm text-stone-300 sm:text-base"
          >
            One platform for every match, every tournament, and every competitor.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 1.65 }}
            className="mt-7 flex flex-wrap items-center justify-center gap-3"
          >
            <Link to={session ? "/organizer" : "/signup"} className="inline-flex items-center gap-1.5 rounded-md bg-accent-teal px-5 py-2.5 text-sm font-semibold text-white hover:brightness-110">
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
              className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs font-medium uppercase tracking-wide text-stone-400"
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
        <h2 className="text-lg font-bold text-stone-900">Find a tournament</h2>
        <p className="mt-0.5 text-sm text-stone-500">Browse live and upcoming tournaments — no account needed to follow along.</p>
      </div>

      {!tournaments ? (
        <BrandLoader />
      ) : tournaments.length === 0 ? (
        <EmptyState icon={Trophy} title="Your next match starts here" hint="No tournaments published yet — check back soon." />
      ) : (
        <StaggerList className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tournaments.map((t) => (
            <StaggerItem key={t.id}>
              <Link to={`/t/${t.slug}`} className="block rounded-lg border border-stone-200 bg-white p-4 text-left shadow-sm transition-all hover:border-teal-300 hover:shadow-md">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="flex items-center gap-1.5 font-semibold text-stone-900">
                    <SportIcon className="h-4 w-4 shrink-0 text-accent-teal" />
                    {t.name}
                  </div>
                  <Badge tone={TOURNAMENT_STATUS_META[t.status].tone}>{t.status === "LIVE" ? <><Radio size={10} className="animate-pulse" /> Live</> : TOURNAMENT_STATUS_META[t.status].label}</Badge>
                </div>
                <p className="mb-2 truncate text-xs text-stone-500">{t.description}</p>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-stone-500">
                  <span className="flex items-center gap-1"><MapPin size={11} />{t.location || t.venue}</span>
                  <span className="flex items-center gap-1"><Calendar size={11} />{fmtDateRange(t.start_date, t.end_date)}</span>
                </div>
              </Link>
            </StaggerItem>
          ))}
        </StaggerList>
      )}
    </div>
  );
}
