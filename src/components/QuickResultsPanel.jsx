import { useMemo, useState } from "react";
import { ClipboardCheck, Search } from "lucide-react";
import { cx, entryShort, matchStageLabel, parseGroupLabel, parseResult, divisionLabel, isVoidMatch } from "../lib/engines";
import { Btn, Badge, inputCls } from "./ui/primitives";

/* For the organizer running every court alone: players keep score on paper,
   hand in the slip, and the result goes in here in one line — "21-15 21-18" —
   instead of tapping every rally. Lists every unplayed match whose players
   are known, scheduled or not, so it works without the Schedule step. */

const done = (m) => m.status === "COMPLETED" || m.status === "WALKOVER";

function sortKey(m) {
  const { stage, group } = m.group_label ? parseGroupLabel(m.group_label) : { stage: 99, group: "" };
  return [stage, group, m.round ?? 0, m.match_number ?? 0];
}
const byKey = (a, b) => {
  const x = sortKey(a), y = sortKey(b);
  for (let i = 0; i < x.length; i++) {
    if (x[i] < y[i]) return -1;
    if (x[i] > y[i]) return 1;
  }
  return 0;
};

function ResultRow({ match, event, entriesById, onSave, onVoid }) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const a = entryShort(entriesById[match.entry_a]);
  const b = entryShort(entriesById[match.entry_b]);
  const { games, error } = parseResult(text);
  const ok = games.length > 0 && !error;
  const wonA = games.filter((g) => g.a > g.b).length;
  const preview = ok ? `${wonA * 2 > games.length ? a : b} wins ${Math.max(wonA, games.length - wonA)}–${Math.min(wonA, games.length - wonA)}` : "";

  const save = async () => {
    if (!ok || saving) return;
    setSaving(true);
    try { if (await onSave(match.id, games)) setText(""); } finally { setSaving(false); }
  };

  return (
    <div className="grid gap-2 border-b border-line-soft px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,15rem)_auto] sm:items-center">
      <div className="min-w-0">
        <div className="text-[11px] text-ink-3">{event ? `${divisionLabel(event)} · ` : ""}{matchStageLabel(match, event)}{match.court ? ` · ${match.court}` : ""}</div>
        <div className="truncate text-sm text-ink"><span className="font-semibold">{a}</span> <span className="text-ink-3">vs</span> <span className="font-semibold">{b}</span></div>
      </div>
      <div className="min-w-0">
        <input
          className={cx(inputCls, "font-mono", error && text.trim() && "border-red-500/60")}
          inputMode="numeric" placeholder={`${a.split(" ")[0]}'s score first: 21-15 21-18`}
          aria-label={`Score for ${a} vs ${b}, ${a}'s points first`}
          value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") save(); }}
        />
        <div className={cx("mt-0.5 min-h-[1rem] text-[11px]", error && text.trim() ? "text-red-400" : "text-accent-teal")}>
          {text.trim() ? (error || preview) : ""}
        </div>
      </div>
      <div className="flex gap-1.5">
        <Btn size="sm" disabled={!ok || saving} onClick={save}>{saving ? "Saving…" : "Save"}</Btn>
        {match.group_label && onVoid && (
          <Btn size="sm" variant="ghost" disabled={saving} title="A pair didn't turn up: the match counts for nobody"
            onClick={async () => {
              if (!window.confirm(`Mark ${a} vs ${b} as not played? It won't count for either pair.`)) return;
              setSaving(true);
              try { await onVoid(match.id); } finally { setSaving(false); }
            }}>
            Not played
          </Btn>
        )}
      </div>
    </div>
  );
}

export default function QuickResultsPanel({ matches, events, entriesById, live, onSave, onVoid }) {
  const [q, setQ] = useState("");
  const eventById = useMemo(() => Object.fromEntries(events.map((e) => [e.id, e])), [events]);

  const open = useMemo(
    () => matches.filter((m) => !done(m) && !m.is_bye && m.entry_a && m.entry_b).sort(byKey),
    [matches]
  );
  const recent = useMemo(
    () => matches.filter((m) => done(m) && !m.is_bye && m.completed_at)
      .sort((x, y) => y.completed_at.localeCompare(x.completed_at)).slice(0, 5),
    [matches]
  );
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? open.filter((m) => `${entryShort(entriesById[m.entry_a])} ${entryShort(entriesById[m.entry_b])} ${matchStageLabel(m, eventById[m.event_id])}`.toLowerCase().includes(needle))
    : open;

  return (
    <div className="rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-3">
        <div className="flex items-center gap-2">
          <ClipboardCheck size={16} className="text-accent-teal" />
          <div>
            <div className="text-sm font-semibold text-ink">Quick results</div>
            <div className="text-xs text-ink-3">Type the score from the paper slip, first-named player's points first. Enter saves.</div>
          </div>
        </div>
        <Badge tone={open.length ? "amber" : "emerald"}>{open.length ? `${open.length} to enter` : "All entered"}</Badge>
      </div>

      {!live ? (
        <p className="px-3 py-4 text-sm text-ink-2">Press <span className="font-semibold text-ink">Start tournament</span> first, then results can go in here.</p>
      ) : (
        <>
          <div className="relative border-b border-line-soft px-3 py-2">
            <Search size={14} className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-ink-3" />
            <input className={cx(inputCls, "pl-8")} placeholder="Find a player or group…" aria-label="Find a match"
              value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="max-h-[32rem] overflow-y-auto">
            {shown.map((m) => (
              <ResultRow key={m.id} match={m} event={eventById[m.event_id]} entriesById={entriesById} onSave={onSave} onVoid={onVoid} />
            ))}
            {shown.length === 0 && (
              <p className="px-3 py-4 text-sm text-ink-2">{open.length ? "No match matches that search." : "Every match with known players has a result."}</p>
            )}
          </div>
          {recent.length > 0 && (
            <div className="border-t border-line px-3 py-2.5">
              <div className="mb-1 md-eyebrow">Last entered — check these against the slips</div>
              {recent.map((m) => (
                <div key={m.id} className="flex flex-wrap justify-between gap-x-3 text-xs text-ink-2">
                  <span className="min-w-0 truncate">
                    <span className={cx(m.winner_entry_id === m.entry_a && "font-semibold text-ink")}>{entryShort(entriesById[m.entry_a])}</span>
                    {" vs "}
                    <span className={cx(m.winner_entry_id === m.entry_b && "font-semibold text-ink")}>{entryShort(entriesById[m.entry_b])}</span>
                  </span>
                  <span className="font-mono">{isVoidMatch(m) ? "not played" : [...(m.games || [])].sort((x, y) => x.game_number - y.game_number).map((g) => `${g.score_a}-${g.score_b}`).join("  ")}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
