/* ═══════════════════════════════════════════════════════════════════════
   MATCHDAY MOTION SYSTEM
   ═══════════════════════════════════════════════════════════════════════

   The rule this file exists to enforce:

       STILLNESS → INTERACTION → MOTION → STILLNESS

   Nothing here loops. Every animation in this module is triggered by
   something the user did — arriving at a section, pointing at a card,
   pressing a control — and then it stops and stays stopped. That is the
   difference between an interface with a pulse and an interface that
   twitches while you are trying to read it.

   Four tiers, matching the brief's motion taxonomy:

     MICRO    <Magnetic/>          a control leaning toward the pointer
     SMALL    <Tilt/>              a card responding to where you point
     MEDIUM   <MaskText/> <Rise/>  a section arriving as you reach it
     LARGE    page transitions     (in App.jsx, one shared timing)

   IMPLEMENTATION NOTES

   Everything is IntersectionObserver + CSS custom properties. No animation
   library is imported here, no rAF loop runs when the pointer is still, and
   every observer disconnects the moment its element has revealed. The whole
   module is a few hundred bytes of runtime behaviour rather than a
   choreography engine — which is what keeps it honest about performance on
   a mid-range phone at a venue with bad signal.

   REDUCED MOTION is not an afterthought here: each hook reads the
   preference and returns a no-op, so content renders in its final state
   immediately rather than animating faster. index.css carries a global
   backstop on top of that.
   ══════════════════════════════════════════════════════════════════════ */

import {
  useEffect, useRef, useState, useCallback, Children, cloneElement, isValidElement,
} from "react";
import { cx } from "../../lib/engines";

/* ── Preference + capability probes ───────────────────────────────────── */

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (e) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

// Pointer-driven effects (tilt, magnetism, the cursor) are meaningless on a
// touchscreen and actively harmful on one — a tilt that fires on tap reads
// as the card being broken. `hover: hover` is the honest test: it asks
// whether the device has a pointer that can rest on something.
function useHasFinePointer() {
  const [fine, setFine] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    setFine(mq.matches);
    const onChange = (e) => setFine(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return fine;
}

/* ── In-view trigger ──────────────────────────────────────────────────────
   One-shot by design. The observer disconnects as soon as the element has
   been seen, so a long discovery page does not keep dozens of observers
   alive while someone scrolls back and forth. */
export function useInView({ threshold = 0.15, rootMargin = "0px 0px -10% 0px", immediate = false } = {}) {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    // `immediate` is for content that is above the fold by construction —
    // a hero. You do not "scroll into" the first screen, so waiting for an
    // intersection there is both wrong and fragile: on a phone the hero's
    // lower half sits close enough to the fold that the -10% root margin
    // can leave the paragraph, the search field and the primary CTA
    // invisible until the user scrolls, which is exactly the content they
    // arrived for.
    if (reduced || immediate) { setInView(true); return; }

    const el = ref.current;
    if (!el) return;

    // No IntersectionObserver (very old browsers, some test environments):
    // show the content rather than leaving it invisible forever.
    if (typeof IntersectionObserver === "undefined") { setInView(true); return; }

    // Held in a box rather than referenced by name inside its own callback.
    // The IntersectionObserver constructor is allowed to invoke the callback
    // synchronously — some polyfills and webviews do exactly that for an
    // element already on screen — and a direct `io.disconnect()` would then
    // hit the temporal dead zone and throw before the content ever revealed.
    const box = {};
    box.io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          box.io?.disconnect();
        }
      },
      { threshold, rootMargin }
    );
    box.io.observe(el);
    return () => box.io?.disconnect();
  }, [threshold, rootMargin, reduced, immediate]);

  return [ref, inView];
}

/* ── MaskText ─────────────────────────────────────────────────────────────
   The signature MatchDay heading reveal.

   Each line sits in its own overflow-hidden box and rises from beneath its
   own baseline, staggered. This is a MASK, not a fade: the words are
   clipped by the line box, so they arrive the way a scoreboard flips rather
   than the way a modal dialog appears. It is the one piece of choreography
   used on major headings across the product, which is what makes it read as
   a signature instead of as decoration.

   Accessibility: the full string stays in the DOM as a single accessible
   name via a visually-hidden copy, and the split lines are aria-hidden.
   Otherwise a screen reader announces a headline one fragment at a time.

   Splitting is on explicit line breaks the caller supplies (an array of
   strings), never on measured text — measuring would force a layout pass on
   every resize and would still get it wrong at the breakpoint boundaries. */
