import { useEffect, useRef, useState } from "react";
import { cx } from "../../lib/engines";

/* A horizontally scrollable strip that says so.

   Tab rails overflow on a phone, and the tabs pushed off the right edge are
   routinely the ones people want — Bracket and Results on the public page,
   most of the organizer rail in the Control Center. Clipped mid-label with no
   fade, no chevron and no scrollbar, the last visible thing is a sliced glyph
   that reads as a rendering bug rather than an invitation to swipe.

   The fade is a mask on the scroller itself, so it costs no vertical space,
   and it tracks the real scroll position: on the right only while there is
   more to reach, on the left once you have moved, and gone entirely when
   everything already fits. A static fade would keep implying hidden tabs at
   the end of the strip, which is its own small lie.

   Put the border on `className` (the outer wrapper) rather than
   `innerClassName`, or the mask will fade the border along with the content.

   Props:
     className       outer wrapper — borders, margins
     innerClassName  the scroller itself — flex, gap, padding */
export default function ScrollFade({ children, className, innerClassName }) {
  const ref = useRef(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      // 1px of slack: sub-pixel layout means scrollLeft rarely lands exactly
      // on scrollWidth - clientWidth, which would leave the fade stuck on.
      const max = el.scrollWidth - el.clientWidth;
      setEdges({ left: el.scrollLeft > 1, right: el.scrollLeft < max - 1 });
    };
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    // Catches viewport resizes and content changes alike (a tournament going
    // live adds a Live tab, which can push the row into overflow).
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", measure); ro.disconnect(); };
  }, [children]);

  const mask =
    edges.left && edges.right
      ? "linear-gradient(to right, transparent 0, #000 28px, #000 calc(100% - 28px), transparent 100%)"
      : edges.right
        ? "linear-gradient(to right, #000 calc(100% - 28px), transparent 100%)"
        : edges.left
          ? "linear-gradient(to right, transparent 0, #000 28px)"
          : undefined;

  return (
    <div className={className}>
      <div
        ref={ref}
        className={cx("overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", innerClassName)}
        style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
      >
        {children}
      </div>
    </div>
  );
}
