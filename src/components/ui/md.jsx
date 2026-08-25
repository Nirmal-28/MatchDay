/* ═══════════════════════════════════════════════════════════════════════
   MATCHDAY COMPONENT LIBRARY
   ═══════════════════════════════════════════════════════════════════════

   The pieces that make MatchDay look like MatchDay rather than like a
   Tailwind starter. Two of these carry most of the weight:

     <MatchCard/>       one match, rendered identically on the player
                        dashboard, the public tournament page, Match Center,
                        the organizer's list and the venue display. Before
                        this, each of those five surfaces drew its own match
                        row, so a live match looked like a different thing
                        depending on where you saw it.

     <TournamentCard/>  one tournament, likewise shared by discovery, a
                        player's list and an organizer's list.

   Everything else here (section headers, stat tiles, tabs, skeletons) exists
   so a page can be composed out of the system instead of ad-hoc div stacks.

   Presentation only. No component in this file fetches, writes or decides
   permissions — callers pass already-authorised data down.
   ══════════════════════════════════════════════════════════════════════ */

import { Link } from "react-router-dom";
import { MapPin, Clock, Users } from "lucide-react";
import { cx } from "../../lib/engines";
import { SportIcon } from "./motion";

/* ── Sport identity ──────────────────────────────────────────────────────
   A sport's accent colour, used for the card's leading court line and its
   glyph. Keyed to the same sport keys as lib/sports — adding a sport means
   adding a colour here, not touching any card. */
export const SPORT_ACCENT = {
  badminton: "var(--color-accent-teal)",
  tennis: "var(--color-accent-yellow)",
  pickleball: "var(--color-accent-orange)",
  tableTennis: "var(--color-accent-pink)",
  volleyball: "var(--color-accent-blue)",
  basketball: "var(--color-accent-orange)",
  football: "var(--color-accent-teal)",
  cricket: "var(--color-accent-purple)",
  squash: "var(--color-accent-purple)",
};
export const sportAccent = (key) => SPORT_ACCENT[key] || "var(--color-accent-teal)";

/* ── Status vocabulary ───────────────────────────────────────────────────
   One place that maps a raw status string to what the user reads and the
   colour it reads in. Every surface therefore says "LIVE" in the same red
   and "COMPLETED" in the same blue. */
const MATCH_STATUS = {
  live:      { label: "Live",       cls: "md-status-live" },
  in_progress:{ label: "Live",      cls: "md-status-live" },
  paused:    { label: "Paused",     cls: "md-status-closing" },
  delayed:   { label: "Delayed",    cls: "md-status-closing" },
  check_in:  { label: "Check in",   cls: "md-status-closing" },
  disputed:  { label: "Disputed",   cls: "md-status-closing" },
  completed: { label: "Final",      cls: "md-status-done" },
  scheduled: { label: "Upcoming",   cls: "md-status-full" },
  pending:   { label: "Upcoming",   cls: "md-status-full" },
};

export function matchStatusMeta(status) {
  return MATCH_STATUS[status] || { label: status || "Upcoming", cls: "md-status-full" };
}

export function StatusPill({ status, children, className }) {
  const meta = matchStatusMeta(status);
  const isLive = meta.cls === "md-status-live";
  return (
    <span className={cx("md-status", meta.cls, className)}>
      {isLive && <span className="md-live-dot" />}
      {children || meta.label}
    </span>
  );
}

/* ── Section header ──────────────────────────────────────────────────────
   The court-line rule + condensed title. Used at the top of every block so
   the page reads as a sequence of named sections rather than a wall. */
