import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Gavel, ClipboardList, Radio, ExternalLink, Clock, MapPin } from "lucide-react";
import {
  cx, fmtDateTime, relativeTime, entryShort, divisionLabel, matchStageLabel,
  BadmintonScoringEngine, toAB, MATCH_STATUS_META,
} from "../lib/engines";
import { listMyAssignedMatches } from "../lib/repository";
import { Badge, Card, EmptyState } from "../components/ui/primitives";
import { BrandLoader, LivePulse } from "../components/ui/motion";

/* The OFFICIATE surface — every match this user has personally been assigned
   to referee or score, across every tournament, in one list. It exists
   because an official works across tournaments while the control center is
   scoped to one, and reads through the same staff RLS, so it can only show
   matches they are genuinely permitted to act on.

   Mobile-first: an official reads this standing beside a court. */

const DONE = ["COMPLETED", "WALKOVER"];

function RoleChip({ role }) {
  if (role === "BOTH") return <Badge tone="teal"><Gavel size={10} /> Referee &amp; scorer</Badge>;
  if (role === "REFEREE") return <Badge tone="amber"><Gavel size={10} /> Referee</Badge>;
  return <Badge tone="emerald"><ClipboardList size={10} /> Scorer</Badge>;
}

function MatchRow({ m }) {
  const games = [...(m.games || [])].sort((a, b) => a.game_number - b.game_number);
  const current = games[games.length - 1];
  const tally = BadmintonScoringEngine.gameTally(toAB(games));
  const live = m.status === "LIVE";
  const done = DONE.includes(m.status);

  return (
    <Card className={cx("p-4", live && "border-red-500/40 bg-red-500/[0.04]")}>
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <RoleChip role={m.role} />
          <Badge tone="slate">{m.court || m.courts?.name || "Court TBD"}</Badge>
        </div>
        {live ? <LivePulse /> : <Badge tone={MATCH_STATUS_META[m.status]?.tone ?? "slate"}>{MATCH_STATUS_META[m.status]?.label ?? m.status}</Badge>}
      </div>

      <Link to={m.tournament?.slug ? `/t/${m.tournament.slug}` : "#"} className="text-[11px] text-ink-3 hover:text-accent-teal">
        {m.tournament?.name}
      </Link>
      <div className="md-eyebrow">
        {divisionLabel(m.event)} · {matchStageLabel(m, m.event)}
      </div>

      <div className="mt-1.5 flex items-center justify-between gap-3">
        <div className="min-w-0 text-base font-semibold text-ink">
          {entryShort(m.sideA) || "TBD"} <span className="text-ink-3">vs</span> {entryShort(m.sideB) || "TBD"}
        </div>
        {(live || done) && (
          <div className="shrink-0 font-mono text-lg font-bold tabular-nums text-ink">
            {live ? `${current?.score_a ?? 0}–${current?.score_b ?? 0}` : `${tally.a}–${tally.b}`}
          </div>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink-3">
        <span className="flex items-center gap-2">
          <span className="flex items-center gap-1"><Clock size={11} />{m.scheduled_at ? fmtDateTime(m.scheduled_at) : "Time TBD"}</span>
          {m.scheduled_at && !done && <span className="text-accent-teal">{relativeTime(m.scheduled_at)}</span>}
        </span>
        <span className="flex items-center gap-3">
          <Link to={`/m/${m.id}`} className="font-medium text-accent-teal hover:underline">Details</Link>
          {!done && m.tournament?.id && (
            <a
              href={`/organizer/${m.tournament.id}/score`} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 font-medium text-accent-teal hover:underline"
            >
              Scorer mode <ExternalLink size={10} />
            </a>
          )}
        </span>
      </div>
    </Card>
  );
}

function Section({ title, icon: Icon, list, tone }) {
  if (!list.length) return null;
  return (
    <section>
      <h2 className={cx("mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide", tone || "text-ink-2")}>
        <Icon size={13} /> {title} <span className="text-ink-3">({list.length})</span>
      </h2>
      <div className="grid gap-2 sm:grid-cols-2">
        {list.map((m) => <MatchRow key={m.id} m={m} />)}
      </div>
    </section>
  );
}

export default function Officiate() {
  const [matches, setMatches] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try { setMatches(await listMyAssignedMatches()); }
    catch (e) { setError(e.message); }
  }, []);

  useEffect(() => { load(); }, [load]);
  // Assignments and scores both move during a tournament; a light poll keeps
  // this honest without standing up a second realtime channel for a screen an
  // official glances at between matches.
  useEffect(() => {
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load]);

  if (error) return <EmptyState icon={Gavel} title="Couldn't load your assignments" hint={error} />;
  if (!matches) return <BrandLoader />;

  const live = matches.filter((m) => m.status === "LIVE");
  const upcoming = matches.filter((m) => !DONE.includes(m.status) && m.status !== "LIVE");
  const done = matches.filter((m) => DONE.includes(m.status))
    .sort((a, b) => (b.completed_at || "").localeCompare(a.completed_at || ""));

  if (!matches.length) {
    return (
      <EmptyState
        icon={Gavel} title="No matches assigned to you yet"
        hint="When an organizer assigns you to referee or score a match, it appears here — across every tournament you officiate."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="md-eyebrow text-accent-teal">Officiate</div>
        <h1 className="text-2xl font-bold text-ink">Your assigned matches</h1>
        <p className="mt-0.5 text-sm text-ink-2">
          {matches.length} across {new Set(matches.map((m) => m.tournament?.id)).size} tournament
          {new Set(matches.map((m) => m.tournament?.id)).size === 1 ? "" : "s"}.
        </p>
      </div>

      <Section title="Live now" icon={Radio} list={live} tone="text-red-300" />
      <Section title="Coming up" icon={Clock} list={upcoming} />
      <Section title="Completed" icon={MapPin} list={done.slice(0, 10)} />
    </div>
  );
}