export function MaskText({
  lines,
  as: As = "span",
  className,
  lineClassName,
  stagger = 0.075,
  delay = 0,
  immediate = false,
}) {
  const [ref, inView] = useInView({ immediate });
  const reduced = usePrefersReducedMotion();
  const arr = Array.isArray(lines) ? lines : [lines];

  return (
    <As ref={ref} className={className}>
      {/* The accessible copy: one uninterrupted string. */}
      <span className="sr-only">{arr.join(" ")}</span>

      {arr.map((line, i) => (
        <span
          key={i}
          aria-hidden="true"
          className="block overflow-hidden"
          // A touch of vertical room so descenders (g, y, p) are not clipped
          // by the mask box at rest.
          style={{ paddingBottom: "0.08em", marginBottom: "-0.08em" }}
        >
          <span
            // `lineClassName` may be a function of the line index, which is
            // how a poster block alternates solid and outlined weight without
            // the caller having to hand-roll three separate MaskTexts.
            className={cx(
              "block will-change-transform",
              typeof lineClassName === "function" ? lineClassName(i) : lineClassName
            )}
            style={{
              transform: reduced || inView ? "translate3d(0,0,0)" : "translate3d(0,110%,0)",
              opacity: reduced || inView ? 1 : 0,
              transition: reduced
                ? "none"
                : `transform 900ms cubic-bezier(0.16,1,0.3,1) ${delay + i * stagger}s, opacity 600ms ease-out ${delay + i * stagger}s`,
            }}
          >
            {line}
          </span>
        </span>
      ))}
    </As>
  );
}

/* ── Rise ─────────────────────────────────────────────────────────────────
   The workhorse section reveal: content lifts a short distance into place
   as it enters. Deliberately small (16px) and deliberately fast — this runs
   on a lot of elements, and anything larger turns a scroll into a parade. */
export function Rise({
  children, className, delay = 0, distance = 16, immediate = false, as: As = "div", ...props
}) {
  const [ref, inView] = useInView({ immediate });
  const reduced = usePrefersReducedMotion();

  return (
    <As
      ref={ref}
      className={className}
      style={{
        transform: reduced || inView ? "translate3d(0,0,0)" : `translate3d(0,${distance}px,0)`,
        opacity: reduced || inView ? 1 : 0,
        transition: reduced
          ? "none"
          : `transform 700ms cubic-bezier(0.16,1,0.3,1) ${delay}s, opacity 500ms ease-out ${delay}s`,
      }}
      {...props}
    >
      {children}
    </As>
  );
}

/* ── Stagger ──────────────────────────────────────────────────────────────
   Wraps a list so its children arrive in sequence rather than as one block.
   Clones each child with an incremental delay, so callers write an ordinary
   list and get choreography. Capped, because a 40-card grid staggered at
   60ms would take two and a half seconds to finish arriving — past a point
   the effect stops reading as rhythm and starts reading as lag. */
export function Stagger({ children, className, step = 0.06, max = 8, as: As = "div", ...props }) {
  return (
    <As className={className} {...props}>
      {Children.map(children, (child, i) =>
        isValidElement(child)
          ? cloneElement(child, { style: { ...(child.props.style || {}), "--stagger-delay": `${Math.min(i, max) * step}s` } })
          : child
      )}
    </As>
  );
}

// Companion to <Stagger/>: reads the delay the parent injected.
export function StaggerChild({ children, className, distance = 14, style, as: As = "div", ...props }) {
  const [ref, inView] = useInView();
  const reduced = usePrefersReducedMotion();
  const delay = style?.["--stagger-delay"] || "0s";

  return (
    <As
      ref={ref}
      className={className}
      style={{
        ...style,
        transform: reduced || inView ? "translate3d(0,0,0)" : `translate3d(0,${distance}px,0)`,
        opacity: reduced || inView ? 1 : 0,
        transition: reduced
          ? "none"
          : `transform 650ms cubic-bezier(0.16,1,0.3,1) ${delay}, opacity 450ms ease-out ${delay}`,
      }}
      {...props}
    >
      {children}
    </As>
  );
}