export function SectionHeader({ title, eyebrow, action, className, id }) {
  return (
    <div className={cx("mb-3 flex items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        {eyebrow && <div className="md-eyebrow mb-1">{eyebrow}</div>}
        <h2 id={id} className="md-display md-h3 md-rule text-ink">{title}</h2>
      </div>
      {action && <div className="shrink-0 pb-1">{action}</div>}
    </div>
  );
}

/* ── Stat tile ───────────────────────────────────────────────────────────
   A single number with its label. Deliberately plain: the number is the
   design. `tone` tints the value when it means something (a delay, an
   unresolved dispute) and is left off when it does not. */
export function StatTile({ label, value, sub, tone, className }) {
  const toneColor = {
    live: "var(--color-live)",
    open: "var(--color-open)",
    closing: "var(--color-closing)",
    done: "var(--color-done)",
  }[tone];
  return (
    <div className={cx("md-card px-3.5 py-3", className)}>
      <div className="md-eyebrow">{label}</div>
      <div
        className="md-score mt-1.5 text-3xl text-ink"
        style={toneColor ? { color: toneColor } : undefined}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[11px] text-ink-3">{sub}</div>}
    </div>
  );
}

/* ── Skeletons ───────────────────────────────────────────────────────────
   Shaped like the content they stand in for, so the page does not reflow
   when data lands. */
export function Skeleton({ className }) {
  return <div className={cx("md-skeleton", className)} aria-hidden="true" />;
}

export function CardSkeletonGrid({ count = 6, className }) {
  return (
    <div className={cx("grid gap-3 sm:grid-cols-2 lg:grid-cols-3", className)} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="md-card space-y-3 p-4">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-8 w-full" />
        </div>
      ))}
    </div>
  );
}

/* ── Segmented tabs ──────────────────────────────────────────────────────
   Scrolls horizontally on a phone rather than wrapping into three rows or
   shrinking the labels to unreadable.

   Deliberately NOT role="tablist"/role="tab". That pattern promises a
   matching role="tabpanel" with `aria-controls` wiring, and these switch
   content rendered by the caller outside this component — announcing them
   as tabs would tell a screen-reader user to expect a panel relationship
   that does not exist. A labelled group of pressed/unpressed buttons is
   what these actually are, and it announces correctly. */
