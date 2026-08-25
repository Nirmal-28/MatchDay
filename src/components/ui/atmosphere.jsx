// Reusable "MatchDay world" background layers — decorative, aria-hidden,
// and now entirely STATIC. Meant to be stacked inside a `relative
// overflow-hidden` section, behind real content (z-0), with content at z-10+.
//
// This file previously also exported <Trajectories/> (arcs redrawing on an
// infinite loop) and <FloatingObjects/> (six dots drifting forever). Both are
// gone: perpetual decoration behind readable text is exactly the noise the
// redesign set out to remove, and neither was imported anywhere any more.
// Depth on a section now comes from `.md-court-texture` / `.md-hatch` in
// index.css, which cost no JavaScript and never move.

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
