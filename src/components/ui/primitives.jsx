import { useEffect, useId, useRef, useState } from "react";
import { X, AlertCircle, CheckCircle2 } from "lucide-react";
import { cx, TONE_CLASSES } from "../../lib/engines";

export function Badge({ tone = "slate", children, className }) {
  return (
    <span className={cx("inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide", TONE_CLASSES[tone], className)}>
      {children}
    </span>
  );
}

export function Btn({ children, variant = "primary", size = "md", className, icon: Icon, ...props }) {
  const base = "inline-flex items-center justify-center gap-1.5 font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed rounded-md";
  const sizes = { sm: "px-2.5 py-1.5 text-xs", md: "px-3.5 py-2 text-sm", lg: "px-5 py-2.5 text-sm" };
  const variants = {
    primary: "bg-accent-teal text-navy-950 font-semibold hover:brightness-110",
    secondary: "bg-surface-2 text-ink border border-line hover:bg-surface-3",
    ghost: "text-ink-2 hover:bg-surface-2 hover:text-ink",
    danger: "bg-red-600 text-white hover:bg-red-500",
    subtle: "bg-surface-2 text-ink-2 hover:bg-surface-3",
  };
  return (
    <button className={cx(base, sizes[size], variants[variant], className)} {...props}>
      {Icon && <Icon size={size === "sm" ? 14 : 16} />}
      {children}
    </button>
  );
}

export function Card({ children, className, ...props }) {
  return <div className={cx("rounded-lg border border-line bg-surface", className)} {...props}>{children}</div>;
}

export function Eyebrow({ children }) {
  return <div className="text-[11px] font-semibold uppercase tracking-widest text-accent-teal">{children}</div>;
}

export function EmptyState({ icon: Icon, title, hint, action }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line px-6 py-14 text-center">
      {Icon && <Icon size={28} className="text-ink-3 mb-1" />}
      <div className="text-sm font-semibold text-ink">{title}</div>
      {hint && <div className="max-w-sm text-sm text-ink-2">{hint}</div>}
      {action}
    </div>
  );
}

// Every modal in the app renders through this one, so the accessibility rules
// live here rather than being re-implemented (or forgotten) at each call site:
//
//   - Escape closes it. Previously the only way out was finding the X, which
//     on a phone can be off-screen inside a scrolled dialog.
//   - Focus moves into the dialog on open and returns to whatever opened it on
//     close, so a keyboard user is not dumped back at the top of the page.
//   - Tab is trapped inside. Without this, tabbing walks out of the dialog and
//     into the page behind it, which a screen reader still announces even
//     though it is visually covered.
//   - role="dialog" + aria-modal + aria-labelledby, so it is announced as a
//     dialog with a name instead of an anonymous group of text.
//   - Background scrolling is locked, which on iOS otherwise scrolls the page
//     behind the dialog as soon as the dialog itself hits its end.
export function Modal({ open, onClose, title, children, width = "max-w-lg" }) {
  const panelRef = useRef(null);
  const restoreRef = useRef(null);
  // useId, not a module counter — it is stable across re-renders, unique per
  // instance, and does not read a ref during render.
  const titleId = `modal-title-${useId()}`;

  useEffect(() => {
    if (!open) return;

    restoreRef.current = document.activeElement;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    // Focus the first thing worth focusing; fall back to the panel itself so
    // focus is never left behind on the page underneath.
    const focusables = () =>
      panelRef.current?.querySelectorAll(
        'a[href], button:not([disabled]), textarea, input:not([disabled]), select, [tabindex]:not([tabindex="-1"])'
      ) ?? [];
    const first = focusables()[0];
    (first || panelRef.current)?.focus();

    const onKeyDown = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose?.(); return; }
      if (e.key !== "Tab") return;

      const items = Array.from(focusables());
      if (!items.length) { e.preventDefault(); return; }
      const firstItem = items[0];
      const lastItem = items[items.length - 1];

      // Wrap at both ends rather than letting focus escape the dialog.
      if (e.shiftKey && document.activeElement === firstItem) {
        e.preventDefault(); lastItem.focus();
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault(); firstItem.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = overflow;
      restoreRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cx("max-h-[90vh] w-full overflow-y-auto rounded-lg border border-line bg-surface shadow-2xl outline-none", width)}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h3 id={titleId} className="font-semibold text-ink">{title}</h3>
          <button
            type="button" onClick={onClose} aria-label="Close dialog"
            className="rounded p-1 text-ink-3 hover:bg-surface-2 hover:text-ink"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, children, hint, required }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink-2">{label}{required && <span className="text-red-400"> *</span>}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-ink-3">{hint}</span>}
    </label>
  );
}

export const inputCls = "w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-ink placeholder-ink-3 focus:border-accent-teal focus:outline-none focus:ring-1 focus:ring-accent-teal";

export function ScoreDigits({ a, b, winner }) {
  return (
    <div className="flex items-center gap-1 font-mono text-sm tabular-nums">
      <span className={cx("rounded px-1.5 py-0.5", winner === "A" ? "bg-accent-teal text-navy-950 font-bold" : "text-ink-2")}>{a}</span>
      <span className="text-ink-3">–</span>
      <span className={cx("rounded px-1.5 py-0.5", winner === "B" ? "bg-accent-teal text-navy-950 font-bold" : "text-ink-2")}>{b}</span>
    </div>
  );
}

export function Toasts({ toasts }) {
  return (
    // A live region, so a confirmation ("Draw generated") is announced rather
    // than only appearing in a corner a screen reader user never looks at.
    // "polite" because none of these interrupt anything urgent.
    <div
      role="status" aria-live="polite" aria-atomic="false"
      className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col gap-2"
    >
      {toasts.map((t) => (
        <div key={t.id} className={cx(
          "pointer-events-auto flex items-center gap-2 rounded-md border px-3.5 py-2.5 text-sm shadow-lg animate-[fadein_.15s_ease-out]",
          t.kind === "error" ? "border-red-500/40 bg-red-950/80 text-red-200" : "border-emerald-500/40 bg-emerald-950/80 text-emerald-200"
        )}>
          {t.kind === "error" ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
          {t.message}
        </div>
      ))}
    </div>
  );
}

let toastId = 0;
export function useToasts() {
  const [toasts, setToasts] = useState([]);
  const notify = (message, kind = "success") => {
    const id = ++toastId;
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  };
  return { toasts, notify };
}
