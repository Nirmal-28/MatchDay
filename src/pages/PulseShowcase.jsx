import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, ShieldCheck, Sparkles, Share2, Scale, Undo2, RotateCcw, Play, Pause, Trophy, Tv, Users } from "lucide-react";
import { cx } from "../lib/engines";
import { MDR, expectedScore, actualScore } from "../lib/rating";
import { matchWinProbability, rallyProbabilityFor, probabilitySeries, isBadmintonGameOver } from "../lib/winProbability";
import { matchStory } from "../lib/matchStory";
import { WinProbabilityBar, MomentumChart, MatchMoments, RatingChip } from "../components/pulse/PulseUI";
import { SIDE_COLOR } from "../components/pulse/colors";
import ShareStoryCard from "../components/pulse/ShareStoryCard";
import { MaskText, Rise } from "../components/ui/reveal";
import { useDocumentMeta } from "../lib/useDocumentMeta";

/* ═══════════════════════════════════════════════════════════════════════
   MATCHDAY PULSE — the showcase
   ═══════════════════════════════════════════════════════════════════════

   What makes MatchDay different, shown rather than told. The centrepiece is
   a live demo the visitor scores themselves: tap rallies and watch the win
   probability, the momentum chart, the match story and the rating change
   respond exactly as they do in a real tournament — same engines, same
   components. The demo is labelled as a demo everywhere it appears, and the
   players in it are fictional. */

// Rallies -> the match they produce. Taps after the match is decided are
// ignored, exactly as the real scorer refuses them.
function playOut(rallies) {
  const games = [{ a: 0, b: 0 }];
  const points = [];
  let gA = 0, gB = 0;
  for (const side of rallies) {
    if (gA === 2 || gB === 2) break;
    const g = games[games.length - 1];
    if (side === "A") g.a++; else g.b++;
    points.push({ game: games.length, side, a: g.a, b: g.b });
    if (isBadmintonGameOver(g.a, g.b)) {
      if (g.a > g.b) gA++; else gB++;
      if (gA < 2 && gB < 2) games.push({ a: 0, b: 0 });
    }
  }
  return { games, points, gA, gB, over: gA === 2 || gB === 2, used: points.length };
}

function Slider({ label, value, onChange, color }) {
  return (
    <label className="block">
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-semibold" style={{ color }}>{label}</span>
        <span className="md-score text-lg text-ink">{value}</span>
      </div>
      <input type="range" min={1200} max={2000} step={10} value={value} onChange={(e) => onChange(Number(e.target.value))}
        className="w-full" style={{ accentColor: color }} aria-label={`${label} rating`} />
    </label>
  );
}

