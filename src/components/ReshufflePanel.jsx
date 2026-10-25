import { useMemo, useState } from "react";
import { Shuffle, ChevronDown } from "lucide-react";
import { cx, entryShort, groupLetter, latestGroupStage, stageFinishingOrder, reshuffleGroups } from "../lib/engines";
import { Btn, Badge } from "./ui/primitives";

const ordinal = (n) => {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

/* Between a group stage and the knockout: start another group stage with the
   groups reshuffled from the results, the way organizers do it on paper —
   new Group A takes the 1st of A, 2nd of B, 3rd of C, 4th of D, 5th of A, and
   so on. The preview is computed here from the same pure functions the
   repository uses, so what the organizer checks is exactly what gets made. */
export default function ReshufflePanel({ matches, entriesById, onReshuffle }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const { stage, matches: stageMatches, labels } = useMemo(() => latestGroupStage(matches), [matches]);
  const done = stageMatches.length > 0 &&
    stageMatches.every((m) => m.status === "COMPLETED" || m.status === "WALKOVER");
  const preview = useMemo(
    () => (done ? reshuffleGroups(stageFinishingOrder(stageMatches, labels)) : []),
    [done, stageMatches, labels]
  );

  if (labels.length < 2) return null;

  const run = async () => {
    setSaving(true);
    try { await onReshuffle(); setOpen(false); } finally { setSaving(false); }
  };

  return (
    <div className="rounded-md border border-line bg-surface-2">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
        <span className="flex items-center gap-2 text-xs text-ink-2">
          <Shuffle size={14} className="shrink-0 text-accent-teal" />
          {done
            ? `Stage ${stage} is complete. Reshuffle into new groups for Stage ${stage + 1}, or build the knockout.`
            : `Reshuffling into new groups unlocks once every Stage ${stage} match is played.`}
        </span>
        <Btn size="sm" variant="secondary" disabled={!done} onClick={() => setOpen((o) => !o)}>
          Reshuffle groups <ChevronDown size={14} className={cx("transition-transform", open && "rotate-180")} />
        </Btn>
      </div>

      {open && done && (
        <div className="space-y-3 border-t border-line-soft px-3 py-3">
          <p className="text-xs text-ink-2">
            Each new group gets one player from every finishing position: new Group A takes the 1st of Group A,
            the 2nd of B, the 3rd of C and so on, wrapping round. Check it against your sheet before creating.
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {preview.map((group, gi) => (
              <div key={gi} className="rounded-md border border-line bg-surface p-2.5">
                <div className="mb-1.5 md-eyebrow">Stage {stage + 1} · Group {groupLetter(gi)}</div>
                <ol className="space-y-1 text-sm">
                  {group.map((g) => (
                    <li key={g.entryId} className="flex items-center justify-between gap-2">
                      <span className="truncate text-ink">{entryShort(entriesById[g.entryId])}</span>
                      <Badge tone="slate">{ordinal(g.position)} of {groupLetter(g.fromGroup)}</Badge>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-end gap-2">
            <span className="text-xs text-ink-3">Stage {stage} results stay on record.</span>
            <Btn size="sm" disabled={saving} onClick={run}>
              {saving ? "Creating…" : `Create Stage ${stage + 1} groups`}
            </Btn>
          </div>
        </div>
      )}
    </div>
  );
}
