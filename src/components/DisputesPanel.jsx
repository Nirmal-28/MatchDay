import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { entryShort, fmtDateTime, matchStageLabel } from "../lib/engines";
import { listDisputes, resolveDispute } from "../lib/repository";
import { Badge, Btn, Card, EmptyState } from "./ui/primitives";

const STATUS_TONE = { OPEN: "amber", RESOLVED: "emerald", REJECTED: "slate" };

export default function DisputesPanel({ tournamentId, entriesById, events, matches, notify }) {
  const [rows, setRows] = useState(null);
  const [noteById, setNoteById] = useState({});

  const load = () => listDisputes(tournamentId).then(setRows);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [tournamentId]);

  if (!rows) return <div className="py-10 text-center text-sm text-ink-2">Loading disputes…</div>;
  if (rows.length === 0) return <EmptyState icon={ShieldAlert} title="No disputes raised" hint="Score, winner, or opponent corrections raised by scorers or organizers will show up here for review." />;

  const eventById = Object.fromEntries((events || []).map((e) => [e.id, e]));
  const matchById = Object.fromEntries((matches || []).map((m) => [m.id, m]));

  const resolve = async (id, status) => {
    try {
      await resolveDispute(id, status, noteById[id] || "");
      notify(status === "RESOLVED" ? "Dispute resolved." : "Dispute rejected.");
      await load();
    } catch (e) { notify(e.message, "error"); }
  };

  return (
    <div className="space-y-2">
      {rows.map((d) => {
        const m = matchById[d.match_id];
        return (
          <Card key={d.id} className="p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Badge tone={STATUS_TONE[d.status]}>{d.status}</Badge>
                <Badge tone="slate">{d.type}</Badge>
                {m && <span className="text-xs text-ink-2">{matchStageLabel(m, eventById[m.event_id])} — {entryShort(entriesById[m.entry_a])} vs {entryShort(entriesById[m.entry_b])}</span>}
              </div>
              <span className="text-xs text-ink-3">{fmtDateTime(d.created_at)} · {d.raised_by_role || "unknown role"}</span>
            </div>
            <p className="mt-2 text-sm text-ink">{d.description}</p>
            {d.status === "OPEN" ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input className="min-w-[200px] flex-1 rounded-md border border-line bg-surface-2 px-2 py-1 text-xs text-ink"
                  placeholder="Resolution note (optional)"
                  onChange={(e) => setNoteById((s) => ({ ...s, [d.id]: e.target.value }))} />
                <Btn size="sm" onClick={() => resolve(d.id, "RESOLVED")}>Mark resolved</Btn>
                <Btn size="sm" variant="secondary" onClick={() => resolve(d.id, "REJECTED")}>Reject</Btn>
              </div>
            ) : d.resolution_note && (
              <div className="mt-2 rounded-md bg-surface-2 px-2.5 py-1.5 text-xs text-ink-2">{d.resolution_note}</div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
