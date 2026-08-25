import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { X } from "lucide-react";
import { cx } from "../../lib/engines";
import { usePrefersReducedMotion } from "./reveal";

/* ═══════════════════════════════════════════════════════════════════════
   NAVIGATION OVERLAY
   ═══════════════════════════════════════════════════════════════════════

   The full-screen menu. Compact trigger in the header, expanded panel on
   demand — navigation with a personality, but one that gets out of the way.

   The composition is editorial: destinations set at display scale, numbered
   like a running order, each line wiping up from its own mask on a stagger.
   Secondary links and account actions sit beneath at body scale, so the
   hierarchy is unmistakable even though everything is one list.

   WHY THIS IS A DIALOG, CAREFULLY

   A full-screen menu that traps sighted users but not keyboard users is a
   trap in the literal sense. So this implements the whole contract:

     - role="dialog" + aria-modal, labelled, so it announces as a menu
       rather than as an anonymous region of links
     - focus moves in on open and returns to the trigger on close, so a
       keyboard user is never dumped at the top of the document
     - Tab is cycled inside; Escape closes
     - background scroll is locked, which on iOS otherwise scrolls the page
       behind the overlay once the overlay itself hits its end
     - every animated element is aria-hidden's inverse: the text is real
       text, the motion is transform-only on top of it

   The same rules the app's <Modal/> already enforces. They live here again
   rather than being imported because this panel is not a dialog box — it
   has no panel chrome, no header row, and covers the viewport — but the
   accessibility contract is identical and must not be softened just
   because the visual treatment is more expressive.
   ══════════════════════════════════════════════════════════════════════ */

export default function NavOverlay({ open, onClose, surfaces, currentSurface, session, onSignOut }) {
  const panelRef = useRef(null);
  const restoreRef = useRef(null);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    if (!open) return;

    restoreRef.current = document.activeElement;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    const focusables = () =>
      panelRef.current?.querySelectorAll(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) ?? [];
    (focusables()[0] || panelRef.current)?.focus();

    const onKeyDown = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
      if (e.key !== "Tab") return;
      const items = Array.from(focusables());
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = overflow;
      restoreRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  // Secondary destinations. Rankings is public; the account links only exist
  // for a signed-in user, and "Host a tournament" only for a signed-out one —
  // the same capability logic the header applies, not a second nav model.
  const secondary = [
    { to: "/leaderboard", label: "Rankings" },
    ...(session
      ? [{ to: "/me/profile", label: "Profile & settings" }]
      : [{ to: "/host", label: "Host a tournament" }, { to: "/login", label: "Sign in" }]),
  ];

  const ease = "cubic-bezier(0.16,1,0.3,1)";

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label="Menu"
      tabIndex={-1}
      className="md-court-texture fixed inset-0 z-50 overflow-y-auto bg-canvas outline-none"
      style={{
        // The panel itself wipes down from the top edge — the menu arrives
        // from where its trigger is, rather than fading in from nowhere.
        animation: reduced ? "none" : `md-nav-in 520ms ${ease} both`,
      }}
    >
      <div className="mx-auto flex min-h-full max-w-6xl flex-col px-4 py-5">
        <div className="mb-auto flex items-center justify-between">
          <span className="md-eyebrow">Menu</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="flex h-11 w-11 items-center justify-center rounded-full border border-line text-ink-2 transition-colors hover:border-accent-teal hover:text-ink"
          >
            <X size={20} />
          </button>
        </div>

        {/* Primary destinations, set as a running order. */}
        <nav aria-label="Primary" className="py-10">
          <ul className="space-y-1">
            {surfaces.map((s, i) => {
              const on = currentSurface === s.key;
              return (
                <li key={s.key} className="overflow-hidden">
                  <Link
                    to={s.to}
                    onClick={onClose}
                    aria-current={on ? "page" : undefined}
                    className="md-group flex items-baseline gap-4 py-1.5"
                    style={{
                      animation: reduced ? "none" : `md-nav-line 700ms ${ease} ${0.08 + i * 0.06}s both`,
                    }}
                  >
                    <span className="md-eyebrow w-6 shrink-0 text-ink-3">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span
                      className={cx(
                        "md-display text-5xl transition-colors sm:text-7xl",
                        on ? "text-accent-teal" : "text-ink hover:text-accent-teal"
                      )}
                    >
                      {s.label}
                    </span>
                    {on && (
                      <span className="md-live-dot" style={{ background: "var(--color-accent-teal)" }} />
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Secondary + account. */}
        <div
          className="mt-auto border-t border-line pt-5"
          style={{ animation: reduced ? "none" : `md-nav-line 700ms ${ease} ${0.08 + surfaces.length * 0.06}s both` }}
        >
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            {secondary.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                onClick={onClose}
                className="md-underline text-sm font-semibold text-ink-2 hover:text-ink"
              >
                {l.label}
              </Link>
            ))}
            {session && (
              <button
                type="button"
                onClick={() => { onClose(); onSignOut(); }}
                className="md-underline text-sm font-semibold text-ink-3 hover:text-ink"
              >
                Sign out
              </button>
            )}
            <span className="md-eyebrow ml-auto hidden sm:block">Anyone can compete</span>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes md-nav-in {
          from { clip-path: inset(0 0 100% 0); }
          to   { clip-path: inset(0 0 0 0); }
        }
        @keyframes md-nav-line {
          from { transform: translate3d(0, 105%, 0); opacity: 0; }
          to   { transform: translate3d(0, 0, 0); opacity: 1; }
        }
        /* No reduced-motion block here on purpose: this component already
           reads the preference in JS and emits an inline animation:none,
           and index.css carries a global backstop. A third rule keyed to a
           selector this markup does not use would be dead code pretending
           to be a safeguard. */
      `}</style>
    </div>
  );
}