function PulseDemo() {
  const [ratingA, setRatingA] = useState(1560);
  const [ratingB, setRatingB] = useState(1640);
  const [rallies, setRallies] = useState([]);
  // /pulse?simulate=1 starts the simulated match on load — a link that can
  // be dropped into a post and plays itself.
  const [auto, setAuto] = useState(() => {
    try { return new URLSearchParams(window.location.search).get("simulate") === "1"; } catch { return false; }
  });
  const nameA = "Arjun R.", nameB = "Kavya S.";

  const expectedA = expectedScore(ratingA, ratingB);
  const p = useMemo(() => rallyProbabilityFor(expectedA), [expectedA]);
  const m = useMemo(() => playOut(rallies), [rallies]);
  const state = { gamesA: m.gA, gamesB: m.gB, ...(m.over ? {} : { a: m.games[m.games.length - 1].a, b: m.games[m.games.length - 1].b }) };
  const live = m.over ? (m.gA === 2 ? 1 : 0) : matchWinProbability(state, p);
  const series = useMemo(() => probabilitySeries(m.points, p), [m.points, p]);
  const story = useMemo(() => matchStory(m.points, m.games, { p }), [m.points, m.games, p]);
  const winner = m.over ? (m.gA === 2 ? "A" : "B") : null;

  // What this result would do to both ratings (an established player's K).
  const deltas = useMemo(() => {
    if (!winner) return null;
    const K = MDR.kFactor(12);
    const act = actualScore(m.games, winner === "A");
    let dA = Math.round(K * (act - expectedA));
    dA = winner === "A" ? Math.max(dA, 0) : Math.min(dA, 0);
    let dB = Math.round(K * ((1 - act) - (1 - expectedA)));
    dB = winner === "B" ? Math.max(dB, 0) : Math.min(dB, 0);
    return { A: dA, B: dB };
  }, [winner, m.games, expectedA]);

  // Auto-play: rallies drawn with the per-rally edge the ratings imply. This
  // is a simulation and is labelled as one on screen.
  useEffect(() => {
    if (!auto || m.over) return;
    const t = setTimeout(() => setRallies((r) => [...r, Math.random() < p ? "A" : "B"]), 260);
    return () => clearTimeout(t);
  }, [auto, rallies, m.over, p]);
  // The simulation stops itself at match point's end; the button reads
  // "Simulate" again rather than staying stuck on "Pause".
  const autoOn = auto && !m.over;

  const tap = (side) => { if (!m.over) setRallies((r) => [...r, side]); };
  const reset = () => { setAuto(false); setRallies([]); };

  const cur = m.games[m.games.length - 1];
  const card = winner ? {
    tournament: "MatchDay Pulse demo",
    stage: "Demo final", division: "Men's & Women's · Open",
    sides: [
      { name: nameA, won: winner === "A", delta: deltas?.A, rating: ratingA },
      { name: nameB, won: winner === "B", delta: deltas?.B, rating: ratingB },
    ],
    games: m.games, series, moments: story.moments,
    url: typeof window !== "undefined" ? `${window.location.origin}/pulse` : "",
  } : null;

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      {/* Controls + scoreboard */}
      <div className="space-y-3 lg:col-span-2">
        <div className="md-card space-y-3 p-4">
          <div className="md-eyebrow flex items-center justify-between">
            <span>Set their MatchDay Ratings</span>
            <span className="normal-case tracking-normal text-ink-3">Demo players</span>
          </div>
          <Slider label={nameA} value={ratingA} onChange={setRatingA} color={SIDE_COLOR.A} />
          <Slider label={nameB} value={ratingB} onChange={setRatingB} color={SIDE_COLOR.B} />
          <div className="rounded-md bg-surface-2 px-3 py-2 text-[11px] text-ink-2">
            A {Math.abs(ratingA - ratingB)}-point gap makes {ratingA >= ratingB ? nameA : nameB} a{" "}
            <span className="font-semibold text-ink">{Math.round(Math.max(expectedA, 1 - expectedA) * 100)}%</span> favourite —
            which means winning just <span className="font-semibold text-ink">{(Math.max(p, 1 - p) * 100).toFixed(1)}%</span> of rallies.
          </div>
        </div>

        <div className="md-card md-court-texture relative overflow-hidden p-4">
          <div className="md-eyebrow mb-2 flex items-center gap-2">
            {!m.over && rallies.length > 0 && <span className="md-live-dot" />}
            {m.over ? "Final" : rallies.length ? `Game ${m.games.length} · live` : "Ready — you're the scorer"}
          </div>
          {[["A", nameA, ratingA], ["B", nameB, ratingB]].map(([side, name, r]) => {
            const score = side === "A" ? cur.a : cur.b;
            const gw = side === "A" ? m.gA : m.gB;
            return (
              <button key={side} onClick={() => tap(side)} disabled={m.over}
                className={cx(
                  "mb-2 flex w-full items-center justify-between gap-3 rounded-lg border px-4 py-3 text-left transition-[transform,background] active:scale-[0.99]",
                  winner === side ? "border-transparent" : "border-line bg-surface-2/60 hover:bg-surface-3",
                )}
                style={winner === side ? { background: `color-mix(in srgb, ${SIDE_COLOR[side]} 16%, transparent)`, borderColor: SIDE_COLOR[side] } : undefined}
                aria-label={`Point to ${name}`}
              >
                <div className="min-w-0">
                  <div className="truncate text-base font-semibold text-ink">{name}</div>
                  <div className="mt-1 flex items-center gap-2">
                    <RatingChip rating={r} delta={deltas?.[side]} />
                    <span className="text-[11px] text-ink-3">Games {gw}</span>
                  </div>
                </div>
                <div className="text-right">
                  <div key={score} className="md-bump md-score text-5xl" style={{ color: SIDE_COLOR[side] }}>{m.over ? gw : score}</div>
                  {!m.over && <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3">Tap +1</div>}
                </div>
              </button>
            );
          })}
          {m.games.length > 1 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {m.games.filter((g) => isBadmintonGameOver(g.a, g.b)).map((g, i) => (
                <span key={i} className="md-score rounded bg-surface-3 px-2 py-0.5 text-sm text-ink-2">{g.a}–{g.b}</span>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setAuto(!autoOn)} disabled={m.over}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent-teal px-3 py-2 text-xs font-bold uppercase tracking-wide text-navy-950 disabled:opacity-40">
              {autoOn ? <><Pause size={14} /> Pause</> : <><Play size={14} /> Simulate</>}
            </button>
            <button onClick={() => setRallies((r) => r.slice(0, Math.min(r.length, m.used) - 1))} disabled={!rallies.length}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs font-semibold text-ink-2 hover:text-ink disabled:opacity-40">
              <Undo2 size={14} /> Undo
            </button>
            <button onClick={reset} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs font-semibold text-ink-2 hover:text-ink">
              <RotateCcw size={14} /> Reset
            </button>
          </div>
          <p className="mt-2 text-[10px] text-ink-3">
            Simulate draws each rally at random with the edge the ratings imply. In a real tournament, every rally comes from the court scorer.
          </p>
        </div>
      </div>

      {/* What the spectators, players and venue TV see */}
      <div className="space-y-3 lg:col-span-3">
        <WinProbabilityBar nameA={nameA} nameB={nameB} pA={live} basis="ratings"
          label={m.over ? "Final" : rallies.length ? "Live win probability" : "Pre-match prediction"} />
        {series.length > 2 ? (
          <MomentumChart series={series} nameA={nameA} nameB={nameB} />
        ) : (
          <div className="md-card flex h-[15.5rem] items-center justify-center p-4 text-center text-sm text-ink-3">
            Score a few rallies — the momentum chart draws itself, one point at a time.
          </div>
        )}
        <MatchMoments moments={story.moments} nameA={nameA} nameB={nameB} />
        {card && (
          <div className="md-card flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="text-sm text-ink-2">
              <span className="font-semibold text-ink">{winner === "A" ? nameA : nameB} wins.</span>{" "}
              Ratings move {deltas.A >= 0 ? "+" : ""}{deltas.A} / {deltas.B >= 0 ? "+" : ""}{deltas.B} — and the story is ready to post.
            </div>
            <ShareStoryCard card={card} fileName="matchday-pulse-demo.png" label="Make the story card" />
          </div>
        )}
      </div>
    </div>
  );
}

const PILLARS = [
  {
    icon: ShieldCheck, title: "A verified level", color: SIDE_COLOR.A,
    body: "MatchDay Rating is replayed from officiated matches — scored rally by rally by the tournament's own staff. Nobody types their level in. Singles and doubles are rated separately, and margin counts: beating someone 21-6 says more than 22-20.",
  },
  {
    icon: Activity, title: "Live win probability", color: "var(--color-live)",
    body: "Every rally updates who is winning, as a real probability — an exact model of 21-point rally scoring, seeded by both sides' ratings. On every phone, on the venue TV, the moment the point is tapped.",
  },
  {
    icon: Sparkles, title: "Every match has a story", color: "var(--color-accent-yellow)",
    body: "The rally log finds what the scoreline hides: the 7-point run, the comeback from 9-15, the three match points saved, the win from 12%. Then it turns it into a card players actually want to post.",
  },
  {
    icon: Scale, title: "Fair Draw for organizers", color: SIDE_COLOR.B,
    body: "One tap seeds a category by verified rating. Entries rated far above the rest of a category are flagged before the draw — the sandbagging check every organizer wishes they had.",
  },
];

export default function PulseShowcase() {
  useDocumentMeta({ title: "MatchDay Pulse", description: "Verified skill ratings, live win probability and a shareable story for every amateur badminton match." });
  return (
    <div>
      <header className="md-bleed md-court-texture relative -mt-2 overflow-hidden border-b border-line bg-gradient-to-b from-navy-800 to-surface">
        <div className="relative mx-auto max-w-6xl px-4 py-12 sm:py-16">
          <div className="md-eyebrow mb-3 flex items-center gap-2 text-accent-teal"><Activity size={14} /> Only on MatchDay</div>
          <MaskText as="h1" immediate className="md-display md-h1 text-ink" lines={["Every rally counts.", "Now it shows."]} />
          <Rise delay={0.12} immediate>
            <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-ink-2">
              <span className="font-semibold text-ink">MatchDay Pulse</span> turns the score your court scorer already keeps into
              a verified skill rating for every player, a live win probability for every spectator, and a story worth sharing
              from every match. Booking apps can copy a bracket in a week. They can't copy thousands of officiated rallies.
            </p>
          </Rise>
          <Rise delay={0.2} immediate className="mt-6 flex flex-wrap gap-2.5">
            <a href="#demo" className="inline-flex h-11 items-center gap-2 rounded-lg bg-accent-teal px-6 text-sm font-bold uppercase tracking-wide text-navy-950 hover:brightness-110">
              <Play size={15} /> Try the live demo
            </a>
            <Link to="/host" className="inline-flex h-11 items-center gap-2 rounded-lg border border-line px-5 text-sm font-semibold text-ink hover:border-accent-teal">
              Host a tournament
            </Link>
            <Link to="/leaderboard" className="inline-flex h-11 items-center gap-2 rounded-lg px-4 text-sm font-semibold text-ink-2 hover:text-ink">
              <Trophy size={15} /> See the ratings
            </Link>
          </Rise>
        </div>
      </header>

      <section className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {PILLARS.map(({ icon: Icon, title, body, color }) => (
          <div key={title} className="md-card md-edge p-4 pl-5" style={{ "--md-edge": color }}>
            <Icon size={20} style={{ color }} aria-hidden="true" />
            <h2 className="md-display mt-2 text-xl text-ink">{title}</h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{body}</p>
          </div>
        ))}
      </section>

      <section id="demo" className="mt-12 scroll-mt-20">
        <div className="mb-4">
          <div className="md-eyebrow text-accent-teal">Live demo · you are the scorer</div>
          <h2 className="md-display md-h2 mt-1 text-ink">Tap a rally. Watch it move.</h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-2">
            The same engines and screens a real MatchDay tournament uses. Tap a player to give them the rally, or press Simulate.
          </p>
        </div>
        <PulseDemo />
      </section>

      <section className="mt-12 grid gap-4 lg:grid-cols-2">
        <div className="md-card p-5">
          <h2 className="md-display text-2xl text-ink">How MatchDay Rating works</h2>
          <ul className="mt-3 space-y-2.5 text-sm leading-relaxed text-ink-2">
            <li><span className="font-semibold text-ink">Everyone starts at {MDR.START}.</span> Beat a higher-rated player and you climb more; lose to a lower-rated one and you drop more.</li>
            <li><span className="font-semibold text-ink">Margin matters.</span> 75% of the signal is the result, 25% is the share of rallies you won — so a rating settles in a handful of matches, not a season.</li>
            <li><span className="font-semibold text-ink">Winning never costs you.</span> A narrow win as the favourite can't lower your rating; a brave loss can't raise it.</li>
            <li><span className="font-semibold text-ink">Provisional until {MDR.PROVISIONAL_UNTIL} matches.</span> Until then the rating is marked as settling and isn't ranked.</li>
            <li><span className="font-semibold text-ink">Only real rallies count.</span> Byes, walkovers and retirements are excluded — an injury isn't a skill signal.</li>
            <li><span className="font-semibold text-ink">It can't be typed in.</span> Every input is a match officiated on MatchDay, so the rating carries its own evidence: how many matches, against how many opponents.</li>
          </ul>
        </div>
        <div className="space-y-4">
          <div className="md-card p-5">
            <div className="flex items-center gap-2"><Tv size={18} className="text-accent-teal" /><h3 className="md-display text-xl text-ink">At the venue</h3></div>
            <p className="mt-1.5 text-sm text-ink-2">Every live court on the venue TV carries its win chance, moving with each rally — the number the whole hall argues about between points.</p>
          </div>
          <div className="md-card p-5">
            <div className="flex items-center gap-2"><Share2 size={18} className="text-accent-orange" /><h3 className="md-display text-xl text-ink">After the match</h3></div>
            <p className="mt-1.5 text-sm text-ink-2">One tap makes a Match Story card — score, momentum, the moment it turned, the rating change — sized for WhatsApp Status and Instagram. Every share links back to the match.</p>
          </div>
          <div className="md-card p-5">
            <div className="flex items-center gap-2"><Users size={18} className="text-accent-yellow" /><h3 className="md-display text-xl text-ink">For organizers</h3></div>
            <p className="mt-1.5 text-sm text-ink-2">Seed by verified rating in one tap, and see who is rated far above the rest of a category before the draw is made. Fairer draws, fewer arguments, more players coming back.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
