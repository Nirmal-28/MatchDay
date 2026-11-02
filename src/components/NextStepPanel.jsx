import { ArrowRight } from "lucide-react";
import { entryShort, fmtTime, matchStageLabel } from "../lib/engines";
import { nextStep } from "../lib/lifecycle";
import { Btn, Card } from "./ui/primitives";

/* The home of a tournament in the simple view: the one thing to do now, how far
   along it is, and who plays next. The full command center is under All tools. */

const SHOWN = 6;
const played = (m) => m.status === "COMPLETED" || m.status === "WALKOVER";

export default function NextStepPanel({ tournament, events, matches, entriesById, onGoToTab }) {
  const step = nextStep({ tournament, events, matches });
  const real = matches.filter((m) => !m.is_bye);
  const finished = real.filter(played).length;
  const eventById = Object.fromEntries(events.map((e) => [e.id, e]));
  const upcoming = real
    .filter((m) => !played(m) && m.entry_a && m.entry_b)
    .sort((a, b) => (a.scheduled_at || "9").localeCompare(b.scheduled_at || "9") || a.match_number - b.match_number);

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="md-eyebrow mb-1 text-accent-teal">Next step</div>
        <h2 className="text-lg font-semibold text-ink">{step.title}</h2>
        <p className="mt-1 max-w-xl text-sm text-ink-2">{step.body}</p>
        {step.tab && <Btn className="mt-3" icon={ArrowRight} onClick={() => onGoToTab(step.tab)}>{step.action}</Btn>}
        {real.length > 0 && <p className="mt-3 text-xs text-ink-3">{finished} of {real.length} matches played</p>}
      </Card>

      {upcoming.length > 0 && (
        <section>
          <div className="mb-2 md-eyebrow">Up next</div>
          <Card className="divide-y divide-line-soft">
            {upcoming.slice(0, SHOWN).map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-ink">
                    {entryShort(entriesById[m.entry_a])} <span className="font-normal text-ink-3">vs</span> {entryShort(entriesById[m.entry_b])}
                  </div>
                  <div className="text-[11px] text-ink-3">{matchStageLabel(m, eventById[m.event_id])}</div>
                </div>
                <div className="shrink-0 text-right text-xs text-ink-2">
                  {m.scheduled_at && <div className="font-medium">{fmtTime(m.scheduled_at)}</div>}
                  {m.court && <div className="text-[11px] text-ink-3">{m.court}</div>}
                </div>
              </div>
            ))}
          </Card>
          {upcoming.length > SHOWN && <p className="mt-1.5 text-xs text-ink-3">And {upcoming.length - SHOWN} more after these.</p>}
        </section>
      )}
    </div>
  );
}