/* ── Tilt ─────────────────────────────────────────────────────────────────
   A card that leans toward the pointer. This is the "physical object"
   interaction — the card behaves like a thing on a surface rather than a
   rectangle of text.

   Kept deliberately restrained: MAX_TILT is 5 degrees. Past roughly six it
   stops reading as physicality and starts reading as a novelty, and text on
   the card becomes measurably harder to read while it moves.

   Performance: no rAF loop. The pointer event itself is the clock, and it
   only writes two CSS custom properties, so the browser composites the
   transform without a style recalculation of the subtree. `will-change` is
   applied on enter and REMOVED on leave — leaving it on permanently would
   hold a compositor layer for every card on the page. */
const MAX_TILT = 5;

export function Tilt({ children, className, max = MAX_TILT, scale = 1.01, ...props }) {
  const ref = useRef(null);
  const fine = useHasFinePointer();
  const reduced = usePrefersReducedMotion();
  const active = fine && !reduced;

  const onPointerMove = useCallback((e) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // -0.5..0.5 relative to the card's centre.
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    el.style.setProperty("--tilt-x", `${(-py * max).toFixed(2)}deg`);
    el.style.setProperty("--tilt-y", `${(px * max).toFixed(2)}deg`);
    // Drives the sheen highlight, so the light appears to come from the
    // pointer rather than from a fixed direction.
    el.style.setProperty("--tilt-px", `${((px + 0.5) * 100).toFixed(1)}%`);
    el.style.setProperty("--tilt-py", `${((py + 0.5) * 100).toFixed(1)}%`);
  }, [max]);

  const onPointerEnter = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.willChange = "transform";
    el.style.setProperty("--tilt-scale", String(scale));
  }, [scale]);

  const onPointerLeave = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--tilt-x", "0deg");
    el.style.setProperty("--tilt-y", "0deg");
    el.style.setProperty("--tilt-scale", "1");
    // Released so the card stops holding a compositor layer at rest.
    el.style.willChange = "auto";
  }, []);

  if (!active) return <div className={className} {...props}>{children}</div>;

  return (
    <div
      ref={ref}
      className={cx("md-tilt", className)}
      onPointerMove={onPointerMove}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      {...props}
    >
      {children}
    </div>
  );
}

/* ── Magnetic ─────────────────────────────────────────────────────────────
   A control that drifts a few pixels toward the pointer as it approaches.
   Used only on primary CTAs — it is a reward for aiming at the most
   important button on a screen, and it stops being one if every button does
   it. Strength is in pixels of maximum travel. */
export function Magnetic({ children, className, strength = 6, as: As = "div", ...props }) {
  const ref = useRef(null);
  const fine = useHasFinePointer();
  const reduced = usePrefersReducedMotion();
  const active = fine && !reduced;

  const onPointerMove = useCallback((e) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    el.style.transform = `translate3d(${(dx * strength).toFixed(1)}px, ${(dy * strength).toFixed(1)}px, 0)`;
  }, [strength]);

  const reset = useCallback(() => {
    const el = ref.current;
    if (el) el.style.transform = "translate3d(0,0,0)";
  }, []);

  if (!active) return <As className={className} {...props}>{children}</As>;

  return (
    <As
      ref={ref}
      className={cx("md-magnetic", className)}
      onPointerMove={onPointerMove}
      onPointerLeave={reset}
      {...props}
    >
      {children}
    </As>
  );
}

/* ── Counter ──────────────────────────────────────────────────────────────
   Counts a real number up when it first scrolls into view. Used only for
   figures that are genuinely counts (matches played, courts, entries) —
   never for anything derived or estimated, because the count-up implies a
   tally that actually happened.

   Uses rAF, but only for the ~700ms the count runs, then stops. */
export function Counter({ value, className, duration = 900, format = (n) => n }) {
  const [ref, inView] = useInView();
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = useState(() => (reduced ? value : 0));
  const doneRef = useRef(false);

  useEffect(() => {
    if (reduced) { setShown(value); return; }
    if (!inView || doneRef.current) return;
    // A count-up from zero is only meaningful for a number with somewhere to
    // travel; anything tiny just flickers.
    if (typeof value !== "number" || value <= 3) { setShown(value); doneRef.current = true; return; }

    doneRef.current = true;
    let raf;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      // easeOutExpo — fast off the mark, settles precisely on the real value.
      const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      setShown(Math.round(eased * value));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, value, duration, reduced]);

  // If the underlying value changes after the count has run (a live match
  // completing, say), follow it directly rather than re-counting.
  useEffect(() => {
    if (doneRef.current) setShown(value);
  }, [value]);

  return <span ref={ref} className={className}>{format(shown)}</span>;
}

export { usePrefersReducedMotion, useHasFinePointer };
