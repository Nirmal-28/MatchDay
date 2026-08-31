import { motion, useReducedMotion } from "motion/react";
import logo from "../../assets/logo.png";

/* Scroll-reveal helpers.

   Every one of these checks `useReducedMotion()`, which reads the OS-level
   `prefers-reduced-motion` setting. When it is on, the content renders at its
   final opacity and position immediately instead of fading and sliding.

   This is not decoration: the discovery and host-landing pages are built
   almost entirely out of these, so without the check a visitor with vestibular
   motion sensitivity gets the whole page sliding at them as they scroll.
   SportsBackground.jsx already honoured the same preference — these did not,
   which made the app inconsistent with its own standard (audit finding F5).

   Note it disables the ANIMATION, not the reveal: content must still end up
   visible, so the fix is to skip the offset rather than to skip the trigger. */

// Fades + slides an element up as it scrolls into view. Fires once.
export function Reveal({ children, delay = 0, className, as: As = motion.div, ...props }) {
  const reduce = useReducedMotion();
  return (
    <As
      initial={reduce ? false : { opacity: 0, y: 16 }}
      whileInView={reduce ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={reduce ? { duration: 0 } : { duration: 0.4, delay, ease: "easeOut" }}
      className={className}
      {...props}
    >
      {children}
    </As>
  );
}

// Wrap a list of children to stagger their entrance. Children should be
// plain elements — this only supplies the stagger timing to the container;
// each child still needs the fade/slide, so pair with <StaggerItem>.
export function StaggerList({ children, className, stagger = 0.06, as = "div" }) {
  const As = motion[as] || motion.div;
  const reduce = useReducedMotion();
  return (
    <As
      // The children read "hidden"/"show" from this container, so the variant
      // names still have to be driven even when the motion itself is removed —
      // StaggerItem is what flattens them to a no-op transition.
      initial={reduce ? false : "hidden"}
      whileInView="show"
      viewport={{ once: true, margin: "-40px" }}
      transition={reduce ? { duration: 0 } : { staggerChildren: stagger }}
      className={className}
    >
      {children}
    </As>
  );
}

export function StaggerItem({ children, className, as = "div" }) {
  const As = motion[as] || motion.div;
  const reduce = useReducedMotion();
  return (
    <As
      variants={
        reduce
          ? { hidden: { opacity: 1, y: 0 }, show: { opacity: 1, y: 0 } }
          : { hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0 } }
      }
      transition={reduce ? { duration: 0 } : { duration: 0.35, ease: "easeOut" }}
      className={className}
    >
      {children}
    </As>
  );
}

