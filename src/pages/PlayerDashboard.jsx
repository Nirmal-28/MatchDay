import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import {
  CalendarClock, MapPin, Trophy, Radio, UserCheck, CreditCard, Compass, ArrowRight,
  Ticket, ClipboardCheck, User,
} from "lucide-react";
import {
  fmtDate, fmtTime, relativeTime, inr, entryShort, divisionLabel,
  matchStageLabel, REG_STATUS_META, PAY_STATUS_META,
  CHECK_IN_META, TOURNAMENT_STATUS_META,
} from "../lib/engines";
import {
  getMyPlayerData, listMyNotifications, listMyTournaments,
  subscribeToMyNotifications, subscribeToMyMatches,
} from "../lib/repository";
import { useAuth } from "../lib/AuthContext";
import MatchCenter from "../components/MatchCenter";
import PlayerSeries from "../components/PlayerSeries";
import { Badge, Btn, Card, EmptyState } from "../components/ui/primitives";
import { BrandLoader, LivePulse, Reveal } from "../components/ui/motion";
import { CourtGeometry } from "../components/ui/atmosphere";
import { useDocumentMeta } from "../lib/useDocumentMeta";

const DONE = ["COMPLETED", "WALKOVER"];

/* The dashboard answers one question above all others: what do I need to do
   next? Everything else on this page is reference material underneath that
   answer. Nothing here is generated or estimated — an empty tournament
   history renders as empty, not as zeroed-out statistics. */

