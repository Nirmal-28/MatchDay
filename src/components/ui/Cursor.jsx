import { useEffect, useRef, useState } from "react";
import { useHasFinePointer, usePrefersReducedMotion } from "./reveal";

/* ═══════════════════════════════════════════════════════════════════════
   CURSOR
   ═══════════════════════════════════════════════════════════════════════

   A small ring that trails the pointer and reacts to what is under it.

   CONSTRAINED ON PURPOSE. The native cursor is never hidden — this rides
   alongside it. That single decision removes the entire class of problems
   custom cursors usually cause: text selection still shows an I-beam, a
   disabled control still shows not-allowed, a link still shows a pointer,
   and if this component fails the page is completely unaffected.

   It is 28px, hollow, and mix-blend-mode: difference, so it never covers
   anything readable — it inverts what is beneath it instead of hiding it.
   Over an interactive element it expands and fills; that is the entire
   vocabulary. No "VIEW" label chasing the pointer, no giant blob.

   Off entirely for: touch devices (no persistent pointer to track),
   reduced-motion (a trailing element is exactly what that preference is
   about), and any coarse-pointer hybrid.

   Performance: a single rAF loop that only runs while the pointer has moved
   since the last frame, writing one transform on one fixed element. It
   parks itself when the pointer leaves the window.
   ══════════════════════════════════════════════════════════════════════ */

const INTERACTIVE = 'a, button, [role="button"], input, select, textarea, label, summary, [tabindex]:not([tabindex="-1"])';

export default function Cursor() {
  const fine = useHasFinePointer();
  const reduced = usePrefersReducedMotion();
  const dotRef = useRef(null);
  const [visible, setVisible] = useState(false);
  const [active, setActive] = useState(false);

  const target = useRef({ x: 0, y: 0 });
  const current = useRef({ x: 0, y: 0 });
  const rafRef = useRef(0);
  const dirty = useRef(false);

  const enabled = fine && !reduced;

  useEffect(() => {
    if (!enabled) return;

    const onMove = (e) => {
      target.current.x = e.clientX;
      target.current.y = e.clientY;
      dirty.current = true;
      if (!visible) setVisible(true);

      // `closest` on the actual event target, so hovering a span inside a
      // button still reads as interactive.
      const el = e.target instanceof Element ? e.target.closest(INTERACTIVE) : null;
      setActive(!!el);
    };

    const onLeave = () => setVisible(false);
    const onEnter = () => setVisible(true);

    // Lerp toward the pointer. The lag is the whole effect — an element
    // pinned exactly to the cursor is invisible as a distinct object.
    const tick = () => {
      if (dirty.current) {
        current.current.x += (target.current.x - current.current.x) * 0.18;
        current.current.y += (target.current.y - current.current.y) * 0.18;
        const dx = Math.abs(target.current.x - current.current.x);
        const dy = Math.abs(target.current.y - current.current.y);
        // Settled: stop writing transforms until the pointer moves again,
        // so an idle page does not hold a rAF loop doing arithmetic forever.
        if (dx < 0.1 && dy < 0.1) dirty.current = false;
        const node = dotRef.current;
        if (node) {
          node.style.transform =
            `translate3d(${current.current.x.toFixed(1)}px, ${current.current.y.toFixed(1)}px, 0) translate(-50%, -50%)`;
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    document.addEventListener("pointerenter", onEnter);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("pointerenter", onEnter);
    };
  }, [enabled, visible]);

  if (!enabled) return null;

  /* THE MARK: a court-line intersection.

     Two thin strokes crossing with a gap at the centre — the centre mark
     painted on every court in every sport this platform runs, and the same
     "court line" motif the design system already uses to mark a section and
     the leading edge of a card. It reads as precision and as sport, and it
     is ours rather than a generic ring.

     Over an interactive element the cross draws in a service box around
     itself: the lines shorten, a square appears, and the whole mark rotates
     45 degrees to sit as a diamond. One transition, two states, no labels
     chasing the pointer.

     The centre stays hollow at all times, which is the point — you can
     always see exactly what you are aiming at. */
  const size = active ? 40 : 28;
  const arm = active ? 6 : 10;   // stroke length from the gap outward
  const gap = active ? 5 : 4;    // hollow centre

  return (
    <div
      ref={dotRef}
      aria-hidden="true"
      className="pointer-events-none fixed left-0 top-0 z-[60] will-change-transform"
      style={{
        width: size,
        height: size,
        // Inverts whatever is beneath rather than covering it, so the mark
        // stays visible on the dark app AND the inverted light section
        // without a single theme-aware branch.
        mixBlendMode: "difference",
        opacity: visible ? 1 : 0,
        transition: "width 240ms cubic-bezier(0.16,1,0.3,1), height 240ms cubic-bezier(0.16,1,0.3,1), opacity 200ms",
      }}
    >
      <svg
        viewBox="0 0 40 40"
        className="h-full w-full"
        style={{
          transform: active ? "rotate(45deg)" : "rotate(0deg)",
          transition: "transform 320ms cubic-bezier(0.16,1,0.3,1)",
        }}
      >
        <g stroke="#fff" strokeWidth={active ? 1.6 : 1.3} strokeLinecap="square" fill="none">
          {/* The cross: four arms leaving a hollow centre. */}
          <line x1={20 - gap - arm} y1="20" x2={20 - gap} y2="20" />
          <line x1={20 + gap} y1="20" x2={20 + gap + arm} y2="20" />
          <line x1="20" y1={20 - gap - arm} x2="20" y2={20 - gap} />
          <line x1="20" y1={20 + gap} x2="20" y2={20 + gap + arm} />
          {/* The service box, drawn only over something you can act on. */}
          <rect
            x="6" y="6" width="28" height="28"
            style={{
              opacity: active ? 0.85 : 0,
              transition: "opacity 260ms ease-out",
            }}
          />
        </g>
      </svg>
    </div>
  );
}
