import { motion } from "motion/react";

// Reusable "MatchDay world" background layers — decorative, aria-hidden,
// transform/opacity only. Meant to be stacked inside a `relative
// overflow-hidden` section, behind real content (z-0), with content at z-10+.

// Large, very-low-opacity court line sets + an arena arc, allowed to bleed
// past its own box (the parent section's overflow-hidden clips it, which is
// what keeps the page itself from scrolling horizontally).
export function CourtGeometry({ className = "" }) {
  return (
    <svg
      viewBox="0 0 1000 600"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      className={`pointer-events-none absolute -inset-x-[10%] -inset-y-[8%] h-[120%] w-[120%] opacity-[0.07] ${className}`}
    >
      {/* arena bowl */}
      <circle cx="500" cy="300" r="480" stroke="white" strokeWidth="1" fill="none" />
      <circle cx="500" cy="300" r="360" stroke="white" strokeWidth="1" fill="none" />
      {/* badminton court */}
      <rect x="220" y="120" width="560" height="360" stroke="white" strokeWidth="1.5" fill="none" />
      <line x1="220" y1="300" x2="780" y2="300" stroke="white" strokeWidth="1.5" />
      <line x1="500" y1="120" x2="500" y2="480" stroke="white" strokeWidth="1" />
      <circle cx="500" cy="300" r="70" stroke="white" strokeWidth="1" fill="none" />
    </svg>
  );
}

const TRAJECTORIES = [
  { d: "M20 500 Q 260 120 520 300 T 980 140", color: "var(--color-accent-teal)", duration: 5 },
  { d: "M60 80 Q 340 420 620 220 T 960 420", color: "var(--color-accent-orange)", duration: 6.5 },
  { d: "M0 260 Q 300 40 560 260 T 1000 260", color: "var(--color-accent-purple)", duration: 7.5 },
];

// Slow, looping "draw the arc, fade, redraw" trajectories — abstract stand-
// ins for a shuttlecock/ball flight path, not literal sport illustrations.
export function Trajectories({ className = "" }) {
  return (
    <svg viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid slice" aria-hidden="true" className={`pointer-events-none absolute inset-0 h-full w-full opacity-30 ${className}`}>
      {TRAJECTORIES.map((t, i) => (
        <motion.path
          key={i}
          d={t.d}
          stroke={t.color}
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: [0, 1, 1], opacity: [0, 1, 0] }}
          transition={{ duration: t.duration, repeat: Infinity, repeatDelay: 1.5, delay: i * 0.8, ease: "easeInOut" }}
        />
      ))}
    </svg>
  );
}

const FLOATERS = [
  { top: "18%", left: "8%", size: 14, color: "var(--color-accent-yellow)", dur: 7 },
  { top: "65%", left: "14%", size: 10, color: "var(--color-accent-pink)", dur: 9 },
  { top: "30%", left: "88%", size: 16, color: "var(--color-accent-blue)", dur: 8 },
  { top: "75%", left: "80%", size: 11, color: "var(--color-accent-teal)", dur: 6.5 },
  { top: "10%", left: "55%", size: 9, color: "var(--color-accent-orange)", dur: 10 },
  { top: "85%", left: "45%", size: 13, color: "var(--color-accent-purple)", dur: 7.5 },
];

// A handful of soft blurred dots drifting slowly at different depths —
// abstract ball/shuttle stand-ins, never literal icons.
export function FloatingObjects({ className = "" }) {
  return (
    <div aria-hidden="true" className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}>
      {FLOATERS.map((f, i) => (
        <motion.span
          key={i}
          className="absolute rounded-full blur-[2px]"
          style={{ top: f.top, left: f.left, width: f.size, height: f.size, backgroundColor: f.color, opacity: 0.35 }}
          animate={{ y: [0, -18, 0], x: [0, 8, 0], opacity: [0.25, 0.5, 0.25] }}
          transition={{ duration: f.dur, repeat: Infinity, ease: "easeInOut", delay: i * 0.4 }}
        />
      ))}
    </div>
  );
}
