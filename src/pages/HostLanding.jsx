import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight, Check, Circle, Radio, Users, CalendarClock, Trophy,
  Smartphone, Tv, ShieldCheck, IndianRupee, BarChart3, Gavel, Layers, Info,
} from "lucide-react";
import { listDiscoverableTournaments } from "../lib/repository";
import { useAuth } from "../lib/AuthContext";
import { useDocumentMeta } from "../lib/useDocumentMeta";
import { Btn, Card, Eyebrow, Badge } from "../components/ui/primitives";
import { Reveal, StaggerList, StaggerItem } from "../components/ui/motion";
import { cx } from "../lib/engines";

/* Why this page exists.
 *
 * Everything MatchDay could do was only discoverable by already being inside
 * it. Someone deciding whether to run their club's tournament here landed on
 * a list of other people's tournaments, with nothing saying what the product
 * is or why they would use it. This is that missing page.
 *
 * Two rules it follows, deliberately:
 *
 * 1. No invented social proof. There are no testimonials, no "trusted by
 *    thousands", no made-up numbers. The only figures shown are read live
 *    from the database, and they are hidden entirely when they are zero —
 *    an empty product should not claim traction it does not have.
 *
 * 2. It states what is NOT ready. The capability table below marks payments
 *    and messaging as needing setup rather than implying they work. A page
 *    that oversells gets one organizer through signup and loses them on
 *    tournament day.
 */

// The lifecycle here is not a marketing invention — these are the real stages
// in src/lib/lifecycle.js, which the database enforces with triggers.
const STAGES = [
  {
    key: "setup", label: "Set up", icon: Layers,
    title: "Build the event, not a spreadsheet",
    body: "Name it, add your categories — singles, doubles, age and grade bands — and set entry fees per category. The wizard takes a few minutes.",
  },
  {
    key: "register", label: "Registration", icon: Users,
    title: "Entries arrive on their own",
    body: "Share one link. Players register themselves, and the window opens and closes on the dates you set — nobody has to remember to shut it off. Entry caps are enforced in the database, so two people cannot take the last slot at once.",
  },
  {
    key: "draw", label: "Draw", icon: Trophy,
    title: "Seed once, bracket generated",
    body: "Knockout, round robin, or groups into a knockout. Seeding is yours to set; the bracket, byes and progression are worked out for you. Once a match is played the draw locks, so it cannot be regenerated out from under a result.",
  },
  {
    key: "schedule", label: "Schedule", icon: CalendarClock,
    title: "Courts and times without the clashes",
    body: "Assign matches to courts and slots on a grid. Clashes — a player in two places, a court double-booked, not enough rest between matches — are flagged as you go rather than discovered on the day.",
  },
  {
    key: "live", label: "Match day", icon: Radio,
    title: "Score from the net post",
    body: "A separate scorer view built for one thumb in bright sun. Scores go live to every phone watching and to the venue screen the moment they are tapped.",
  },
  {
    key: "results", label: "Results", icon: BarChart3,
    title: "Results, exports and rankings",
    body: "Final brackets stay public. Export entries, schedules and results as CSV. Completed matches feed player profiles and ranking points automatically.",
  },
];

const AUDIENCES = [
  {
    key: "organizer", label: "For you", icon: Trophy,
    points: [
      "One command centre per tournament — entries, draws, courts, money, staff",
      "Add referees and scorers with their own limited access, not your password",
      "Check players in with a QR code at the desk",
      "Import an existing entry list from CSV instead of retyping it",
      "Your logo, colours and sponsors on the public page and venue screen",
    ],
  },
  {
    key: "player", label: "For players", icon: Smartphone,
    points: [
      "One account plays, organizes and officiates — never a second signup",
      "Their matches, court and time on their phone, updating live",
      "Profile with real history, head-to-head rivals and ranking points",
      "Results follow them across every tournament you run",
    ],
  },
  {
    key: "spectator", label: "For the hall", icon: Tv,
    points: [
      "A no-login venue display for a TV or projector, readable across a hall",
      "Live scores, what is coming up next, and recent results on rotation",
      "A public page anyone can open from a shared link — no app to install",
    ],
  },
];

