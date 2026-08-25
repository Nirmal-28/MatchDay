/* ═══════════════════════════════════════════════════════════════════════
   BACKGROUND — THE DRAW
   ═══════════════════════════════════════════════════════════════════════

   The app-wide backdrop is a tournament bracket: many entrants along both
   edges, converging round by round toward a single point at the centre.

   WHY THIS AND NOT A COURT

   The previous version drew a playing surface in perspective with rally
   arcs across it. Rendered at the low opacity a background needs, the
   perspective transform turned it into a set of unrelated diagonal streaks
   in one corner — legible as "lines", not as "a court", and carrying no
   meaning at all.

   A draw is the one shape that IS this product. It is what the software
   generates, and its form says the thing the platform exists to say:
   everyone starts on the outside, and the structure carries them inward.
   Anyone can enter the bracket.

   It is also honestly abstract. It is not pretending to be a real
   tournament's draw — it is the geometry of one, at 6% opacity, behind
   everything.

   STATIC. Nothing here loops. One draw-in on mount, then it holds. The
   whole component is deterministic geometry with no animation library, no
   timers and no per-frame work.
   ══════════════════════════════════════════════════════════════════════ */

const W = 1600;
const H = 900;
const CX = W / 2;
const CY = H / 2;

/* Builds one half of a bracket as a list of polylines.

   Each round halves the number of participants and doubles the vertical
   gap between them. A pair of adjacent slots is joined by an elbow — out
   from each slot, up/down to meet, then a single line onward into the next
   round. That is exactly how a real draw is drawn, which is why the shape
   reads as a bracket rather than as a decorative tree.

   `dir` is -1 for the left half (advancing rightward) and +1 for the right
   half (advancing leftward), so the two sides mirror into the centre. */
function buildBracket(dir, rounds = 4) {
  const paths = [];
  const slots0 = 2 ** rounds;          // 16 entrants per side
  const edgeX = CX + dir * (W * 0.46); // outermost column
  // MAGNITUDE, not a signed delta. Taking the signed difference made stepX
  // negative for the left half, and `edgeX - dir * stepX * r` then marched
  // that half off the left edge of the canvas — the whole left bracket was
  // rendering outside the viewBox. Direction is carried by `dir` alone.
  const stepX = Math.abs(edgeX - (CX + dir * 90)) / rounds;
  const spacing0 = H / (slots0 + 1);

  // Vertical centre of slot `i` in round `r`.
  const slotY = (r, i) => {
    const count = slots0 / 2 ** r;
    const spacing = (H * 0.92) / count;
    return (H - H * 0.92) / 2 + spacing * (i + 0.5);
  };

  for (let r = 0; r < rounds; r++) {
    const count = slots0 / 2 ** r;
    const x = edgeX - dir * stepX * r;
    const nextX = edgeX - dir * stepX * (r + 1);

    for (let i = 0; i < count; i += 2) {
      const yTop = slotY(r, i);
      const yBot = slotY(r, i + 1);
      const mid = (yTop + yBot) / 2;

      // Two horizontal stubs, the vertical that joins them, and the line
      // carrying the winner into the next round.
      paths.push(`M ${x} ${yTop} L ${nextX} ${yTop}`);
      paths.push(`M ${x} ${yBot} L ${nextX} ${yBot}`);
      paths.push(`M ${nextX} ${yTop} L ${nextX} ${yBot}`);
      paths.push(`M ${nextX} ${mid} L ${nextX - dir * stepX * 0.45} ${mid}`);
    }
  }

  // The last leg into the final.
  paths.push(`M ${edgeX - dir * stepX * rounds} ${CY} L ${CX + dir * 90} ${CY}`);
  return { paths, spacing0 };
}

const LEFT = buildBracket(-1);
const RIGHT = buildBracket(1);