function NextUp({ item, player }) {
  if (!item) return null;
  const { kind } = item;

  if (kind === "LIVE") {
    const { match, event, opponent, score } = item;
    return (
      <Reveal className="relative overflow-hidden rounded-2xl border border-red-500/40 bg-navy-900 p-5 sm:p-6">
        <CourtGeometry />
        <div className="relative">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-red-300">
            <LivePulse label="" /> You are on court now
          </div>
          <h2 className="mt-2 text-2xl font-bold text-white sm:text-3xl">{match.court || match.courts?.name || "Court TBD"}</h2>
          <div className="mt-1 text-sm text-ink-2">{divisionLabel(event)} · {matchStageLabel(match, event)}</div>
          <div className="mt-4 flex items-end justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-ink-3">Opponent</div>
              <div className="text-lg font-semibold text-white">{entryShort(opponent) || "TBD"}</div>
            </div>
            <div className="font-display text-4xl font-bold tabular-nums text-white">{score.a}–{score.b}</div>
          </div>
          <Link to={`/m/${match.id}`} className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-accent-teal hover:underline">
            Follow this match <ArrowRight size={14} />
          </Link>
        </div>
      </Reveal>
    );
  }

  if (kind === "MATCH") {
    const { match, event, opponent, entry, tournament } = item;
    const checkedIn = entry?.check_in_status === "CHECKED_IN";
    return (
      <Reveal className="relative overflow-hidden rounded-2xl border border-accent-teal/40 bg-navy-900 p-5 sm:p-6">
        <CourtGeometry />
        <div className="relative">
          <div className="text-[11px] font-semibold uppercase tracking-widest text-accent-teal">Your next match</div>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="font-display text-3xl font-bold text-white sm:text-4xl">
              {match.scheduled_at ? fmtTime(match.scheduled_at) : "Time TBD"}
            </h2>
            {match.scheduled_at && (
              <span className="text-sm font-medium text-accent-teal">{relativeTime(match.scheduled_at)}</span>
            )}
          </div>
          <div className="mt-1 text-sm text-ink-2">
            {match.scheduled_at ? fmtDate(match.scheduled_at) : ""} · {tournament?.name}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-white/10 bg-white/5 p-3">
              <div className="text-[10px] uppercase tracking-wide text-ink-3">Court</div>
              <div className="text-base font-semibold text-white">{match.court || match.courts?.name || "TBD"}</div>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/5 p-3">
              <div className="text-[10px] uppercase tracking-wide text-ink-3">Opponent</div>
              <div className="truncate text-base font-semibold text-white">{entryShort(opponent) || "TBD"}</div>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/5 p-3">
              <div className="text-[10px] uppercase tracking-wide text-ink-3">Category</div>
              <div className="truncate text-base font-semibold text-white">{divisionLabel(event)}</div>
            </div>
          </div>

          {!checkedIn && entry?.check_in_code && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2.5">
              <ClipboardCheck size={15} className="text-amber-300" />
              <span className="text-sm text-amber-200">Not checked in yet — show this code at the desk:</span>
              <span className="rounded bg-amber-400/20 px-2 py-0.5 font-mono text-sm font-bold tracking-widest text-amber-100">
                {entry.check_in_code}
              </span>
            </div>
          )}

          <Link to={`/m/${match.id}`} className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-accent-teal hover:underline">
            Match details <ArrowRight size={14} />
          </Link>
        </div>
      </Reveal>
    );
  }

  if (kind === "PAY") {
    const { entries, total } = item;
    return (
      <Reveal className="rounded-2xl border border-amber-400/40 bg-amber-400/[0.07] p-5">
        <div className="flex items-start gap-3">
          <CreditCard size={20} className="mt-0.5 shrink-0 text-amber-300" />
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-widest text-amber-300">Action needed</div>
            <h2 className="mt-1 text-lg font-bold text-ink">
              {entries.length} {entries.length === 1 ? "entry is" : "entries are"} awaiting payment
            </h2>
            <p className="mt-1 text-sm text-ink-2">
              {inr(total)} outstanding. Entry fees are collected by the organizer — contact them from the
              tournament page to settle, and your status here updates once they record it.
            </p>
          </div>
        </div>
      </Reveal>
    );
  }

  if (kind === "CHECKIN") {
    const { entry, tournament } = item;
    return (
      <Reveal className="rounded-2xl border border-accent-teal/40 bg-accent-teal/[0.07] p-5">
        <div className="flex items-start gap-3">
          <UserCheck size={20} className="mt-0.5 shrink-0 text-accent-teal" />
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-widest text-accent-teal">Action needed</div>
            <h2 className="mt-1 text-lg font-bold text-ink">Check in for {tournament?.name}</h2>
            <p className="mt-1 text-sm text-ink-2">The tournament is under way. Show this code at the check-in desk:</p>
            {entry?.check_in_code && (
              <div className="mt-2 inline-block rounded-md border border-accent-teal/40 bg-accent-teal/10 px-3 py-1.5 font-mono text-lg font-bold tracking-widest text-accent-teal">
                {entry.check_in_code}
              </div>
            )}
          </div>
        </div>
      </Reveal>
    );
  }

  // Nothing outstanding.
  return (
    <Reveal className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex items-start gap-3">
        <Compass size={20} className="mt-0.5 shrink-0 text-accent-teal" />
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-widest text-accent-teal">You are all set</div>
          <h2 className="mt-1 text-lg font-bold text-ink">
            {player?.name ? `Nothing needs your attention, ${player.name.split(" ")[0]}.` : "Nothing needs your attention."}
          </h2>
          <p className="mt-1 text-sm text-ink-2">No upcoming matches or outstanding actions right now.</p>
          <Link to="/" className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-accent-teal hover:underline">
            Find a tournament <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </Reveal>
  );
}

