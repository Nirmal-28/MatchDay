import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

/* Fixed, app-wide sports environment: a playing surface rendered in
   perspective, with ball/shuttle flight paths arcing across it and slow
   drifting motes.

   MULTI-SPORT BY DESIGN. MatchDay runs badminton today but is meant to cover
   every sport, so the court geometry and the flight-path shapes are data, not
   markup — adding tennis or basketball is a new entry in SPORTS below, not a
   rewrite of this component. Each sport also gets its own trajectory profile,
   because a shuttle's steep drop and a basketball's parabola should not move
   the same way.

   Decorative only: aria-hidden, pointer-events-none, sits behind all content,
   and animates transform/opacity/strokeDashoffset so it stays on the
   compositor. */

const L = (x1, y1, x2, y2, w) => ({ t: "line", x1, y1, x2, y2, w });
const R = (x, y, width, height) => ({ t: "rect", x, y, width, height });
const C = (cx, cy, r) => ({ t: "circle", cx, cy, r });
const A = (d) => ({ t: "path", d });

export const SPORTS = {
  badminton: {
    label: "Badminton",
    accent: "var(--color-accent-teal)",
    // Regulation court: tramlines, short/long service lines, centre lines.
    court: [
      R(200, 100, 800, 600),
      L(200, 400, 1000, 400, 2.4), // net
      L(240, 100, 240, 700), L(960, 100, 960, 700), // doubles tramlines
      L(200, 340, 1000, 340), L(200, 460, 1000, 460), // short service
      L(200, 160, 1000, 160), L(200, 640, 1000, 640), // long service
      L(600, 100, 600, 340), L(600, 460, 600, 700), // centre
    ],
    // Shuttle: climbs high, drops steeply.
    arcs: [
      "M 150 620 Q 600 40 1050 560",
      "M 1080 180 Q 600 760 180 300",
      "M 240 340 Q 620 -40 980 420",
      "M 980 660 Q 560 200 220 480",
    ],
  },

  tennis: {
    label: "Tennis",
    accent: "var(--color-accent-yellow)",
    court: [
      R(200, 100, 800, 600),
      L(200, 400, 1000, 400, 2.4), // net
      L(270, 100, 270, 700), L(930, 100, 930, 700), // singles sidelines
      L(270, 250, 930, 250), L(270, 550, 930, 550), // service lines
      L(600, 250, 600, 550), // centre service line
    ],
    // Flatter, faster than a shuttle.
    arcs: [
      "M 170 520 Q 600 240 1030 480",
      "M 1040 300 Q 600 600 190 340",
      "M 260 300 Q 600 140 950 380",
    ],
  },

  basketball: {
    label: "Basketball",
    accent: "var(--color-accent-orange)",
    court: [
      R(200, 100, 800, 600),
      L(600, 100, 600, 700), // halfway
      C(600, 400, 90), // centre circle
      R(200, 250, 150, 300), R(850, 250, 150, 300), // keys
      A("M 350 250 A 90 90 0 0 1 350 550"), // free-throw arc
      A("M 850 250 A 90 90 0 0 0 850 550"),
      A("M 200 180 A 240 240 0 0 1 200 620"), // three-point arcs
      A("M 1000 180 A 240 240 0 0 0 1000 620"),
    ],
    // Shooting parabola.
    arcs: [
      "M 300 620 Q 600 60 900 300",
      "M 900 620 Q 600 60 300 300",
      "M 250 500 Q 600 120 980 560",
    ],
  },

  football: {
    label: "Football",
    accent: "var(--color-accent-teal)",
    court: [
      R(160, 120, 880, 560),
      L(600, 120, 600, 680), // halfway
      C(600, 400, 100), // centre circle
      R(160, 250, 120, 300), R(920, 250, 120, 300), // penalty areas
      R(160, 330, 50, 140), R(990, 330, 50, 140), // six-yard boxes
    ],
    // Long curling pass.
    arcs: [
      "M 220 620 Q 600 180 1000 420",
      "M 1000 220 Q 560 660 200 380",
      "M 300 200 Q 700 500 980 240",
    ],
  },

  volleyball: {
    label: "Volleyball",
    accent: "var(--color-accent-blue)",
    court: [
      R(240, 140, 720, 520),
      L(240, 400, 960, 400, 2.4), // net
      L(240, 290, 960, 290), L(240, 510, 960, 510), // attack lines
    ],
    arcs: [
      "M 300 560 Q 600 80 900 520",
      "M 880 240 Q 600 700 320 280",
    ],
  },

  tableTennis: {
    label: "Table Tennis",
    accent: "var(--color-accent-pink)",
    court: [
      R(260, 180, 680, 440),
      L(260, 400, 940, 400, 2.4), // net
      L(600, 180, 600, 620), // centre line
    ],
    // Short, rapid exchanges.
    arcs: [
      "M 320 520 Q 600 300 880 500",
      "M 880 300 Q 600 520 320 320",
      "M 360 420 Q 600 260 840 440",
    ],
  },

  cricket: {
    label: "Cricket",
    accent: "var(--color-accent-purple)",
    court: [
      C(600, 400, 330), // boundary
      C(600, 400, 200), // inner ring
      R(560, 250, 80, 300), // pitch
      L(560, 280, 640, 280), L(560, 520, 640, 520), // creases
    ],
    // Fast delivery with bounce.
    arcs: [
      "M 600 240 Q 600 460 600 560",
      "M 260 400 Q 600 300 940 400",
      "M 600 560 Q 900 200 1060 420",
    ],
  },
};

