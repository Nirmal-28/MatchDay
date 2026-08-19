import { useState } from "react";
import { X, AlertCircle, CheckCircle2 } from "lucide-react";
import { cx, TONE_CLASSES } from "../../lib/engines";

export function Badge({ tone = "slate", children, className }) {
  return (
    <span className={cx("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide", TONE_CLASSES[tone], className)}>
      {children}
    </span>
  );
}

export function Btn({ children, variant = "primary", size = "md", className, icon: Icon, ...props }) {
  const base = "inline-flex items-center justify-center gap-1.5 font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed rounded-md";
  const sizes = { sm: "px-2.5 py-1.5 text-xs", md: "px-3.5 py-2 text-sm", lg: "px-5 py-2.5 text-sm" };
  const variants = {
    primary: "bg-teal-700 text-white hover:bg-teal-800",
    secondary: "bg-white text-stone-800 border border-stone-300 hover:bg-stone-50",
    ghost: "text-stone-600 hover:bg-stone-100",
    danger: "bg-red-600 text-white hover:bg-red-700",
    subtle: "bg-stone-100 text-stone-700 hover:bg-stone-200",
  };
  return (
    <button className={cx(base, sizes[size], variants[variant], className)} {...props}>
      {Icon && <Icon size={size === "sm" ? 14 : 16} />}
      {children}
    </button>
  );
}

export function Card({ children, className, ...props }) {
  return <div className={cx("rounded-lg border border-stone-200 bg-white", className)} {...props}>{children}</div>;
}

export function Eyebrow({ children }) {
  return <div className="text-[11px] font-semibold uppercase tracking-widest text-teal-700">{children}</div>;
}

export function EmptyState({ icon: Icon, title, hint, action }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-stone-300 px-6 py-14 text-center">
      {Icon && <Icon size={28} className="text-stone-300 mb-1" />}
      <div className="text-sm font-semibold text-stone-700">{title}</div>
      {hint && <div className="max-w-sm text-sm text-stone-500">{hint}</div>}
      {action}
    </div>
  );
}

export function Modal({ open, onClose, title, children, width = "max-w-lg" }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 p-4" onClick={onClose}>
      <div className={cx("max-h-[90vh] w-full overflow-y-auto rounded-lg bg-white shadow-xl", width)} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-stone-200 px-5 py-4">
          <h3 className="font-semibold text-stone-900">{title}</h3>
          <button onClick={onClose} className="rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700"><X size={18} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, children, hint, required }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-stone-600">{label}{required && <span className="text-red-500"> *</span>}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-stone-400">{hint}</span>}
    </label>
  );
}

export const inputCls = "w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder-stone-400 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600";

export function ScoreDigits({ a, b, winner }) {
  return (
    <div className="flex items-center gap-1 font-mono text-sm tabular-nums">
      <span className={cx("rounded px-1.5 py-0.5", winner === "A" ? "bg-teal-700 text-white font-bold" : "text-stone-700")}>{a}</span>
      <span className="text-stone-300">–</span>
      <span className={cx("rounded px-1.5 py-0.5", winner === "B" ? "bg-teal-700 text-white font-bold" : "text-stone-700")}>{b}</span>
    </div>
  );
}

export function Toasts({ toasts }) {
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} className={cx(
          "pointer-events-auto flex items-center gap-2 rounded-md border px-3.5 py-2.5 text-sm shadow-lg animate-[fadein_.15s_ease-out]",
          t.kind === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"
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
