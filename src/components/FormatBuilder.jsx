import { useState } from "react";
import { Swords, Lock, Info } from "lucide-react";
import { cx, FORMAT_META, divisionLabel, nextPow2 } from "../lib/engines";
import { updateEvent } from "../lib/repository";
import { Badge, Card, Field, inputCls } from "../components/ui/primitives";

/* Format configuration for one category, editable right up until the draw is
   generated. Every option here is backed by a real generator in
   repository.js — generateDraw (seeded single elimination with byes),
   generateRoundRobin (circle method), generateGroupStage +
   generateKnockoutFromGroups (snake-seeded groups feeding a knockout). There
   is deliberately no option for a format the engine cannot actually produce.

   Sport-specific rules stay out of this component: it configures the generic
   tournament structure, and the sport's scoring engine handles what happens
   inside a match. */

// What each format needs before it can produce a sensible draw.
export function minEntriesFor(event) {
  const format = event.format || "SINGLE_ELIM";
  if (format === "ROUND_ROBIN") return 3;
  if (format === "GROUP_KO") return (event.group_count || 2) * 2;
  return 2;
}

function Preview({ event, confirmedCount }) {
  const format = event.format || "SINGLE_ELIM";
  const n = confirmedCount;

  if (n < minEntriesFor(event)) {
    return <span>Needs at least {minEntriesFor(event)} confirmed entries — {n} so far.</span>;
  }
  if (format === "ROUND_ROBIN") {
    const rounds = n % 2 === 0 ? n - 1 : n;
    return <span>{n} entries · everyone plays everyone · {(n * (n - 1)) / 2} matches over {rounds} rounds.</span>;
  }
  if (format === "GROUP_KO") {
    const groups = event.group_count || 2;
    const advance = event.advance_per_group || 2;
    const per = Math.floor(n / groups);
    const groupMatches = groups * ((per * (per - 1)) / 2);
    const koField = groups * advance;
    return (
      <span>
        {n} entries · {groups} groups of about {per} · ~{groupMatches} group matches ·
        top {advance} from each group go into a {nextPow2(koField)}-slot knockout.
      </span>
    );
  }
  const size = nextPow2(n);
  return <span>{n} entries · {size}-slot bracket · {size - n} bye{size - n === 1 ? "" : "s"} · {n - 1} matches.</span>;
}

export default function FormatBuilder({ event, confirmedCount, locked, notify, onChanged }) {
  const [saving, setSaving] = useState(false);
  const format = event.format || "SINGLE_ELIM";

  const patch = async (p) => {
    setSaving(true);
    try { await updateEvent(event.id, p); await onChanged?.(); }
    catch (e) { notify?.(e.message, "error"); }
    finally { setSaving(false); }
  };

  if (locked) {
    return (
      <Card className="flex flex-wrap items-center justify-between gap-2 p-3.5">
        <div className="flex items-center gap-2">
          <Lock size={14} className="text-ink-3" />
          <span className="text-sm text-ink-2">Format locked at <span className="font-medium text-ink">{FORMAT_META[format].label}</span> — the draw has been generated.</span>
        </div>
        <Badge tone="teal">{FORMAT_META[format].label}</Badge>
      </Card>
    );
  }

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center gap-1.5 md-eyebrow">
        <Swords size={13} /> Format for {divisionLabel(event)}
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        {Object.entries(FORMAT_META).map(([key, meta]) => (
          <button
            key={key} type="button" disabled={saving}
            onClick={() => patch({
              format: key,
              // Group settings only make sense for GROUP_KO; clearing them
              // keeps the row honest for the other two formats.
              group_count: key === "GROUP_KO" ? (event.group_count || 2) : null,
              advance_per_group: key === "GROUP_KO" ? (event.advance_per_group || 2) : 2,
            })}
            className={cx(
              "rounded-lg border p-3 text-left transition-colors disabled:opacity-50",
              format === key ? "border-accent-teal bg-accent-teal/10" : "border-line bg-surface-2 hover:bg-surface-3"
            )}
          >
            <div className={cx("text-sm font-semibold", format === key ? "text-accent-teal" : "text-ink")}>{meta.label}</div>
            <div className="mt-0.5 text-[11px] leading-snug text-ink-2">{meta.hint}</div>
          </button>
        ))}
      </div>

      {format === "GROUP_KO" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Number of groups">
            <select className={inputCls} value={event.group_count || 2} disabled={saving}
              onChange={(e) => patch({ group_count: Number(e.target.value) })}>
              {[2, 3, 4, 6, 8].map((n) => <option key={n} value={n}>{n} groups</option>)}
            </select>
          </Field>
          <Field label="Advance from each group">
            <select className={inputCls} value={event.advance_per_group || 2} disabled={saving}
              onChange={(e) => patch({ advance_per_group: Number(e.target.value) })}>
              {[1, 2, 3, 4].map((n) => <option key={n} value={n}>Top {n}</option>)}
            </select>
          </Field>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Maximum entries" hint="Registrations past this go to the waitlist.">
          <input type="number" min="2" className={inputCls} defaultValue={event.max_entries} disabled={saving}
            onBlur={(e) => Number(e.target.value) !== event.max_entries && patch({ max_entries: Number(e.target.value) })} />
        </Field>
        <Field label="Entry fee (₹)">
          <input type="number" min="0" className={inputCls} defaultValue={event.fee_inr} disabled={saving}
            onBlur={(e) => Number(e.target.value) !== Number(event.fee_inr) && patch({ fee_inr: Number(e.target.value) })} />
        </Field>
      </div>

      <div className="flex gap-2 rounded-md border border-line bg-surface-2 px-3 py-2.5 text-[11px] leading-relaxed text-ink-2">
        <Info size={13} className="mt-px shrink-0 text-ink-3" />
        <span><Preview event={event} confirmedCount={confirmedCount} /></span>
      </div>

      <p className="text-[11px] text-ink-3">
        Seeding is set below and is honoured by all three formats — a seeded knockout spreads seeds through the
        bracket so the top two can only meet in the final, and groups are snake-seeded so the strongest entries
        are split across them.
      </p>
    </Card>
  );
}