// Live indicator. The dot itself is `.md-live-dot` from index.css, so a live
// match looks identical here, on a MatchCard, on the venue display and in the
// header — one pulse, one red, defined in one place. It is the only looping
// animation in the product, and it stops under prefers-reduced-motion.
export function LivePulse({ label = "LIVE", className = "" }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider ${className}`}
      style={{ color: "var(--color-live)" }}
    >
      <span className="md-live-dot" />
      {label}
    </span>
  );
}

export function BrandLoader({ label = "Loading…" }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-14">
      <motion.img
        src={logo}
        alt=""
        className="h-10 w-10 rounded-lg"
        animate={{ scale: [1, 1.08, 1], opacity: [0.7, 1, 0.7] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
      />
      <div className="text-sm text-ink-3">{label}</div>
    </div>
  );
}

// The signature MatchDay animation: six colored people-dots (the logo's
// palette) converge from a scattered ring into formation, the real emblem
// crossfades in on top, then one soft radial pulse releases — "individual
// people, coming together, one competition."
const ASSEMBLY_DOTS = [
  { color: "var(--color-accent-yellow)", angle: -90 },
  { color: "var(--color-accent-orange)", angle: -30 },
  { color: "var(--color-accent-pink)", angle: 30 },
  { color: "var(--color-accent-purple)", angle: 90 },
  { color: "var(--color-accent-blue)", angle: 150 },
  { color: "var(--color-accent-teal)", angle: -150 },
];

export function LogoAssembly({ size = 160, className = "" }) {
  const radius = size * 0.42;
  const dot = Math.max(size * 0.16, 6);
  return (
    <div className={`relative ${className}`} style={{ width: size, height: size }}>
      {ASSEMBLY_DOTS.map((d, i) => {
        const rad = (d.angle * Math.PI) / 180;
        const x = Math.cos(rad) * radius;
        const y = Math.sin(rad) * radius;
        return (
          <motion.span
            key={i}
            className="absolute rounded-full"
            style={{
              width: dot, height: dot, backgroundColor: d.color,
              left: "50%", top: "50%", marginLeft: -dot / 2, marginTop: -dot / 2,
            }}
            initial={{ x: x * 2.6, y: y * 2.6, opacity: 0, scale: 0.5 }}
            animate={{ x: [x * 2.6, x, x * 0.15], y: [y * 2.6, y, y * 0.15], opacity: [0, 1, 0], scale: [0.5, 1, 0.6] }}
            transition={{ duration: 1.1, times: [0, 0.65, 1], delay: i * 0.05, ease: "easeInOut" }}
          />
        );
      })}
      <motion.img
        src={logo}
        alt="MatchDay"
        className="absolute inset-0 h-full w-full rounded-2xl"
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, delay: 0.85 }}
      />
      <motion.span
        className="absolute inset-0 rounded-full border-2"
        style={{ borderColor: "var(--color-accent-teal)" }}
        initial={{ opacity: 0.7, scale: 0.9 }}
        animate={{ opacity: 0, scale: 1.7 }}
        transition={{ duration: 0.9, delay: 1.15, ease: "easeOut" }}
      />
    </div>
  );
}

/* Sport glyphs. MatchDay runs badminton today but is built to cover every
   sport, so this is a map keyed by sport rather than a single hardcoded icon:
   adding a sport is a new entry here, and every consumer (cards, filters,
   nav, the sports-universe section) picks it up automatically. All glyphs
   share a 24x24 box, 1.5 stroke weight and round caps so they sit together
   as one family. */
const SPORT_GLYPHS = {
  badminton: (
    <>
      <circle cx="17.5" cy="6.5" r="3" strokeWidth="1.5" />
      <path d="M15 9L6 18M6 18L4 20M6 18L4 16M6 18L8 20M6 18L8 16" strokeWidth="1.5" strokeLinecap="round" />
    </>
  ),
  tennis: (
    <>
      <circle cx="12" cy="12" r="8.5" strokeWidth="1.5" />
      <path d="M4.5 6.5C7 9 8.5 12.5 8 19M19.5 6.5C17 9 15.5 12.5 16 19" strokeWidth="1.5" strokeLinecap="round" />
    </>
  ),
  tableTennis: (
    <>
      <circle cx="9.5" cy="9" r="6" strokeWidth="1.5" />
      <path d="M7 14.5L4.5 20.5" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="18" cy="16.5" r="2.2" strokeWidth="1.5" />
    </>
  ),
  basketball: (
    <>
      <circle cx="12" cy="12" r="8.5" strokeWidth="1.5" />
      <path d="M12 3.5v17M3.5 12h17M5.5 6C8 8.5 8 15.5 5.5 18M18.5 6C16 8.5 16 15.5 18.5 18" strokeWidth="1.5" strokeLinecap="round" />
    </>
  ),
  football: (
    <>
      <circle cx="12" cy="12" r="8.5" strokeWidth="1.5" />
      <path d="M12 7.5l3.5 2.5-1.3 4h-4.4l-1.3-4L12 7.5z" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M12 3.5v4M4.3 9.7l3.9 2.9M19.7 9.7l-3.9 2.9M8 20l1.8-6M16 20l-1.8-6" strokeWidth="1.5" strokeLinecap="round" />
    </>
  ),
  volleyball: (
    <>
      <circle cx="12" cy="12" r="8.5" strokeWidth="1.5" />
      <path d="M12 3.5c-3 4-3.5 9 1 17M20.4 10c-4.6 1.4-9 4.2-11.7 10M3.6 13.5c4.5-2 8-5.5 9.8-9.8" strokeWidth="1.5" strokeLinecap="round" />
    </>
  ),
  // Paddle plus a perforated ball — the detail that keeps it from reading
  // as tennis at glyph size.
  pickleball: (
    <>
      <path d="M4.5 9.5a5.5 5.5 0 0 1 11 0c0 3-2.2 5-5.5 5S4.5 12.5 4.5 9.5Z" strokeWidth="1.5" />
      <path d="M8.5 14.5L7 20.5" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="18.5" cy="16" r="3" strokeWidth="1.5" />
      <path d="M18.5 15v.01M17.3 17.2v.01M19.7 17.2v.01" strokeWidth="1.5" strokeLinecap="round" />
    </>
  ),
  cricket: (
    <>
      <path d="M14.5 3.5l6 6-9 9-6-6 9-9z" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M6.5 15.5L3 19l2 2 3.5-3.5" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="18.5" cy="18" r="2.5" strokeWidth="1.5" />
    </>
  ),
};

export const SPORT_KEYS = Object.keys(SPORT_GLYPHS);

export function SportIcon({ sport = "badminton", className = "", ...props }) {
  return (
    <svg
      viewBox="0 0 24 24" fill="none" stroke="currentColor"
      className={className} aria-hidden="true" {...props}
    >
      {SPORT_GLYPHS[sport] || SPORT_GLYPHS.badminton}
    </svg>
  );
}
