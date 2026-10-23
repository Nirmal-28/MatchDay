import { useEffect, useState } from "react";
import { Trophy, Info, Activity, AlertTriangle, Wand2 } from "lucide-react";
import { entryName } from "../lib/engines";
import { getRatingData } from "../lib/repository";
import { sideRating, sandbagFlags, seedsByRating } from "../lib/rating";
import { RatingChip } from "./pulse/PulseUI";
import { Btn, Card, inputCls } from "./ui/primitives";

const playersOf = (e) => (e.entry_players || []).map((p) => p.player_id).filter(Boolean);
const formatOf = (entries) => (entries.some((e) => (e.entry_players || []).length > 1) ? "doubles" : "singles");

// Lets the organizer assign real seeds before generating a draw. Without this
// the draw falls back to registration order, which would hand the top seed
// (and a first-round bye) to whoever signed up first.
//
// Fair Draw: with MatchDay Ratings the organizer no longer has to guess. One
// tap seeds by verified rating, and entries rated far above the rest of the
// category are flagged — the sandbagging check organizers otherwise do from
// memory, or not at all. The flag is information, never an automatic action:
// the organizer decides.
export default function SeedingPanel({ entries, onSave, disabled }) {
  const confirmed = entries.filter((e) => e.reg_status === "CONFIRMED");
  const [seeds, setSeeds] = useState(() =>
    Object.fromEntries(confirmed.map((e) => [e.id, e.seed ?? ""]))
  );
  const [saving, setSaving] = useState(false);
  const [pool, setPool] = useState(null);
  const format = formatOf(confirmed);

  useEffect(() => {
    let cancelled = false;
    getRatingData().then((r) => { if (!cancelled) setPool(r.players[format] || {}); }).catch(() => {});
    return () => { cancelled = true; };
  }, [format]);

  const ratingOf = (e) => (pool ? sideRating(pool, playersOf(e)) : null);
  const flags = pool ? sandbagFlags(confirmed, pool, playersOf) : [];
  const flagById = Object.fromEntries(flags.map((f) => [f.entryId, f]));
  const ratedCount = pool ? confirmed.filter((e) => ratingOf(e)).length : 0;

  const autoSeed = () => {
    const map = seedsByRating(confirmed, pool, playersOf);
    setSeeds(Object.fromEntries(Object.entries(map).map(([id, v]) => [id, v ?? ""])));
  };

  if (confirmed.length === 0) {
    return <p className="text-sm text-ink-2">Confirm some entries first — only confirmed entries can be seeded.</p>;
  }

  const used = Object.values(seeds).filter((v) => v !== "" && v != null).map(Number);
  const dupes = used.filter((v, i) => used.indexOf(v) !== i);

  const save = async () => {
    setSaving(true);
    try {
      const map = Object.fromEntries(
        Object.entries(seeds).map(([id, v]) => [id, v === "" || v == null ? null : Number(v)])
      );
      await onSave(map);
    } finally { setSaving(false); }
  };

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-start gap-2 rounded-md bg-surface-2 px-3 py-2 text-xs text-ink-2">
        <Info size={14} className="mt-0.5 shrink-0 text-ink-3" />
        <span>
          Seeds decide bracket placement. Seed 1 and 2 land in opposite halves, and any
          byes go to the top seeds. Leave blank to place an entry by registration order.
        </span>
      </div>

      {pool && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-accent-teal/30 bg-accent-teal/[0.06] px-3 py-2.5">
          <div className="flex items-center gap-2 text-xs text-ink-2">
            <Activity size={14} className="shrink-0 text-accent-teal" />
            <span>
              <span className="font-semibold text-ink">Fair Draw.</span>{" "}
              {ratedCount > 0
                ? `${ratedCount} of ${confirmed.length} entries have a MatchDay Rating.`
                : "No entry here has a MatchDay Rating yet — seed by hand."}
            </span>
          </div>
          {ratedCount > 1 && (
            <Btn size="sm" icon={Wand2} onClick={autoSeed} disabled={disabled}>Seed by rating</Btn>
          )}
        </div>
      )}

      {flags.length > 0 && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-accent-yellow/40 bg-accent-yellow/[0.07] px-3 py-2.5 text-xs text-ink-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-accent-yellow" />
          <span>
            <span className="font-semibold text-ink">Level check:</span>{" "}
            {flags.length === 1 ? "1 entry is" : `${flags.length} entries are`} rated well above this category's median
            on established MatchDay Ratings. Worth a look before the draw — it may belong in a higher grade.
          </span>
        </div>
      )}

      <div className="space-y-1.5">
        {confirmed.map((e) => (
          <div key={e.id} className="flex items-center gap-3 rounded-md border border-line px-3 py-2">
            <Trophy size={13} className="shrink-0 text-ink-3" />
            <span className="min-w-0 flex-1 truncate text-sm text-ink">
              {entryName(e)}
              {flagById[e.id] && (
                <span className="ml-2 text-[11px] font-semibold text-accent-yellow">+{flagById[e.id].aboveMedian} above median</span>
              )}
            </span>
            {ratingOf(e) && <RatingChip rating={ratingOf(e).rating} provisional={ratingOf(e).provisional} />}
            <input
              type="number" min={1} max={confirmed.length} placeholder="—"
              className={`${inputCls} w-20 text-center`}
              value={seeds[e.id] ?? ""}
              onChange={(ev) => setSeeds((s) => ({ ...s, [e.id]: ev.target.value }))}
            />
          </div>
        ))}
      </div>

      {dupes.length > 0 && (
        <div className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          Duplicate seed{dupes.length > 1 ? "s" : ""}: {[...new Set(dupes)].join(", ")}. Each seed must be unique.
        </div>
      )}

      <div className="mt-4 flex justify-end">
        <Btn size="sm" disabled={saving || disabled || dupes.length > 0} onClick={save}>Save seeds</Btn>
      </div>
    </Card>
  );
}
