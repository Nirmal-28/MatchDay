/* Fixed, app-wide playing surface: a court rendered in perspective beneath
   an arena bowl, with the trace of a rally arcing across it.

   STILL BY DESIGN. This component used to run three infinite GSAP timelines
   — arcs redrawing forever, fourteen motes drifting, the whole court slowly
   breathing. Behind a discovery page of dense tournament cards and a scorer
   staring at a live match, that is motion competing with the content for
   attention every second the app is open.

   The immersion is now carried by composition instead: perspective, depth of
   field via the vignette, and the sport's own geometry. The only motion is a
   single draw-on when the page first mounts — it says "the surface is being
   laid out", once, and then holds. Under prefers-reduced-motion even that is
   skipped and the artwork simply appears.

   Dropping the timelines also removed GSAP from the bundle entirely; it was
   the largest dependency in the app and this was its only consumer.

   MULTI-SPORT BY DESIGN. MatchDay runs badminton today but is built to cover
   every sport, so court geometry and rally shapes are data, not markup —
   adding tennis or basketball is a new entry in SPORTS, not a rewrite.

   Decorative only: aria-hidden, pointer-events-none, behind all content. */

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
    arcs: ["M 150 620 Q 600 40 1050 560", "M 1080 180 Q 600 760 180 300"],
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
    arcs: ["M 170 520 Q 600 240 1030 480", "M 1040 300 Q 600 600 190 340"],
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
    arcs: ["M 300 620 Q 600 60 900 300", "M 900 620 Q 600 60 300 300"],
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
    arcs: ["M 220 620 Q 600 180 1000 420", "M 1000 220 Q 560 660 200 380"],
  },

  volleyball: {
    label: "Volleyball",
    accent: "var(--color-accent-blue)",
    court: [
      R(240, 140, 720, 520),
      L(240, 400, 960, 400, 2.4), // net
      L(240, 290, 960, 290), L(240, 510, 960, 510), // attack lines
    ],
    arcs: ["M 300 560 Q 600 80 900 520", "M 880 240 Q 600 700 320 280"],
  },

  tableTennis: {
    label: "Table Tennis",
    accent: "var(--color-accent-pink)",
    court: [
      R(260, 180, 680, 440),
      L(260, 400, 940, 400, 2.4), // net
      L(600, 180, 600, 620), // centre line
    ],
    arcs: ["M 320 520 Q 600 300 880 500", "M 880 300 Q 600 520 320 320"],
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
    arcs: ["M 260 400 Q 600 300 940 400", "M 600 560 Q 900 200 1060 420"],
  },
};

function CourtShape({ shape }) {
  const common = { fill: "none", vectorEffect: "non-scaling-stroke" };
  if (shape.t === "line") {
    return <line {...common} strokeWidth={shape.w || undefined} x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2} />;
  }
  if (shape.t === "rect") return <rect x={shape.x} y={shape.y} width={shape.width} height={shape.height} {...common} />;
  if (shape.t === "circle") return <circle cx={shape.cx} cy={shape.cy} r={shape.r} {...common} />;
  return <path d={shape.d} {...common} />;
}

export default function SportsBackground({ sport = "badminton" }) {
  const config = SPORTS[sport] || SPORTS.badminton;

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-canvas">
      {/* Depth: a lit ceiling above the court falling off to the canvas
          colour at the edges. Static — this is the "arena lighting". */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(130% 100% at 50% 6%, #1a2a49 0%, #0e192e 40%, var(--color-canvas) 100%)",
        }}
      />

      <svg viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full">
        {/* Playing surface, laid back in perspective. */}
        <g
          key={sport}
          opacity="0.3"
          stroke={config.accent}
          strokeWidth="1.8"
          fill="none"
          style={{ transform: "perspective(900px) rotateX(34deg)", transformOrigin: "50% 62%" }}
        >
          {config.court.map((shape, i) => <CourtShape key={i} shape={shape} />)}
        </g>

        {/* Arena bowl — sport-neutral, always present. */}
        <g opacity="0.2" stroke="var(--color-line)" strokeWidth="1" fill="none">
          <ellipse cx="600" cy="440" rx="700" ry="380" />
          <ellipse cx="600" cy="440" rx="540" ry="290" />
        </g>

        {/* The trace of a rally. Drawn once on mount via a CSS one-shot, then
            held at rest — a mark left on the surface, not a loop. The dash
            length is a fixed over-estimate of the path length so no layout
            measurement (and no animation library) is needed. */}
        {config.arcs.map((d, i) => (
          <path
            key={`${sport}-${i}`}
            className="sb-arc"
            d={d}
            stroke={i === 0 ? "var(--color-accent-teal)" : "var(--color-accent-orange)"}
            strokeWidth="1.4"
            strokeLinecap="round"
            fill="none"
            opacity="0.28"
            style={{
              strokeDasharray: 2400,
              animation: `sb-draw 1.6s ${0.15 + i * 0.35}s cubic-bezier(0.22,1,0.36,1) both`,
            }}
          />
        ))}
      </svg>

      {/* Vignette, so content always stays readable over the artwork. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(115% 85% at 50% 42%, transparent 0%, rgba(6,9,17,0.2) 55%, rgba(6,9,17,0.72) 100%)",
        }}
      />

      <style>{`
        @keyframes sb-draw {
          from { stroke-dashoffset: 2400; }
          to   { stroke-dashoffset: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .sb-arc { animation: none !important; stroke-dashoffset: 0 !important; }
        }
      `}</style>
    </div>
  );
}
