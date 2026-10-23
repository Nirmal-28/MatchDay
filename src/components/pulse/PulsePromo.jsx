import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Activity, ArrowRight } from "lucide-react";
import { cx } from "../../lib/engines";
import { probabilitySeries } from "../../lib/winProbability";
import { SIDE_COLOR } from "./colors";

// A fixed, illustrative rally sequence for the banner's sparkline — a game
// lost, then a comeback. It is decoration for a link to the live demo and is
// labelled as an example; it never claims to be a real match.
const EXAMPLE = "BBABBBABBAABBBABBABAB" + "AABABBAAABAAABAABBAAAA" + "BBAAABABBBAAAAABAAAABAA";

function examplePoints() {
  const pts = []; let game = 1, a = 0, b = 0;
  for (const s of EXAMPLE) {
    if (s === "A") a++; else b++;
    pts.push({ game, side: s, a, b });
    if ((a >= 21 || b >= 21) && Math.abs(a - b) >= 2) { game++; a = 0; b = 0; }
  }
  return pts;
}

export default function PulsePromo({ className, audience = "players" }) {
  const d = useMemo(() => {
    const s = probabilitySeries(examplePoints(), 0.5);
    return s.map((x, i) => `${(i / (s.length - 1)) * 300},${6 + (1 - x.pA) * 68}`).join(" ");
  }, []);
  const copy = audience === "organizers"
    ? "Seed by verified rating, flag sandbaggers before the draw, and put a live win chance on every court of your venue TV."
    : "A verified skill rating for every player, a live win probability on every rally, and a story card from every match.";

  return (
    <Link to="/pulse" className={cx("md-card md-card-link group relative block overflow-hidden p-5 sm:p-6", className)}>
      <div className="grid items-center gap-5 sm:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <div className="md-eyebrow flex items-center gap-1.5 text-accent-teal">
            <Activity size={13} /> New · only on MatchDay
          </div>
          <h2 className="md-display mt-1.5 text-3xl text-ink sm:text-4xl">MatchDay Pulse</h2>
          <p className="mt-1.5 max-w-xl text-sm text-ink-2">{copy}</p>
          <span className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-accent-teal">
            Try the live demo <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
        <div className="w-full sm:w-72" aria-hidden="true">
          <svg viewBox="0 0 300 80" className="h-20 w-full" preserveAspectRatio="none">
            <line x1="0" x2="300" y1="40" y2="40" stroke="var(--color-line)" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
            <polyline points={d} fill="none" stroke={SIDE_COLOR.A} strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </svg>
          <div className="mt-1 text-right text-[10px] uppercase tracking-widest text-ink-3">Example momentum line</div>
        </div>
      </div>
    </Link>
  );
}