export function Tabs({ tabs, value, onChange, className, ariaLabel = "Sections" }) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cx("md-rail -mx-4 border-b border-line px-4", className)}
    >
      {tabs.map((t) => {
        const on = t.key === value;
        return (
          <button
            key={t.key}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(t.key)}
            className={cx(
              "relative whitespace-nowrap px-3 py-2.5 text-sm font-semibold transition-colors",
              on ? "text-ink" : "text-ink-3 hover:text-ink-2"
            )}
          >
            {t.label}
            {t.count != null && (
              <span className="ml-1.5 text-[11px] font-bold text-ink-3">{t.count}</span>
            )}
            {/* The active court line, drawn on the tab rather than under the
                whole strip so it moves with the scroll. */}
            {on && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent-teal" />}
          </button>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   MATCH CARD — the signature component
   ═══════════════════════════════════════════════════════════════════════

   Three densities, one design:

     "compact"  a row in a long list (organizer, results tables)
     "default"  the standard card (dashboards, tournament pages)
     "hero"     one match, given the whole width (player's next match,
                Match Center's featured live match)

   A LIVE match is distinguished by surface and colour, not by movement:
   a red leading court line, a tinted panel, and a pulsing dot that is the
   only looping animation in the product.
   ══════════════════════════════════════════════════════════════════════ */

function SideRow({ name, score, serving, won, size }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        {/* Service indicator: which side is on serve is live information a
            spectator cannot get anywhere else on the card. */}
        {serving && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-teal" aria-label="Serving" />}
        <span
          className={cx(
            "truncate",
            size === "hero" ? "text-lg font-semibold sm:text-xl" : "text-sm font-medium",
            won === false ? "text-ink-3" : "text-ink"
          )}
        >
          {name}
        </span>
      </div>
      {score != null && (
        <span
          className={cx(
            "md-score shrink-0",
            size === "hero" ? "text-3xl sm:text-4xl" : "text-xl",
            won ? "text-ink" : "text-ink-2"
          )}
        >
          {score}
        </span>
      )}
    </div>
  );
}

/**
 * @param {object}  match     normalised shape, all fields optional:
 *   { id, status, sideA:{name,score,serving,won}, sideB:{…}, court,
 *     time, round, event, games:[{a,b}], sport, note }
 * @param {"compact"|"default"|"hero"} size
 * @param {string}  to        wraps the card in a link when provided
 * @param {node}    action    a CTA rendered in the card's footer
 */
export function MatchCard({ match, size = "default", to, action, className }) {
  const status = match.status || "scheduled";
  const meta = matchStatusMeta(status);
  const isLive = meta.cls === "md-status-live";
  const edge = isLive ? "var(--color-live)" : sportAccent(match.sport);

  const body = (
    <div
      className={cx(
        "md-card md-edge h-full",
        to && "md-card-link",
        isLive && "md-live-surface",
        size === "compact" ? "px-3.5 py-2.5 pl-5" : "p-4 pl-5",
        size === "hero" && "sm:p-6 sm:pl-7",
        className
      )}
      style={{ "--md-edge": edge }}
    >
      {/* Header: what and when. Court number is set in display type because
          on a phone at arm's length it is the thing a player is hunting for. */}
      <div className="mb-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <StatusPill status={status} />
        {match.round && (
          <span className="md-eyebrow text-ink-3">{match.round}</span>
        )}
        {match.event && (
          <span className="truncate text-[11px] text-ink-3">{match.event}</span>
        )}
        <span className="ml-auto flex items-center gap-3 text-[11px] text-ink-2">
          {match.time && (
            <span className="flex items-center gap-1">
              <Clock size={12} className="text-ink-3" aria-hidden="true" />
              {match.time}
            </span>
          )}
          {match.court && (
            <span className="md-display text-base leading-none text-ink">
              {match.court}
            </span>
          )}
        </span>
      </div>

      {/* The two sides. A divider line stands in for the net. */}
      <div className="space-y-2">
        <SideRow {...match.sideA} size={size} />
        <div className="flex items-center gap-2">
          <span className="h-px flex-1 bg-line-soft" />
          <span className="md-eyebrow text-[9px] text-ink-3">vs</span>
          <span className="h-px flex-1 bg-line-soft" />
        </div>
        <SideRow {...match.sideB} size={size} />
      </div>

      {/* Per-game breakdown — the detail that makes a completed match
          readable ("21-18, 19-21, 21-14") instead of just a winner. */}
      {match.games?.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {match.games.map((g, i) => (
            <span
              key={i}
              className="md-score rounded bg-surface-2 px-1.5 py-0.5 text-xs text-ink-2"
            >
              {g.a}–{g.b}
            </span>
          ))}
        </div>
      )}

      {match.note && <div className="mt-2 text-[11px] text-ink-3">{match.note}</div>}

      {action && <div className="mt-3.5">{action}</div>}
    </div>
  );

  return to ? <Link to={to} className="block h-full">{body}</Link> : body;
}

/* ═══════════════════════════════════════════════════════════════════════
   TOURNAMENT CARD
   ═══════════════════════════════════════════════════════════════════════
   Answers, in reading order, the questions discovery is actually for:
   what sport · what is it called · when · where · can I still get in.

   The capacity bar is drawn only when real capacity data exists. There is
   deliberately no popularity, trending or attendance signal anywhere here —
   MatchDay does not have that data and inventing it would be a lie printed
   on the most trusted screen in the product.
   ══════════════════════════════════════════════════════════════════════ */

export function CapacityBar({ filled, capacity, className }) {
  if (!capacity || capacity <= 0 || filled == null) return null;
  const pct = Math.min(100, Math.round((filled / capacity) * 100));
  const nearlyFull = pct >= 85;
  const full = filled >= capacity;
  const color = full ? "var(--color-full)" : nearlyFull ? "var(--color-closing)" : "var(--color-open)";
  return (
    <div className={className}>
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span className="text-ink-3">{full ? "Full" : `${capacity - filled} spot${capacity - filled === 1 ? "" : "s"} left`}</span>
        <span className="text-ink-3 tabular-nums">{filled}/{capacity}</span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-surface-2"
        role="progressbar"
        aria-valuenow={filled}
        aria-valuemin={0}
        aria-valuemax={capacity}
        aria-label={`${filled} of ${capacity} places taken`}
      >
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

/**
 * @param {object} t  { id, slug, name, sport, sportLabel, dateLabel, venue,
 *                      location, level, fee, filled, capacity, status,
 *                      statusLabel, live }
 * @param {"default"|"featured"} variant
 */
export function TournamentCard({ t, variant = "default", className, footer }) {
  const accent = sportAccent(t.sport);
  const featured = variant === "featured";

  return (
    <Link
      to={t.slug ? `/t/${t.slug}` : `/t/${t.id}`}
      className={cx("group block h-full", className)}
    >
      <div
        className={cx(
          "md-card md-card-link md-edge flex h-full flex-col p-4 pl-5",
          featured && "md-hatch sm:p-5 sm:pl-6"
        )}
        style={{ "--md-edge": accent }}
      >
        {/* Sport first — it is the single most useful filter a browsing
            player applies, and the glyph reads faster than a word. */}
        <div className="mb-2.5 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <SportIcon sport={t.sport} className="h-5 w-5" style={{ color: accent }} />
            <span className="md-eyebrow" style={{ color: accent }}>{t.sportLabel || t.sport}</span>
          </div>
          {t.live ? (
            <StatusPill status="live" />
          ) : t.status ? (
            <span className={cx("md-status", `md-status-${t.status}`)}>{t.statusLabel || t.status}</span>
          ) : null}
        </div>

        <h3
          className={cx(
            "md-display md-clamp-2 text-ink transition-colors group-hover:text-accent-teal",
            featured ? "text-2xl sm:text-3xl" : "text-xl"
          )}
        >
          {t.name}
        </h3>

        <div className="mt-2.5 space-y-1 text-[13px] text-ink-2">
          {t.dateLabel && (
            <div className="flex items-center gap-1.5">
              <Clock size={13} className="shrink-0 text-ink-3" aria-hidden="true" />
              <span className="truncate">{t.dateLabel}</span>
            </div>
          )}
          {(t.venue || t.location) && (
            <div className="flex items-center gap-1.5">
              <MapPin size={13} className="shrink-0 text-ink-3" aria-hidden="true" />
              <span className="truncate">{[t.venue, t.location].filter(Boolean).join(" · ")}</span>
            </div>
          )}
          {t.level && (
            <div className="flex items-center gap-1.5">
              <Users size={13} className="shrink-0 text-ink-3" aria-hidden="true" />
              <span className="truncate">{t.level}</span>
            </div>
          )}
        </div>

        {/* Spacer pushes the capacity/fee footer to the bottom so a row of
            cards of different title lengths still aligns along its base. */}
        <div className="flex-1" />

        {/* A real, dated fact when there is one — never a manufactured
            urgency cue. Callers pass this only when the tournament actually
            has a registration deadline. */}
        {t.note && (
          <div className="mt-3 text-[11px] font-semibold" style={{ color: t.noteTone || "var(--color-closing)" }}>
            {t.note}
          </div>
        )}

        <CapacityBar filled={t.filled} capacity={t.capacity} className="mt-3.5" />

        {(t.fee != null || footer) && (
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-line-soft pt-3">
            {t.fee != null && (
              <span className="text-sm font-semibold text-ink">{t.fee}</span>
            )}
            {footer}
          </div>
        )}
      </div>
    </Link>
  );
}

/* ── Attention item ──────────────────────────────────────────────────────
   The organizer command center's core row: one thing that needs a human,
   with the action attached to it. Severity is colour, not an icon zoo. */
export function AttentionItem({ severity = "closing", title, detail, action, className }) {
  const color = {
    live: "var(--color-live)",
    closing: "var(--color-closing)",
    open: "var(--color-open)",
    done: "var(--color-done)",
  }[severity] || "var(--color-closing)";

  return (
    <div
      className={cx("md-card md-edge flex flex-wrap items-center gap-3 px-4 py-3 pl-5", className)}
      style={{ "--md-edge": color }}
    >
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-ink">{title}</div>
        {detail && <div className="mt-0.5 text-[12px] text-ink-2">{detail}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/* ── Page hero ───────────────────────────────────────────────────────────
   Shared frame for the top of a major page: eyebrow, condensed headline,
   supporting line, actions — over the static court texture. */
export function PageHero({ eyebrow, title, lead, actions, children, className }) {
  return (
    <section
      className={cx(
        "md-court-texture relative overflow-hidden rounded-2xl border border-line bg-gradient-to-b from-navy-800 to-surface px-5 py-8 sm:px-8 sm:py-12",
        className
      )}
    >
      {eyebrow && <div className="md-eyebrow mb-2.5 text-accent-teal">{eyebrow}</div>}
      {title && <h1 className="md-display md-h1 max-w-3xl text-ink">{title}</h1>}
      {lead && <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-ink-2">{lead}</p>}
      {actions && <div className="mt-6 flex flex-wrap gap-2.5">{actions}</div>}
      {children}
    </section>
  );
}
