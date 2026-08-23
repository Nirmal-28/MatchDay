import { useState } from "react";
import { Link } from "react-router-dom";
import { Radio, Clock, CheckCircle2, CalendarDays, AlertTriangle, ChevronRight, MapPin } from "lucide-react";
import {
  cx, fmtDate, fmtDateTime, relativeTime, entryShort, divisionLabel, matchStageLabel,
  BadmintonScoringEngine, toAB, CHECK_IN_META,
} from "../lib/engines";
import { Badge, Card } from "./ui/primitives";
import { LivePulse } from "./ui/motion";

/* A player's matches, grouped the way a player actually thinks about them
   while standing at a venue: what is happening now, what is next, what is
   later today, and what is already done.

   Built as cards rather than a table — this is read on a phone, one-handed,
   often in bright light. Court number and time carry the most visual weight
   because those are the two facts someone re-checks most often. */

const sameDay = (iso, ref = new Date()) => {
  if (!iso) return false;
  const d = new Date(iso);
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth() && d.getDate() === ref.getDate();
};

function MatchCard({ item, updated, emphasis }) {
  const { match, event, opponent, entry, tournament, isSideA, won } = item;
  const games = [...(match.games || [])].sort((a, b) => a.game_number - b.game_number);
  const current = games[games.length - 1];
  const tally = BadmintonScoringEngine.gameTally(toAB(games));
  const live = match.status === "LIVE";
  const done = ["COMPLETED", "WALKOVER"].includes(match.status);
  const checkIn = CHECK_IN_META[entry?.check_in_status || "NOT_CHECKED_IN"];

  return (
    <Link to={`/m/${match.id}`} className="block">
      <Card className={cx(
        "p-4 transition-colors active:bg-surface-2",
        live && "border-red-500/40 bg-red-500/[0.04]",
        updated && !done && "border-amber-400/50 bg-amber-400/[0.06]",
        emphasis && !live && !updated && "border-accent-teal/40"
      )}>
        {/* Schedule changes are the single thing a player must not miss. */}
        {updated && !done && (
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-amber-300">
            <AlertTriangle size={12} /> Match updated
          </div>
        )}

        <div className="mb-1.5 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-[11px] uppercase tracking-wide text-ink-3">
              {divisionLabel(event)} · {matchStageLabel(match, event)}
            </div>
            <div className={cx("mt-0.5 truncate font-semibold text-ink", emphasis ? "text-lg" : "text-base")}>
              vs {entryShort(opponent) || "TBD"}
            </div>
          </div>
          {live ? <LivePulse />
            : done ? <Badge tone={won ? "emerald" : "slate"}>{won ? "Won" : "Lost"}</Badge>
            : null}
        </div>

        {(live || done) && (
          <div className="mb-2 font-mono text-2xl font-bold tabular-nums text-ink">
            {live
              ? `${isSideA ? (current?.score_a ?? 0) : (current?.score_b ?? 0)}–${isSideA ? (current?.score_b ?? 0) : (current?.score_a ?? 0)}`
              : `${isSideA ? tally.a : tally.b}–${isSideA ? tally.b : tally.a}`}
            {live && <span className="ml-2 align-middle text-[11px] font-normal text-ink-3">games {tally.a}–{tally.b}</span>}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="flex items-center gap-1.5 font-semibold text-ink">
            <MapPin size={13} className="text-ink-3" />{match.court || match.courts?.name || "Court TBD"}
          </span>
          <span className="flex items-center gap-1.5 text-ink-2">
            <Clock size={13} className="text-ink-3" />
            {match.scheduled_at ? (done ? fmtDate(match.completed_at || match.scheduled_at) : fmtDateTime(match.scheduled_at)) : "Time TBD"}
          </span>
          {match.scheduled_at && !done && !live && (
            <span className="text-xs font-medium text-accent-teal">{relativeTime(match.scheduled_at)}</span>
          )}
        </div>

        {!done && !live && (
          <div className="mt-2 flex items-center justify-between gap-2">
            <Badge tone={checkIn?.tone ?? "slate"}>{checkIn?.label}</Badge>
            <span className="flex items-center gap-0.5 text-xs font-medium text-accent-teal">
              Details <ChevronRight size={13} />
            </span>
          </div>
        )}
        {tournament?.name && <div className="mt-1.5 truncate text-[11px] text-ink-3">{tournament.name}</div>}
      </Card>
    </Link>
  );
}

export default function MatchCenter({ live, upcoming, completed, updatedMatchIds }) {
  const today = upcoming.filter((i) => sameDay(i.match.scheduled_at));


  const TABS = [
    { key: "today", label: "Today", icon: CalendarDays, list: [...live, ...today], count: live.length + today.length },
    { key: "upcoming", label: "Upcoming", icon: Clock, list: upcoming, count: upcoming.length },
    { key: "live", label: "Live", icon: Radio, list: live, count: live.length },
    { key: "completed", label: "Completed", icon: CheckCircle2, list: completed, count: completed.length },
  ];

  // Open on whatever the player most likely came to see.
  const [tab, setTab] = useState(() =>
    live.length ? "live" : (today.length ? "today" : (upcoming.length ? "upcoming" : "completed"))
  );
  const active = TABS.find((t) => t.key === tab) || TABS[0];

  const EMPTY = {
    today: { title: "Nothing on today", hint: "Matches scheduled for today will appear here." },
    upcoming: { title: "No upcoming matches", hint: "Once a draw is made and the schedule is published, your matches appear here." },
    live: { title: "No live match", hint: "Your match shows here the moment a scorer starts it." },
    completed: { title: "No completed matches yet", hint: "Your results will appear here after your first match." },
  }[active.key];

  return (
    <section>
      {/* Horizontally scrollable on a phone rather than wrapping into rows. */}
      <div className="mb-3 -mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {TABS.map((t) => (
          <button
            key={t.key} onClick={() => setTab(t.key)}
            className={cx(
              "flex flex-shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              tab === t.key ? "border-accent-teal bg-accent-teal/10 text-accent-teal" : "border-line text-ink-2 hover:bg-surface-2"
            )}
          >
            <t.icon size={13} />
            {t.label}
            {t.count > 0 && (
              <span className={cx("rounded-full px-1.5 text-[10px] font-bold",
                t.key === "live" ? "bg-red-500/20 text-red-300" : "bg-surface-3 text-ink-2")}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {active.list.length === 0 ? (
        <Card className="px-4 py-8 text-center">
          <div className="text-sm font-semibold text-ink">{EMPTY.title}</div>
          <div className="mx-auto mt-1 max-w-xs text-sm text-ink-2">{EMPTY.hint}</div>
        </Card>
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {active.list.map((item, i) => (
            <MatchCard
              key={item.match.id}
              item={item}
              updated={updatedMatchIds?.has(item.match.id)}
              emphasis={i === 0 && active.key !== "completed"}
            />
          ))}
        </div>
      )}
    </section>
  );
}