// The honest column. Anything that needs an account or a key you do not have
// yet is listed as such rather than quietly implied to work.
const CAPABILITIES = [
  { name: "Registration, draws, scheduling, live scoring", status: "ready" },
  { name: "Public tournament page, venue display, exports", status: "ready" },
  { name: "Staff roles, check-in, disputes, audit log", status: "ready" },
  { name: "Player profiles, rankings, multi-event series", status: "ready" },
  { name: "In-app notifications", status: "ready" },
  { name: "Online payments (Razorpay)", status: "setup", note: "Built and ready to connect — needs your Razorpay account before real money moves." },
  { name: "Email and SMS alerts", status: "setup", note: "Delivery is built; needs a provider account and its key." },
];

function StageRail({ active, onSelect }) {
  return (
    // A rail rather than a row of identical cards: a tournament is a sequence,
    // and showing it as one makes the order the point instead of decoration.
    <div className="relative">
      <div className="absolute left-[15px] top-3 bottom-3 w-px bg-line sm:hidden" />
      <div className="hidden sm:absolute sm:left-0 sm:right-0 sm:top-[15px] sm:block sm:h-px sm:bg-line" />
      <div className="relative flex flex-col gap-1 sm:flex-row sm:justify-between">
        {STAGES.map((s, i) => {
          const on = active === i;
          return (
            <button
              key={s.key}
              onClick={() => onSelect(i)}
              aria-current={on ? "step" : undefined}
              className="group flex items-center gap-3 py-1.5 text-left sm:flex-col sm:gap-2 sm:py-0 sm:text-center"
            >
              <span className={cx(
                "relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 transition-colors",
                on ? "border-accent-teal bg-accent-teal text-navy-950" : "border-line bg-canvas text-ink-3 group-hover:border-accent-teal/60"
              )}>
                <s.icon size={15} />
              </span>
              <span className={cx(
                "text-xs font-medium transition-colors sm:max-w-[8rem]",
                on ? "text-ink" : "text-ink-3 group-hover:text-ink-2"
              )}>
                {s.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// A miniature of the real thing, built from the same tokens as the app. It is
// illustrative rather than a screenshot, and says so — a fake screenshot of
// numbers that never happened is exactly the kind of thing this project does
// not do.
function ScoreboardPreview() {
  const [a, setA] = useState(18);
  const [b, setB] = useState(16);

  useEffect(() => {
    const t = setInterval(() => {
      setA((x) => (x >= 21 ? 12 : x + (Math.random() > 0.45 ? 1 : 0)));
      setB((x) => (x >= 21 ? 11 : x + (Math.random() > 0.55 ? 1 : 0)));
    }, 1800);
    return () => clearInterval(t);
  }, []);

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-red-300">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-500" style={{ animation: "pulse 1.6s ease-in-out infinite" }} />
          Live
        </span>
        <span className="text-[11px] text-ink-3">Court 3 · Semi-final</span>
      </div>
      <div className="space-y-2 p-4">
        {[["Meera / Anjali", a], ["Divya / Sneha", b]].map(([name, score]) => {
          const leading = (name.startsWith("Meera") ? a : b) === Math.max(a, b) && a !== b;
          return (
            <div key={name} className="flex items-center justify-between gap-3">
              <span className={cx("truncate text-sm", leading ? "font-semibold text-ink" : "text-ink-2")}>{name}</span>
              <span className={cx(
                "min-w-[2.25rem] rounded px-2 py-0.5 text-center font-mono text-lg font-bold tabular-nums",
                leading ? "bg-accent-teal text-navy-950" : "text-ink-2"
              )}>
                {score}
              </span>
            </div>
          );
        })}
      </div>
      <div className="border-t border-line px-4 py-2 text-[11px] text-ink-3">
        Illustrative preview — not a real match.
      </div>
    </Card>
  );
}

export default function HostLanding() {
  const { session } = useAuth();
  const [stage, setStage] = useState(0);
  const [counts, setCounts] = useState(null);

  useDocumentMeta({
    title: "Run your tournament",
    description:
      "Registration, draws, court scheduling, live scoring and results for racket tournaments. Share one link, score from the net post, and let the bracket look after itself.",
  });

  useEffect(() => {
    // Real numbers or none. If nothing is published yet, the strip is hidden
    // rather than padded out with a figure that means nothing.
    listDiscoverableTournaments()
      .then((list) => setCounts({
        total: list.length,
        live: list.filter((t) => t.status === "LIVE").length,
        open: list.filter((t) => t.status === "REGISTRATION_OPEN").length,
      }))
      .catch(() => setCounts(null));
  }, []);

  const active = STAGES[stage];

  return (
    <div className="pb-6">
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <Reveal className="grid items-center gap-8 py-10 lg:grid-cols-[1.15fr_1fr] lg:py-14">
        <div>
          <Eyebrow>Run a tournament</Eyebrow>
          <h1 className="mt-2 text-3xl font-bold leading-tight text-ink sm:text-4xl">
            Everything after{" "}
            <span className="text-accent-teal">&ldquo;we should run a tournament&rdquo;</span>
          </h1>
          <p className="mt-3 max-w-xl text-base leading-relaxed text-ink-2">
            Entries, seeding, brackets, court scheduling, live scores and results — in one place,
            for badminton clubs and academies. Share one link and the draw looks after itself.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-2.5">
            <Link to={session ? "/organizer" : "/signup"}>
              <Btn size="lg" icon={ArrowRight}>
                {session ? "Go to your tournaments" : "Create your tournament"}
              </Btn>
            </Link>
            <Link to="/">
              <Btn size="lg" variant="secondary">See a live tournament</Btn>
            </Link>
          </div>

          <p className="mt-3 text-xs text-ink-3">
            Free to set up. No card needed — the same account you play on becomes your organizer account.
          </p>

          {/* Live figures only, and only when there are any. */}
          {counts && counts.total > 0 && (
            <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 border-t border-line pt-4 text-sm">
              <span className="text-ink-2">
                <span className="font-semibold text-ink">{counts.total}</span> tournament{counts.total === 1 ? "" : "s"} on MatchDay
              </span>
              {counts.live > 0 && (
                <span className="text-ink-2"><span className="font-semibold text-ink">{counts.live}</span> live now</span>
              )}
              {counts.open > 0 && (
                <span className="text-ink-2"><span className="font-semibold text-ink">{counts.open}</span> taking entries</span>
              )}
            </div>
          )}
        </div>

        <div className="lg:pl-4">
          <ScoreboardPreview />
        </div>
      </Reveal>

      {/* ── The lifecycle, as an interactive rail ─────────────────────── */}
      <Reveal className="border-t border-line py-10">
        <div className="mb-6 max-w-2xl">
          <Eyebrow>From idea to final</Eyebrow>
          <h2 className="mt-1.5 text-2xl font-bold text-ink">Six stages, and the app knows which one you are in</h2>
          <p className="mt-1.5 text-sm text-ink-2">
            These are not marketing steps — they are the actual stages MatchDay tracks, and it will
            not let you skip one by accident. You cannot open a draw before entries close, or rewrite
            a finished result without going through a dispute.
          </p>
        </div>

        <StageRail active={stage} onSelect={setStage} />

        <Card className="mt-6 p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-accent-teal/10 text-accent-teal">
              <active.icon size={18} />
            </span>
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-ink">{active.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-ink-2">{active.body}</p>
            </div>
          </div>
        </Card>
      </Reveal>

      {/* ── Who it serves ────────────────────────────────────────────── */}
      <Reveal className="border-t border-line py-10">
        <div className="mb-6 max-w-2xl">
          <Eyebrow>One tournament, three audiences</Eyebrow>
          <h2 className="mt-1.5 text-2xl font-bold text-ink">
            You are not the only person who has to use it
          </h2>
          <p className="mt-1.5 text-sm text-ink-2">
            Most of a tournament&apos;s reputation is made by how it feels to the people who did not
            organize it — the player looking for their court, and the parent watching from the side.
          </p>
        </div>

        <StaggerList className="grid gap-3 md:grid-cols-3">
          {AUDIENCES.map((a) => (
            <StaggerItem key={a.key}>
              <Card className="h-full p-5">
                <span className="inline-grid h-9 w-9 place-items-center rounded-md bg-surface-2 text-accent-teal">
                  <a.icon size={17} />
                </span>
                <h3 className="mt-3 text-sm font-semibold uppercase tracking-wide text-ink">{a.label}</h3>
                <ul className="mt-2.5 space-y-2">
                  {a.points.map((p) => (
                    <li key={p} className="flex gap-2 text-sm leading-snug text-ink-2">
                      <Check size={14} className="mt-0.5 shrink-0 text-accent-teal" />
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </StaggerItem>
          ))}
        </StaggerList>
      </Reveal>

      {/* ── The honest table ─────────────────────────────────────────── */}
      <Reveal className="border-t border-line py-10">
        <div className="mb-5 max-w-2xl">
          <Eyebrow>Straight answers</Eyebrow>
          <h2 className="mt-1.5 text-2xl font-bold text-ink">What works today, and what needs setting up</h2>
          <p className="mt-1.5 text-sm text-ink-2">
            Nothing here is a coming-soon promise dressed as a feature. If a thing needs an account
            you do not have yet, it says so — you should find that out now, not on tournament day.
          </p>
        </div>

        <Card className="divide-y divide-line">
          {CAPABILITIES.map((c) => (
            <div key={c.name} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-3">
              {c.status === "ready"
                ? <Check size={15} className="mt-0.5 shrink-0 text-emerald-400" />
                : <Circle size={15} className="mt-0.5 shrink-0 text-amber-400" />}
              <span className="min-w-0 flex-1 text-sm text-ink">{c.name}</span>
              <Badge tone={c.status === "ready" ? "emerald" : "amber"}>
                {c.status === "ready" ? "Works now" : "Needs setup"}
              </Badge>
              {c.note && <p className="w-full pl-[26px] text-[11px] text-ink-3">{c.note}</p>}
            </div>
          ))}
        </Card>

        <p className="mt-3 flex items-start gap-1.5 text-[11px] text-ink-3">
          <Info size={12} className="mt-0.5 shrink-0" />
          Until payments are connected, you can still run a paid tournament — mark entries as paid
          yourself as the money arrives, exactly as you would from a register.
        </p>
      </Reveal>

      {/* ── Trust ────────────────────────────────────────────────────── */}
      <Reveal className="border-t border-line py-10">
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { icon: ShieldCheck, title: "Entries are private by default", body: "Phone numbers and emails are never readable from a public page. Only you and the staff you appoint can see them." },
            { icon: Gavel, title: "Results cannot be quietly rewritten", body: "Once a match is complete, changing it is a recorded correction, not an edit. Every action is in the audit log." },
            { icon: IndianRupee, title: "Free while you set up", body: "Building a tournament, opening registration and running the draw cost nothing. There is no trial clock." },
          ].map((t) => (
            <Card key={t.title} className="p-4">
              <t.icon size={17} className="text-accent-teal" />
              <h3 className="mt-2 text-sm font-semibold text-ink">{t.title}</h3>
              <p className="mt-1 text-[13px] leading-snug text-ink-2">{t.body}</p>
            </Card>
          ))}
        </div>
      </Reveal>

      {/* ── Close ────────────────────────────────────────────────────── */}
      <Reveal className="border-t border-line py-12 text-center">
        <h2 className="text-2xl font-bold text-ink">Your next tournament could run itself</h2>
        <p className="mx-auto mt-2 max-w-lg text-sm text-ink-2">
          Set it up now, share the link when you are ready. Nothing is public until you publish it.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2.5">
          <Link to={session ? "/organizer" : "/signup"}>
            <Btn size="lg" icon={ArrowRight}>
              {session ? "Go to your tournaments" : "Create your tournament"}
            </Btn>
          </Link>
          {!session && (
            <Link to="/login"><Btn size="lg" variant="secondary">I already have an account</Btn></Link>
          )}
        </div>
      </Reveal>
    </div>
  );
}
