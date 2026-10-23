import { useId, useMemo, useRef, useState } from "react";
import { Flame, TrendingUp, ShieldCheck, Shuffle, Zap, Swords, Trophy, Crown, Activity } from "lucide-react";
import { cx } from "../../lib/engines";

/* MatchDay Pulse — shared presentation.

   Side A is always teal and side B always orange, on every surface: the bar,
   the chart, the moments and the share card. Teal/orange stays separable
   under the common colour-vision deficiencies, and a spectator glancing from
   the venue TV to their phone should never have to re-learn which colour is
   whose. Every number shown here is passed in; nothing is computed or
   rounded up for effect in this file. */

import { SIDE_COLOR } from "./colors";
const pct = (x) => `${Math.round(x * 100)}%`;

/* ── Rating chip ─────────────────────────────────────────────────────────── */

export function RatingChip({ rating, provisional, delta, className, size = "sm" }) {
  if (!rating) return null;
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full border border-line bg-surface-2 font-semibold tabular-nums",
        size === "lg" ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-[11px]",
        className
      )}
      title={provisional ? "Provisional — still settling after only a few rated matches" : "MatchDay Rating, verified from officiated matches"}
    >
      <Activity size={size === "lg" ? 13 : 10} className="text-accent-teal" aria-hidden="true" />
      <span className="text-ink-3">MDR</span>
      <span className="text-ink">{rating}</span>
      {provisional && <span className="text-ink-3">· prov.</span>}
      {delta != null && delta !== 0 && (
        <span className={delta > 0 ? "text-accent-teal" : "text-accent-orange"}>
          {delta > 0 ? `+${delta}` : delta}
        </span>
      )}
    </span>
  );
}

/* ── Win probability bar ─────────────────────────────────────────────────── */

export function WinProbabilityBar({ nameA, nameB, pA, basis, label = "Live win probability", className }) {
  if (pA == null) return null;
  const a = Math.min(0.99, Math.max(0.01, pA));
  return (
    <div className={cx("md-card p-4", className)} aria-live="polite">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <span className="md-eyebrow flex items-center gap-1.5">
          <Activity size={12} className="text-accent-teal" aria-hidden="true" /> {label}
        </span>
        <span className="text-[10px] text-ink-3">
          {basis === "ratings" ? "From MatchDay Ratings + live score" : "From the live score (a side is unrated)"}
        </span>
      </div>
      <div className="mb-1.5 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="md-score text-3xl" style={{ color: SIDE_COLOR.A }}>{pct(pA)}</div>
          <div className="truncate text-xs text-ink-2">{nameA}</div>
        </div>
        <div className="min-w-0 text-right">
          <div className="md-score text-3xl" style={{ color: SIDE_COLOR.B }}>{pct(1 - pA)}</div>
          <div className="truncate text-xs text-ink-2">{nameB}</div>
        </div>
      </div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-3" role="img" aria-label={`${nameA} ${pct(pA)}, ${nameB} ${pct(1 - pA)}`}>
        <div className="h-full transition-[width] duration-500 ease-out" style={{ width: `${a * 100}%`, background: SIDE_COLOR.A }} />
        <div className="h-full flex-1" style={{ background: SIDE_COLOR.B }} />
      </div>
    </div>
  );
}

/* ── Momentum chart ──────────────────────────────────────────────────────── */

const W = 640, H = 170, PAD_Y = 14;

/**
 * Win probability after every rally, drawn as a "worm" around the 50% line:
 * above the line is side A's territory, below is side B's. Game boundaries
 * are marked. Pointer or keyboard selects a rally and reads out its score.
 */