// Entrant ticks along both outer edges — the "anyone" end of the draw.
function entrantTicks(dir) {
  const ticks = [];
  const count = 16;
  const edgeX = CX + dir * (W * 0.46);
  for (let i = 0; i < count; i++) {
    const spacing = (H * 0.92) / count;
    const y = (H - H * 0.92) / 2 + spacing * (i + 0.5);
    ticks.push({ x: edgeX, y, dir });
  }
  return ticks;
}

const TICKS = [...entrantTicks(-1), ...entrantTicks(1)];

export default function SportsBackground() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-canvas">
      {/* Arena lighting: bright above the final, falling away to the canvas
          colour at the edges. This is what gives the flat geometry depth. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 90% at 50% 4%, #16233d 0%, #0c1526 42%, var(--color-canvas) 100%)",
        }}
      />

      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 h-full w-full"
      >
        <defs>
          {/* The draw fades toward the outer edges, so the eye is carried
              inward to the final — and so the busiest part of the geometry
              (16 entrant lines) never competes with text over it. */}
          {/* `userSpaceOnUse` is essential here. The default
              (objectBoundingBox) resolves the gradient against EACH path's
              own bounding box — and a horizontal bracket stub has a
              zero-height box, so every segment got a single flat sample and
              the fade did not read at all. In user space the gradient is
              measured once across the whole viewBox, which is what makes
              the draw fade from the edges toward the final. */}
          <linearGradient id="md-draw-fade" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={W} y2="0">
            <stop offset="0%" stopColor="var(--color-accent-teal)" stopOpacity="0.15" />
            <stop offset="30%" stopColor="var(--color-accent-teal)" stopOpacity="0.55" />
            <stop offset="50%" stopColor="var(--color-accent-teal)" stopOpacity="0.9" />
            <stop offset="70%" stopColor="var(--color-accent-teal)" stopOpacity="0.55" />
            <stop offset="100%" stopColor="var(--color-accent-teal)" stopOpacity="0.15" />
          </linearGradient>
        </defs>

        <g
          className="md-draw"
          stroke="url(#md-draw-fade)"
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="square"
          // Low enough to sit UNDER copy rather than run through it. The
          // draw should be recognisable when you look for it and invisible
          // when you are reading — at 0.85 its connector lines cut straight
          // through the hero paragraph.
          opacity="0.26"
        >
          {[...LEFT.paths, ...RIGHT.paths].map((d, i) => (
            <path key={i} d={d} />
          ))}
        </g>

        {/* Entrant markers. Sixteen a side: the many who enter. */}
        <g fill="var(--color-accent-teal)" opacity="0.3">
          {TICKS.map((t, i) => (
            <circle key={i} cx={t.x} cy={t.y} r="2.5" />
          ))}
        </g>

        {/* The final. One point at the centre, where every line arrives. */}
        <g>
          <circle cx={CX} cy={CY} r="5" fill="var(--color-accent-teal)" opacity="0.55" />
          <circle cx={CX} cy={CY} r="15" fill="none" stroke="var(--color-accent-teal)" strokeWidth="1" opacity="0.4" />
          <circle cx={CX} cy={CY} r="30" fill="none" stroke="var(--color-accent-teal)" strokeWidth="1" opacity="0.18" />
        </g>
      </svg>

      {/* Vignette, so content always stays readable over the geometry. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(100% 75% at 50% 45%, transparent 0%, rgba(6,9,17,0.45) 45%, rgba(6,9,17,0.9) 100%)",
        }}
      />

      <style>{`
        /* One draw-on at mount: the bracket assembles, then holds forever.
           A long dash pattern over the whole group reads as the structure
           being filled in from nothing. */
        .md-draw path {
          stroke-dasharray: 1400;
          stroke-dashoffset: 1400;
          animation: md-draw-in 2.2s cubic-bezier(0.22, 1, 0.36, 1) forwards;
        }
        @keyframes md-draw-in { to { stroke-dashoffset: 0; } }
        @media (prefers-reduced-motion: reduce) {
          .md-draw path { animation: none; stroke-dashoffset: 0; }
        }
      `}</style>
    </div>
  );
}