const DOTS = Array.from({ length: 14 }, (_, i) => ({
  cx: 80 + ((i * 137) % 1040),
  cy: 60 + ((i * 223) % 680),
  r: 1.5 + (i % 3) * 0.9,
  color: [
    "var(--color-accent-teal)", "var(--color-accent-yellow)",
    "var(--color-accent-pink)", "var(--color-accent-blue)",
  ][i % 4],
}));

function CourtShape({ shape }) {
  const common = { fill: "none", vectorEffect: "non-scaling-stroke" };
  if (shape.t === "line") return <line {...shape} strokeWidth={shape.w || undefined} {...common} x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2} />;
  if (shape.t === "rect") return <rect x={shape.x} y={shape.y} width={shape.width} height={shape.height} {...common} />;
  if (shape.t === "circle") return <circle cx={shape.cx} cy={shape.cy} r={shape.r} {...common} />;
  return <path d={shape.d} {...common} />;
}

export default function SportsBackground({ sport = "badminton" }) {
  const root = useRef(null);
  const config = SPORTS[sport] || SPORTS.badminton;

  useGSAP(
    () => {
      const mm = gsap.matchMedia();

      mm.add(
        {
          motionOK: "(prefers-reduced-motion: no-preference)",
          reduced: "(prefers-reduced-motion: reduce)",
        },
        (ctx) => {
          // Reduced motion: court and motes still render, they just hold
          // still. Nothing loops.
          if (!ctx.conditions.motionOK) return;

          // Rally trajectories: draw the flight path, hold, fade, repeat.
          // dasharray is measured from each path's real length, which gets us
          // a draw-on effect without needing DrawSVGPlugin.
          gsap.utils.toArray(".sb-arc").forEach((path, i) => {
            const len = path.getTotalLength();
            gsap.set(path, { strokeDasharray: len, strokeDashoffset: len, autoAlpha: 0 });

            gsap
              .timeline({ repeat: -1, delay: i * 1.9, repeatDelay: 3.2 })
              .to(path, { autoAlpha: 0.5, duration: 0.35, ease: "none" })
              .to(path, { strokeDashoffset: 0, duration: 2.6, ease: "power1.inOut" }, "<")
              .to(path, { autoAlpha: 0, duration: 0.9, ease: "none" }, ">-0.2");
          });

          gsap.to(".sb-dot", {
            y: () => gsap.utils.random(-46, -16),
            x: () => gsap.utils.random(-18, 18),
            opacity: () => gsap.utils.random(0.2, 0.65),
            duration: () => gsap.utils.random(7, 13),
            repeat: -1,
            yoyo: true,
            ease: "sine.inOut",
            stagger: { each: 0.35, from: "random" },
          });

          gsap.to(".sb-court", {
            opacity: 0.42,
            scale: 1.015,
            transformOrigin: "50% 50%",
            duration: 11,
            repeat: -1,
            yoyo: true,
            ease: "sine.inOut",
          });
        },
        root
      );
    },
    { scope: root, dependencies: [sport], revertOnUpdate: true }
  );

  return (
    <div
      ref={root}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-canvas"
    >
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(130% 100% at 50% 8%, #1c2c4d 0%, #101b31 42%, var(--color-canvas) 100%)",
        }}
      />

      <svg viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full">
        {/* Playing surface, laid back in perspective */}
        <g
          key={sport}
          className="sb-court"
          opacity="0.3"
          stroke={config.accent}
          strokeWidth="1.8"
          fill="none"
          style={{ transform: "perspective(900px) rotateX(34deg)", transformOrigin: "50% 62%" }}
        >
          {config.court.map((shape, i) => <CourtShape key={i} shape={shape} />)}
        </g>

        {/* Arena bowl suggestion — sport-neutral, always present */}
        <g opacity="0.22" stroke="var(--color-line)" strokeWidth="1" fill="none">
          <ellipse cx="600" cy="440" rx="700" ry="380" />
          <ellipse cx="600" cy="440" rx="540" ry="290" />
        </g>

        {config.arcs.map((d, i) => (
          <path
            key={`${sport}-${i}`}
            className="sb-arc"
            d={d}
            stroke={[
              "var(--color-accent-teal)", "var(--color-accent-orange)",
              "var(--color-accent-purple)", "var(--color-accent-blue)",
            ][i % 4]}
            strokeWidth="1.6"
            strokeLinecap="round"
            fill="none"
            opacity="0"
          />
        ))}

        {DOTS.map((d, i) => (
          <circle key={i} className="sb-dot" cx={d.cx} cy={d.cy} r={d.r} fill={d.color} opacity="0.35" />
        ))}
      </svg>

      {/* Vignette so content always stays readable over the artwork */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(115% 85% at 50% 42%, transparent 0%, rgba(7,11,20,0.15) 55%, rgba(7,11,20,0.62) 100%)",
        }}
      />
    </div>
  );
}