export function MomentumChart({ series, nameA, nameB, className }) {
  const [hover, setHover] = useState(null);
  const ref = useRef(null);
  // Unique per chart: two charts on one screen must not share clip paths.
  const clip = `md-pulse-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const geo = useMemo(() => {
    if (!series || series.length < 2) return null;
    const n = series.length - 1;
    const x = (i) => (i / n) * W;
    const y = (p) => PAD_Y + (1 - p) * (H - 2 * PAD_Y);
    const line = series.map((s, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(s.pA).toFixed(1)}`).join(" ");
    const area = `${line} L${W},${H / 2} L0,${H / 2} Z`;
    const games = [];
    series.forEach((s, i) => { if (i > 0 && s.game !== series[i - 1].game) games.push({ i: i - 1, game: s.game }); });
    return { x, y, line, area, games, n };
  }, [series]);

  if (!geo) return null;
  const sel = hover != null ? series[hover] : series[series.length - 1];

  const pick = (clientX) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const i = Math.round(((clientX - r.left) / r.width) * geo.n);
    setHover(Math.max(0, Math.min(geo.n, i)));
  };

  return (
    <div className={cx("md-card p-4", className)}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="md-eyebrow">Momentum · win probability by rally</span>
        <span className="font-mono text-[11px] tabular-nums text-ink-2">
          {sel.index === 0 ? "Before the first rally" : `Rally ${sel.index} · G${sel.game} ${sel.a}–${sel.b}`}
          {" · "}
          <span style={{ color: sel.pA >= 0.5 ? SIDE_COLOR.A : SIDE_COLOR.B }}>
            {sel.pA >= 0.5 ? `${nameA} ${pct(sel.pA)}` : `${nameB} ${pct(1 - sel.pA)}`}
          </span>
        </span>
      </div>
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="block h-40 w-full touch-none select-none outline-none"
        role="img"
        tabIndex={0}
        aria-label={`Win probability over ${geo.n} rallies. Use arrow keys to step through.`}
        onPointerMove={(e) => pick(e.clientX)}
        onPointerDown={(e) => pick(e.clientX)}
        onPointerLeave={() => setHover(null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? geo.n) - 1));
          if (e.key === "ArrowRight") setHover((h) => Math.min(geo.n, (h ?? geo.n) + 1));
        }}
      >
        <defs>
          <clipPath id={`${clip}-top`}><rect x="0" y="0" width={W} height={H / 2} /></clipPath>
          <clipPath id={`${clip}-bottom`}><rect x="0" y={H / 2} width={W} height={H / 2} /></clipPath>
        </defs>
        <path d={geo.area} fill={SIDE_COLOR.A} opacity="0.22" clipPath={`url(#${clip}-top)`} />
        <path d={geo.area} fill={SIDE_COLOR.B} opacity="0.22" clipPath={`url(#${clip}-bottom)`} />
        <line x1="0" x2={W} y1={H / 2} y2={H / 2} stroke="var(--color-line)" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
        {geo.games.map((g) => (
          <g key={g.i}>
            <line x1={geo.x(g.i)} x2={geo.x(g.i)} y1="0" y2={H} stroke="var(--color-line)" vectorEffect="non-scaling-stroke" />
          </g>
        ))}
        <path d={geo.line} fill="none" stroke="var(--color-ink)" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {hover != null && (
          <line x1={geo.x(hover)} x2={geo.x(hover)} y1="0" y2={H} stroke="var(--color-ink-3)" vectorEffect="non-scaling-stroke" />
        )}
        <circle cx={geo.x(sel.index)} cy={geo.y(sel.pA)} r="4.5" fill={sel.pA >= 0.5 ? SIDE_COLOR.A : SIDE_COLOR.B} stroke="var(--color-surface)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-1.5 flex justify-between text-[10px] font-semibold uppercase tracking-wide">
        <span style={{ color: SIDE_COLOR.A }}>▲ {nameA}</span>
        <span className="text-ink-3">
          {geo.games.length ? geo.games.map((g) => `G${g.game} from rally ${g.i + 1}`).join(" · ") : "Game 1"}
        </span>
        <span style={{ color: SIDE_COLOR.B }}>▼ {nameB}</span>
      </div>
    </div>
  );
}

/* ── Match Story moments ─────────────────────────────────────────────────── */

const MOMENT_ICON = {
  run: Flame, comeback: TrendingUp, swings: Shuffle, lowpoint: Zap, decider: Trophy, dominant: Crown,
};
const iconFor = (key) => MOMENT_ICON[key] || (key.startsWith("mp-") || key.startsWith("gp-") ? ShieldCheck : Swords);

export function MatchMoments({ moments, nameA, nameB, limit = 4, className }) {
  if (!moments?.length) return null;
  return (
    <div className={cx("grid gap-2 sm:grid-cols-2", className)}>
      {moments.slice(0, limit).map((m) => {
        const Icon = iconFor(m.key);
        const color = m.side ? SIDE_COLOR[m.side] : "var(--color-accent-yellow)";
        return (
          <div key={m.key} className="md-card md-edge flex items-start gap-3 p-3.5 pl-4" style={{ "--md-edge": color }}>
            <Icon size={18} className="mt-0.5 shrink-0" style={{ color }} aria-hidden="true" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-ink">{m.title}</div>
              <div className="mt-0.5 text-xs text-ink-2">
                {m.side && <span className="font-semibold" style={{ color }}>{m.side === "A" ? nameA : nameB} · </span>}
                {m.detail}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
