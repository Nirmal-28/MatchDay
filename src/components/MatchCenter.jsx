import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import {
  fmtDate, fmtDateTime, relativeTime, entryShort, divisionLabel, matchStageLabel,
  BadmintonScoringEngine, toAB, CHECK_IN_META,
} from "../lib/engines";
import { MatchCard, SectionHeader, Tabs } from "./ui/md";

/* ═══════════════════════════════════════════════════════════════════════
   MATCH CENTER
   ═══════════════════════════════════════════════════════════════════════

   A player's matches, grouped the way a player thinks about them while
   standing at a venue: what is happening now, what is next, what is later
   today, and what is already done.

   Every card here is the shared <MatchCard/> from the design system rather
   than a bespoke layout. That is the whole point of the component: the
   match a player sees here is drawn identically to the same match on the
   public tournament page, in the organizer's list and on the venue display,
   so "live" and "final" mean one visual thing across the product.

   The adapter below is the only sport-aware part — it reads the badminton
   game tally to produce a completed match's set line. When another sport
   gains a scoring engine, this is where its summary plugs in.
   ══════════════════════════════════════════════════════════════════════ */

const sameDay = (iso, ref = new Date()) => {
  if (!iso) return false;
  const d = new Date(iso);
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth() && d.getDate() === ref.getDate();
};

// A player-dashboard match item → the normalised shape <MatchCard/> renders.
// Written from the player's own point of view: they are always side A, so
// their score is always on top no matter which side of the draw they are on.
function toCardModel(item, updated) {
  const { match, event, opponent, entry, tournament, isSideA, won } = item;
  const games = [...(match.games || [])].sort((a, b) => a.game_number - b.game_number);
  const current = games[games.length - 1];
  const tally = BadmintonScoringEngine.gameTally(toAB(games));
  const live = match.status === "LIVE";
  const done = ["COMPLETED", "WALKOVER"].includes(match.status);
  const checkIn = CHECK_IN_META[entry?.check_in_status || "NOT_CHECKED_IN"];
  const mineFirst = (a, b) => (isSideA ? [a, b] : [b, a]);

  // Live shows the current game's running score; a finished match shows the
  // games won, which is the result people actually quote.
  let myScore = null, theirScore = null;
  if (live) [myScore, theirScore] = mineFirst(current?.score_a ?? 0, current?.score_b ?? 0);
  else if (done) [myScore, theirScore] = mineFirst(tally.a, tally.b);

  const time = match.scheduled_at
    ? (done ? fmtDate(match.completed_at || match.scheduled_at) : fmtDateTime(match.scheduled_at))
    : "Time TBD";

  // A note, in priority order: a schedule change the player has not read yet
  // beats a countdown, which beats an outstanding check-in.
  const note = updated && !done ? null
    : match.scheduled_at && !done && !live ? relativeTime(match.scheduled_at)
    : !done && !live && checkIn?.label ? checkIn.label
    : tournament?.name || null;

  return {
    id: match.id,
    status: live ? "live" : done ? "completed" : "scheduled",
    sport: tournament?.sport,
    round: matchStageLabel(match, event),
    event: divisionLabel(event),
    court: match.court || match.courts?.name || null,
    time,
    sideA: { name: entryShort(entry) || "You", score: myScore, won: done ? won : undefined },
    sideB: { name: entryShort(opponent) || "TBD", score: theirScore, won: done ? !won : undefined },
    // Per-game breakdown only once the match is over — during play the games
    // list is still changing and the running score above already says it.
    games: done ? games.map((g) => {
      const [a, b] = mineFirst(g.score_a, g.score_b);
      return { a, b };
    }) : null,
    note,
  };
}

export default function MatchCenter({ live, upcoming, completed, updatedMatchIds }) {
  const today = upcoming.filter((i) => sameDay(i.match.scheduled_at));

  const GROUPS = {
    today: { label: "Today", list: [...live, ...today] },
    upcoming: { label: "Upcoming", list: upcoming },
    live: { label: "Live", list: live },
    results: { label: "Results", list: completed },
  };

  // Open on whatever the player most likely came to see.
  const [tab, setTab] = useState(() =>
    live.length ? "live" : (today.length ? "today" : (upcoming.length ? "upcoming" : "results"))
  );
  const active = GROUPS[tab] || GROUPS.today;

  const tabs = Object.entries(GROUPS).map(([key, g]) => ({
    key, label: g.label, count: g.list.length,
  }));

  const EMPTY = {
    today: { title: "Nothing on today", hint: "Matches scheduled for today appear here." },
    upcoming: { title: "No upcoming matches", hint: "Once a draw is made and the schedule is published, your matches appear here." },
    live: { title: "No live match", hint: "Your match shows here the moment a scorer starts it." },
    results: { title: "No completed matches yet", hint: "Your results appear here after your first match." },
  }[tab];

  return (
    <section>
      <SectionHeader eyebrow="Match center" title="Your matches" />
      <Tabs tabs={tabs} value={tab} onChange={setTab} ariaLabel="Match groups" />

      <div className="pt-4">
        {active.list.length === 0 ? (
          <div className="md-card px-4 py-10 text-center">
            <div className="md-display text-xl text-ink">{EMPTY.title}</div>
            <div className="mx-auto mt-1.5 max-w-xs text-sm text-ink-2">{EMPTY.hint}</div>
          </div>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2">
            {active.list.map((item, i) => {
              const updated = updatedMatchIds?.has(item.match.id);
              const done = ["COMPLETED", "WALKOVER"].includes(item.match.status);
              return (
                <div key={item.match.id} className="relative">
                  {/* A schedule change is the one thing a player must not
                      miss, so it sits above the card rather than competing
                      with the match detail inside it. The one-shot flash
                      fires when it first renders and then stops. */}
                  {updated && !done && (
                    <div
                      className="md-flash mb-1.5 flex items-center gap-1.5 rounded text-[11px] font-bold uppercase tracking-wider"
                      style={{ color: "var(--color-closing)" }}
                    >
                      <AlertTriangle size={12} /> Match updated
                    </div>
                  )}
                  <MatchCard
                    match={toCardModel(item, updated)}
                    to={`/m/${item.match.id}`}
                    // The first upcoming match is the one a player is about
                    // to walk to; giving it the hero density makes the time
                    // and court readable at arm's length.
                    size={i === 0 && tab !== "results" ? "hero" : "default"}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