function EntryRow({ entry, event, tournament }) {
  return (
    <Card className="p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Link to={tournament?.slug ? `/t/${tournament.slug}` : "#"} className="truncate font-semibold text-ink hover:text-accent-teal">
            {tournament?.name || "Tournament"}
          </Link>
          <div className="mt-0.5 text-xs text-ink-2">{divisionLabel(event)}</div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-3">
            {tournament?.venue && <span className="flex items-center gap-1"><MapPin size={10} />{tournament.venue}</span>}
            {tournament?.start_date && <span className="flex items-center gap-1"><CalendarClock size={10} />{fmtDate(tournament.start_date)}</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={REG_STATUS_META[entry.reg_status]?.tone ?? "amber"}>
            {entry.reg_status === "WAITLISTED" ? `Waitlist #${entry.waitlist_position ?? "—"}` : (REG_STATUS_META[entry.reg_status]?.label ?? entry.reg_status)}
          </Badge>
          {Number(entry.fee_inr || 0) > 0 && (
            <Badge tone={PAY_STATUS_META[entry.payment_status]?.tone ?? "slate"}>{PAY_STATUS_META[entry.payment_status]?.label ?? entry.payment_status}</Badge>
          )}
          <Badge tone={CHECK_IN_META[entry.check_in_status || "NOT_CHECKED_IN"]?.tone ?? "slate"}>
            {CHECK_IN_META[entry.check_in_status || "NOT_CHECKED_IN"]?.label}
          </Badge>
        </div>
      </div>
    </Card>
  );
}

export default function PlayerDashboard() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [notifications, setNotifications] = useState([]);
  useDocumentMeta({ title: "Your matches" });
  const [organized, setOrganized] = useState([]);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const [d, n, mine] = await Promise.all([
        getMyPlayerData(),
        listMyNotifications(60).catch(() => []),
        listMyTournaments().catch(() => []),
      ]);
      setData(d);
      setNotifications(n);
      setOrganized(mine);
    } catch (e) { setError(e.message); }
  }, []);

  useEffect(() => { if (session) load(); }, [session, load]);

  // Tournament day is realtime. Reuses the notification channel that already
  // exists plus a match filter over this player's own entries — no second
  // realtime system.
  useEffect(() => {
    if (!session) return;
    return subscribeToMyNotifications(session.user.id, load);
  }, [session, load]);

  useEffect(() => {
    if (!data?.myEntryIds?.length) return;
    return subscribeToMyMatches(data.myEntryIds, load);
  }, [data?.myEntryIds, load]);

  const view = useMemo(() => {
    if (!data) return null;
    const { player, entries, matches, entriesById, myEntryIds } = data;
    const mine = new Set(myEntryIds || []);
    const entryById = Object.fromEntries(entries.map((e) => [e.id, e]));
    const eventOf = (m) => {
      const entry = entries.find((e) => e.event_id === m.event_id);
      return entry?.tournament_events || null;
    };

    const enrich = (m) => {
      const event = eventOf(m);
      const myEntryId = mine.has(m.entry_a) ? m.entry_a : m.entry_b;
      const oppId = m.entry_a === myEntryId ? m.entry_b : m.entry_a;
      return {
        match: m, event, tournament: event?.tournaments || null,
        myEntryId, isSideA: m.entry_a === myEntryId,
        entry: entryById[myEntryId] || null,
        opponent: entriesById[oppId] || null,
        won: !!(m.winner_entry_id && mine.has(m.winner_entry_id)),
      };
    };

    const upcoming = matches
      .filter((m) => !DONE.includes(m.status) && m.status !== "LIVE" && !m.is_bye)
      .sort((a, b) => (a.scheduled_at || "~").localeCompare(b.scheduled_at || "~"))
      .map(enrich);
    const live = matches.filter((m) => m.status === "LIVE").map(enrich);
    const completed = matches
      .filter((m) => DONE.includes(m.status))
      .sort((a, b) => (b.completed_at || "").localeCompare(a.completed_at || ""))
      .map(enrich);

    // Priority order for "what next": on court now > next scheduled match >
    // money owed > check in > nothing.
    let next = null;
    if (live.length) {
      const l = live[0];
      const games = [...(l.match.games || [])].sort((a, b) => a.game_number - b.game_number);
      const cur = games[games.length - 1];
      next = {
        kind: "LIVE", ...l,
        score: {
          a: l.isSideA ? (cur?.score_a ?? 0) : (cur?.score_b ?? 0),
          b: l.isSideA ? (cur?.score_b ?? 0) : (cur?.score_a ?? 0),
        },
      };
    } else if (upcoming.length && upcoming[0].match.scheduled_at) {
      next = { kind: "MATCH", ...upcoming[0] };
    } else {
      const owing = entries.filter(
        (e) => !["REJECTED", "CANCELLED"].includes(e.reg_status) &&
          Number(e.fee_inr || 0) > 0 && !["PAID", "REFUNDED"].includes(e.payment_status)
      );
      const needsCheckIn = entries.find(
        (e) => e.tournament_events?.tournaments?.status === "LIVE" &&
          ["CONFIRMED", "PENDING"].includes(e.reg_status) &&
          (!e.check_in_status || e.check_in_status === "NOT_CHECKED_IN")
      );
      if (owing.length) next = { kind: "PAY", entries: owing, total: owing.reduce((s, e) => s + Number(e.fee_inr || 0), 0) };
      else if (needsCheckIn) next = { kind: "CHECKIN", entry: needsCheckIn, tournament: needsCheckIn.tournament_events?.tournaments };
      else if (upcoming.length) next = { kind: "MATCH", ...upcoming[0] };
    }

    const tournaments = [...new Map(
      entries.map((e) => e.tournament_events?.tournaments).filter(Boolean).map((t) => [t.id, t])
    ).values()];

    const wins = completed.filter((c) => c.won).length;

    // "MATCH UPDATED" comes from the notification records the database wrote
    // when the schedule actually changed — not from guessing client-side.
    // Once the player has read the notification, the flag clears.
    const updatedMatchIds = new Set(
      notifications
        .filter((n) => !n.read && n.match_id &&
          ["MATCH_TIME_CHANGED", "COURT_CHANGED", "OPPONENT_CHANGED"].includes(n.type))
        .map((n) => n.match_id)
    );

    return { player, entries, upcoming, live, completed, next, tournaments, wins, updatedMatchIds };
  }, [data, notifications]);

  if (loading) return <BrandLoader />;
  if (!session) {
    return (
      <EmptyState
        icon={User} title="Sign in to see your matches"
        hint="Your registrations, schedule and results live in your MatchDay account."
        action={<Btn size="sm" className="mt-2" onClick={() => navigate("/login")}>Sign in</Btn>}
      />
    );
  }
  if (error) return <EmptyState icon={Trophy} title="Couldn't load your dashboard" hint={error} />;
  if (!view) return <BrandLoader />;

  const { player, entries, upcoming, live, completed, next, tournaments, wins, updatedMatchIds } = view;

  // A signed-in user with no player row hasn't finished onboarding yet.
  if (!player) {
    return (
      <EmptyState
        icon={User} title="Finish setting up your player profile"
        hint="Add your name and phone number so MatchDay can connect you to the tournaments you've entered."
        action={<Btn size="sm" className="mt-2" onClick={() => navigate("/me/profile")}>Set up profile</Btn>}
      />
    );
  }

  const upcomingTournaments = tournaments.filter((t) => ["REGISTRATION_OPEN", "REGISTRATION_CLOSED", "LIVE"].includes(t.status));
  const pastTournaments = tournaments.filter((t) => ["COMPLETED", "CANCELLED"].includes(t.status));

  return (
    <div className="space-y-6">
      {/* Identity strip */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {player.photo_url ? (
            <img src={player.photo_url} alt="" className="h-12 w-12 rounded-xl object-cover" />
          ) : (
            <motion.div
              initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.3 }}
              className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-accent-teal to-accent-blue font-display text-lg font-bold text-white"
            >
              {player.name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()}
            </motion.div>
          )}
          <div>
            <h1 className="text-xl font-bold text-ink">{player.name}</h1>
            <div className="text-xs text-ink-2">
              {entries.length} {entries.length === 1 ? "entry" : "entries"} · {completed.length} played · {wins} won
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Link to="/me/profile"><Btn size="sm" variant="secondary" icon={User}>Edit profile</Btn></Link>
          <Link to={`/p/${player.id}`}><Btn size="sm" variant="ghost">Public profile</Btn></Link>
        </div>
      </div>

      {/* THE answer */}
      <NextUp item={next} player={player} />

      {/* Match center */}
      <MatchCenter live={live} upcoming={upcoming} completed={completed} updatedMatchIds={updatedMatchIds} />

      <PlayerSeries playerId={player.id} />

      {/* Organizing is a capability of the same account, not a second one. */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-2">Tournaments I organize</h2>
          <Link to="/organizer" className="text-xs font-medium text-accent-teal hover:underline">Organizer workspace →</Link>
        </div>
        {organized.length === 0 ? (
          <Card className="px-4 py-6 text-center">
            <div className="text-sm font-semibold text-ink">You haven&apos;t organized a tournament yet</div>
            <p className="mx-auto mt-1 max-w-sm text-sm text-ink-2">
              You can run one from this same account — creating a tournament makes you its organizer without
              changing anything about your player profile.
            </p>
            <Link to="/organizer" className="mt-3 inline-block">
              <Btn size="sm" icon={Trophy}>Create a tournament</Btn>
            </Link>
          </Card>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {organized.slice(0, 6).map((t) => (
              <Link key={t.id} to={`/organizer/${t.id}`} className="block">
                <Card className="flex items-center justify-between gap-2 p-3 transition-colors hover:border-accent-teal/50">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-ink">{t.name}</div>
                    <div className="text-xs text-ink-3">{fmtDate(t.start_date)} · {t.venue}</div>
                  </div>
                  <Badge tone={TOURNAMENT_STATUS_META[t.status]?.tone ?? "slate"}>
                    {TOURNAMENT_STATUS_META[t.status]?.label ?? t.status}
                  </Badge>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Registrations */}
      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-2">My registrations</h2>
        {entries.length === 0 ? (
          <EmptyState icon={Ticket} title="No registrations yet"
            hint="Browse tournaments and enter a category to get started."
            action={<Link to="/" className="mt-2"><Btn size="sm" icon={Compass}>Find a tournament</Btn></Link>} />
        ) : (
          <div className="space-y-2">
            {entries.map((e) => (
              <EntryRow key={e.id} entry={e} event={e.tournament_events} tournament={e.tournament_events?.tournaments} />
            ))}
          </div>
        )}
      </section>

      {/* Tournaments */}
      {tournaments.length > 0 && (
        <section className="grid gap-5 sm:grid-cols-2">
          <div>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-2">Current & upcoming tournaments</h2>
            {upcomingTournaments.length === 0 ? <p className="text-sm text-ink-3">None right now.</p> : (
              <div className="space-y-2">
                {upcomingTournaments.map((t) => (
                  <Card key={t.id} className="flex items-center justify-between gap-2 p-3">
                    <div className="min-w-0">
                      <Link to={`/t/${t.slug}`} className="truncate text-sm font-medium text-ink hover:text-accent-teal">{t.name}</Link>
                      <div className="text-xs text-ink-3">{fmtDate(t.start_date)} · {t.venue}</div>
                    </div>
                    <Badge tone={TOURNAMENT_STATUS_META[t.status]?.tone ?? "slate"}>
                      {t.status === "LIVE" ? <><Radio size={10} className="animate-pulse" /> Live</> : TOURNAMENT_STATUS_META[t.status]?.label}
                    </Badge>
                  </Card>
                ))}
              </div>
            )}
          </div>
          <div>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-2">Past tournaments</h2>
            {pastTournaments.length === 0 ? <p className="text-sm text-ink-3">None yet.</p> : (
              <div className="space-y-2">
                {pastTournaments.map((t) => (
                  <Card key={t.id} className="p-3">
                    <Link to={`/t/${t.slug}`} className="text-sm font-medium text-ink hover:text-accent-teal">{t.name}</Link>
                    <div className="text-xs text-ink-3">{fmtDate(t.start_date)}</div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

    </div>
  );
}
