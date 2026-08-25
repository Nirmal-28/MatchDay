import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  MapPin, Trophy, UserCheck, CreditCard, Compass, ArrowRight,
  Ticket, ClipboardCheck, User, Heart, CalendarClock,
} from "lucide-react";
import {
  cx, fmtDate, fmtDateRange, fmtTime, relativeTime, inr, entryShort, divisionLabel,
  matchStageLabel, REG_STATUS_META, PAY_STATUS_META,
  CHECK_IN_META, TOURNAMENT_STATUS_META,
} from "../lib/engines";
import {
  getMyPlayerData, listMyNotifications, listMyTournaments,
  subscribeToMyNotifications, subscribeToMyMatches, listFollowedTournaments,
} from "../lib/repository";
import { useAuth } from "../lib/AuthContext";
import MatchCenter from "../components/MatchCenter";
import PlayerSeries from "../components/PlayerSeries";
import { Badge, Btn, EmptyState } from "../components/ui/primitives";
import { BrandLoader } from "../components/ui/motion";
import { SectionHeader, StatTile, StatusPill, Tabs } from "../components/ui/md";
import { useDocumentMeta } from "../lib/useDocumentMeta";

const DONE = ["COMPLETED", "WALKOVER"];

/* ═══════════════════════════════════════════════════════════════════════
   PLAYER DASHBOARD
   ═══════════════════════════════════════════════════════════════════════

   This is a sports app, not an admin console, and it answers exactly one
   question at the top of the screen: WHAT DO I NEED TO DO NOW?

   <NowCard/> is that answer, and it is the largest thing on the page. It
   takes one of five shapes depending on the player's real state — on court
   / next match / payment owed / check in / all clear — and each shape leads
   with the single fact that matters in that state: the score if you are
   playing, the time if you are about to, the code if you need to check in.

   The eight flat sections below it used to run to roughly four screens of
   equal-weight headings. Reference material (registrations, tournaments,
   organizing, following) now sits behind one tab strip, so the page ends
   where a player's attention does: their matches.

   All derivation is unchanged from before the redesign — same queries, same
   realtime subscriptions, same priority order in `view`. Nothing here is
   estimated, and an empty history renders empty rather than as zeroes.
   ══════════════════════════════════════════════════════════════════════ */

/* ── The answer ─────────────────────────────────────────────────────── */

function NowFrame({ tone = "var(--color-accent-teal)", eyebrow, children, live }) {
  return (
    <section
      className={cx(
        "md-court-texture md-edge relative overflow-hidden rounded-2xl border p-5 sm:p-7",
        live ? "md-live-surface" : "border-line bg-gradient-to-b from-navy-800 to-surface"
      )}
      style={{ "--md-edge": tone }}
      aria-live="polite"
    >
      <div className="md-eyebrow mb-3 flex items-center gap-2" style={{ color: tone }}>
        {live && <span className="md-live-dot" />}
        {eyebrow}
      </div>
      {children}
    </section>
  );
}

function NowCard({ item, player }) {
  if (!item) return null;
  const { kind } = item;

  /* ON COURT — the score is the headline. A player checking their phone
     between rallies should read it without focusing. */
  if (kind === "LIVE") {
    const { match, event, opponent, score } = item;
    return (
      <NowFrame tone="var(--color-live)" eyebrow="You are on court now" live>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="min-w-0">
            <div className="md-display text-4xl text-ink sm:text-5xl">
              {match.court || match.courts?.name || "Court TBD"}
            </div>
            <div className="mt-2 text-sm text-ink-2">
              {divisionLabel(event)} · {matchStageLabel(match, event)}
            </div>
            <div className="mt-4">
              <div className="md-eyebrow">Opponent</div>
              <div className="mt-0.5 text-lg font-semibold text-ink">{entryShort(opponent) || "TBD"}</div>
            </div>
          </div>
          {/* Keyed on the score so React remounts it when a point lands and
              the bump animation replays — motion that reports an event, not
              a loop that runs regardless. */}
          <div key={`${score.a}-${score.b}`} className="md-bump md-score text-6xl text-ink sm:text-7xl">
            {score.a}<span className="mx-1 text-ink-3">–</span>{score.b}
          </div>
        </div>
        <Link
          to={`/m/${match.id}`}
          className="mt-6 inline-flex h-11 items-center gap-2 rounded-lg bg-accent-teal px-5 text-sm font-bold uppercase tracking-wide text-navy-950 transition-[filter] hover:brightness-110"
        >
          Follow this match <ArrowRight size={15} />
        </Link>
      </NowFrame>
    );
  }

  /* NEXT MATCH — the time is the headline, with the countdown beside it.
     Court and opponent are the two facts a player needs to actually get to
     the right place against the right person. */
  if (kind === "MATCH") {
    const { match, event, opponent, entry, tournament } = item;
    const checkedIn = entry?.check_in_status === "CHECKED_IN";
    return (
      <NowFrame eyebrow="Your next match">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <div className="md-display text-5xl text-ink sm:text-6xl">
            {match.scheduled_at ? fmtTime(match.scheduled_at) : "TBD"}
          </div>
          {match.scheduled_at && (
            <div className="text-base font-semibold text-accent-teal">{relativeTime(match.scheduled_at)}</div>
          )}
        </div>
        <div className="mt-1.5 text-sm text-ink-2">
          {match.scheduled_at ? `${fmtDate(match.scheduled_at)} · ` : ""}{tournament?.name}
        </div>

        {/* The matchup, in the same net-divided form the shared MatchCard
            uses — so a player recognises the shape everywhere it appears. */}
        <div className="mt-5 rounded-xl border border-line bg-surface/70 p-4">
          <div className="text-base font-semibold text-ink">{player?.name || "You"}</div>
          <div className="my-2 flex items-center gap-2">
            <span className="h-px flex-1 bg-line-soft" />
            <span className="md-eyebrow text-[9px]">vs</span>
            <span className="h-px flex-1 bg-line-soft" />
          </div>
          <div className="text-base font-semibold text-ink">{entryShort(opponent) || "TBD"}</div>
        </div>

        <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
          <div className="rounded-lg border border-line bg-surface-2/60 px-3.5 py-2.5">
            <div className="md-eyebrow">Court</div>
            <div className="md-display mt-0.5 text-2xl text-ink">{match.court || match.courts?.name || "TBD"}</div>
          </div>
          <div className="rounded-lg border border-line bg-surface-2/60 px-3.5 py-2.5">
            <div className="md-eyebrow">Category</div>
            <div className="mt-1 truncate text-sm font-semibold text-ink">{divisionLabel(event)}</div>
          </div>
        </div>

        {/* Check-in is the one thing that can cost a player the match before
            they play it, so when it is outstanding it gets the accent colour
            and the code is set large enough to read across a desk. */}
        {!checkedIn && entry?.check_in_code && (
          <div
            className="md-edge mt-3 rounded-lg border border-line bg-surface px-4 py-3 pl-5"
            style={{ "--md-edge": "var(--color-closing)" }}
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <ClipboardCheck size={16} style={{ color: "var(--color-closing)" }} />
              <span className="text-sm font-semibold text-ink">Not checked in yet</span>
              <span className="md-score rounded bg-surface-2 px-2.5 py-1 text-xl tracking-[0.2em] text-ink">
                {entry.check_in_code}
              </span>
              <span className="text-xs text-ink-3">Show this at the desk</span>
            </div>
          </div>
        )}

        <Link
          to={`/m/${match.id}`}
          className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-accent-teal hover:underline"
        >
          Match details <ArrowRight size={14} />
        </Link>
      </NowFrame>
    );
  }

  /* PAYMENT OWED */
  if (kind === "PAY") {
    const { entries, total } = item;
    return (
      <NowFrame tone="var(--color-closing)" eyebrow="Action needed">
        <div className="flex items-start gap-4">
          <CreditCard size={22} className="mt-1 shrink-0" style={{ color: "var(--color-closing)" }} />
          <div>
            <h2 className="md-display text-3xl text-ink">
              {inr(total)} outstanding
            </h2>
            <p className="mt-2 max-w-lg text-sm leading-relaxed text-ink-2">
              {entries.length} {entries.length === 1 ? "entry is" : "entries are"} awaiting payment.
              Entry fees are collected by the organizer — contact them from the tournament page to
              settle, and your status here updates once they record it.
            </p>
          </div>
        </div>
      </NowFrame>
    );
  }

  /* CHECK IN — the code is the headline, because it is the only thing the
     player has to produce. */
  if (kind === "CHECKIN") {
    const { entry, tournament } = item;
    return (
      <NowFrame eyebrow="Action needed">
        <div className="flex items-start gap-4">
          <UserCheck size={22} className="mt-1 shrink-0 text-accent-teal" />
          <div className="min-w-0">
            <h2 className="md-display text-3xl text-ink">Check in now</h2>
            <p className="mt-1.5 text-sm text-ink-2">
              {tournament?.name} is under way. Show this code at the check-in desk.
            </p>
            {entry?.check_in_code && (
              <div className="md-score mt-4 inline-block rounded-xl border border-accent-teal/40 bg-accent-teal/10 px-5 py-3 text-4xl tracking-[0.22em] text-accent-teal">
                {entry.check_in_code}
              </div>
            )}
          </div>
        </div>
      </NowFrame>
    );
  }

  /* ALL CLEAR — an empty state that points somewhere rather than just
     reporting emptiness. */
  return (
    <NowFrame eyebrow="You are all set">
      <h2 className="md-display text-3xl text-ink sm:text-4xl">
        {player?.name ? `Nothing needs you right now, ${player.name.split(" ")[0]}.` : "Nothing needs you right now."}
      </h2>
      <p className="mt-2.5 max-w-md text-sm text-ink-2">
        No upcoming matches and no outstanding actions. The next one could be a
        tournament you have not entered yet.
      </p>
      <Link
        to="/"
        className="mt-5 inline-flex h-11 items-center gap-2 rounded-lg bg-accent-teal px-5 text-sm font-bold uppercase tracking-wide text-navy-950 transition-[filter] hover:brightness-110"
      >
        <Compass size={16} /> Find a tournament
      </Link>
    </NowFrame>
  );
}

/* ── Season record ──────────────────────────────────────────────────────
   Real figures from completed matches only. Hidden entirely rather than
   showing a row of zeroes to someone who has not played yet. */
function SeasonStats({ completed, wins, tournaments, titles }) {
  if (!completed.length) return null;
  const winPct = Math.round((wins / completed.length) * 100);
  return (
    <section>
      <SectionHeader eyebrow="Real results only" title="Your record" />
      <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-5">
        <StatTile label="Played" value={completed.length} />
        <StatTile label="Won" value={wins} tone="open" />
        <StatTile label="Win rate" value={`${winPct}%`} />
        <StatTile label="Tournaments" value={tournaments.length} />
        <StatTile label="Titles" value={titles} tone={titles > 0 ? "closing" : undefined} />
      </div>
    </section>
  );
}

/* ── Reference rows ─────────────────────────────────────────────────── */

function EntryRow({ entry, event, tournament }) {
  return (
    <div className="md-card p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Link
            to={tournament?.slug ? `/t/${tournament.slug}` : "#"}
            className="truncate font-semibold text-ink hover:text-accent-teal"
          >
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
            {entry.reg_status === "WAITLISTED"
              ? `Waitlist #${entry.waitlist_position ?? "—"}`
              : (REG_STATUS_META[entry.reg_status]?.label ?? entry.reg_status)}
          </Badge>
          {Number(entry.fee_inr || 0) > 0 && (
            <Badge tone={PAY_STATUS_META[entry.payment_status]?.tone ?? "slate"}>
              {PAY_STATUS_META[entry.payment_status]?.label ?? entry.payment_status}
            </Badge>
          )}
          <Badge tone={CHECK_IN_META[entry.check_in_status || "NOT_CHECKED_IN"]?.tone ?? "slate"}>
            {CHECK_IN_META[entry.check_in_status || "NOT_CHECKED_IN"]?.label}
          </Badge>
        </div>
      </div>
    </div>
  );
}

function TournamentRow({ t, to, right }) {
  return (
    <Link to={to} className="block">
      <div className="md-card md-card-link flex items-center justify-between gap-3 px-3.5 py-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-ink">{t.name}</div>
          <div className="truncate text-[11px] text-ink-3">
            {[t.venue, t.location].filter(Boolean).join(", ")}
            {t.start_date ? ` · ${fmtDateRange(t.start_date, t.end_date)}` : ""}
          </div>
        </div>
        <div className="shrink-0">{right}</div>
      </div>
    </Link>
  );
}

function statusRight(t) {
  return t.status === "LIVE"
    ? <StatusPill status="live" />
    : <Badge tone={TOURNAMENT_STATUS_META[t.status]?.tone ?? "slate"}>
        {TOURNAMENT_STATUS_META[t.status]?.label ?? t.status}
      </Badge>;
}

export default function PlayerDashboard() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [notifications, setNotifications] = useState([]);
  useDocumentMeta({ title: "Your matches" });
  const [organized, setOrganized] = useState([]);
  const [followed, setFollowed] = useState([]);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("entries");

  const load = useCallback(async () => {
    try {
      const [d, n, mine, follows] = await Promise.all([
        getMyPlayerData(),
        listMyNotifications(60).catch(() => []),
        listMyTournaments().catch(() => []),
        listFollowedTournaments().catch(() => []),
      ]);
      setData(d);
      setNotifications(n);
      setOrganized(mine);
      setFollowed(follows);
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

    // A title is winning the final of a knockout stage — the last round, and
    // not a group match (group rounds share the round numbering). Counted
    // rather than stored, so it can never drift from the actual results.
    const titles = completed.filter(
      (c) => c.won && !c.match.group_label &&
        c.event?.total_rounds && c.match.round === c.event.total_rounds
    ).length;

    // "MATCH UPDATED" comes from the notification records the database wrote
    // when the schedule actually changed — not from guessing client-side.
    // Once the player has read the notification, the flag clears.
    const updatedMatchIds = new Set(
      notifications
        .filter((n) => !n.read && n.match_id &&
          ["MATCH_TIME_CHANGED", "COURT_CHANGED", "OPPONENT_CHANGED"].includes(n.type))
        .map((n) => n.match_id)
    );

    return { player, entries, upcoming, live, completed, next, tournaments, wins, titles, updatedMatchIds };
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

  const { player, entries, upcoming, live, completed, next, tournaments, wins, titles, updatedMatchIds } = view;

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

  const tabs = [
    { key: "entries", label: "Registrations", count: entries.length },
    { key: "tournaments", label: "Tournaments", count: tournaments.length },
    { key: "following", label: "Following", count: followed.length },
    { key: "organizing", label: "Organizing", count: organized.length },
  ];

  return (
    <div className="space-y-8">
      {/* ── Identity ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3.5">
          {player.photo_url ? (
            <img src={player.photo_url} alt="" className="h-14 w-14 rounded-xl object-cover" />
          ) : (
            <div className="md-display flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-accent-teal to-accent-blue text-xl text-navy-950">
              {player.name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <h1 className="md-display text-3xl text-ink">{player.name}</h1>
            <div className="mt-0.5 text-xs text-ink-2">
              {entries.length} {entries.length === 1 ? "entry" : "entries"} · {completed.length} played · {wins} won
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Link to={`/p/${player.id}`}><Btn size="sm" variant="secondary">Public profile</Btn></Link>
          <Link to="/me/profile"><Btn size="sm" variant="ghost" icon={User}>Edit</Btn></Link>
        </div>
      </div>

      {/* ── THE answer ───────────────────────────────────────────────── */}
      <NowCard item={next} player={player} />

      {/* ── Matches ──────────────────────────────────────────────────── */}
      <MatchCenter live={live} upcoming={upcoming} completed={completed} updatedMatchIds={updatedMatchIds} />

      <SeasonStats completed={completed} wins={wins} tournaments={tournaments} titles={titles} />

      <PlayerSeries playerId={player.id} />

      {/* ── Reference material ───────────────────────────────────────────
          Four sections that each used to carry their own heading in one long
          column. They are reference, not action, so they share a tab strip
          and the page ends at a predictable height. */}
      <section>
        <SectionHeader eyebrow="Everything else" title="Your MatchDay" />
        <Tabs tabs={tabs} value={tab} onChange={setTab} ariaLabel="Your MatchDay sections" />

        <div className="pt-4">
          {tab === "entries" && (
            entries.length === 0 ? (
              <EmptyState
                icon={Ticket} title="No registrations yet"
                hint="Browse tournaments and enter a category to get started."
                action={<Link to="/" className="mt-2"><Btn size="sm" icon={Compass}>Find a tournament</Btn></Link>}
              />
            ) : (
              <div className="space-y-2">
                {entries.map((e) => (
                  <EntryRow key={e.id} entry={e} event={e.tournament_events} tournament={e.tournament_events?.tournaments} />
                ))}
              </div>
            )
          )}

          {tab === "tournaments" && (
            tournaments.length === 0 ? (
              <EmptyState icon={Trophy} title="No tournaments yet" hint="Tournaments you enter will be listed here." />
            ) : (
              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <div className="md-eyebrow mb-2">Current &amp; upcoming</div>
                  {upcomingTournaments.length === 0 ? (
                    <p className="text-sm text-ink-3">None right now.</p>
                  ) : (
                    <div className="space-y-2">
                      {upcomingTournaments.map((t) => (
                        <TournamentRow key={t.id} t={t} to={`/t/${t.slug}`} right={statusRight(t)} />
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <div className="md-eyebrow mb-2">Past</div>
                  {pastTournaments.length === 0 ? (
                    <p className="text-sm text-ink-3">None yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {pastTournaments.map((t) => (
                        <TournamentRow key={t.id} t={t} to={`/t/${t.slug}`} right={statusRight(t)} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )
          )}

          {tab === "following" && (
            followed.length === 0 ? (
              <EmptyState
                icon={Heart} title="Not following anything yet"
                hint="Follow a tournament to keep an eye on it without entering — results and schedule changes show up here."
                action={<Link to="/" className="mt-2"><Btn size="sm" icon={Compass}>Browse tournaments</Btn></Link>}
              />
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {followed.map((t) => (
                  <TournamentRow
                    key={t.id} t={t}
                    to={t.slug ? `/t/${t.slug}` : `/tournament/${t.id}`}
                    right={statusRight(t)}
                  />
                ))}
              </div>
            )
          )}

          {tab === "organizing" && (
            organized.length === 0 ? (
              <div className="md-card px-4 py-8 text-center">
                <div className="md-display text-2xl text-ink">You haven&apos;t organized a tournament yet</div>
                <p className="mx-auto mt-2 max-w-sm text-sm text-ink-2">
                  You can run one from this same account — creating a tournament makes you its
                  organizer without changing anything about your player profile.
                </p>
                <Link to="/organizer" className="mt-4 inline-block">
                  <Btn size="sm" icon={Trophy}>Create a tournament</Btn>
                </Link>
              </div>
            ) : (
              <>
                <div className="mb-2 flex justify-end">
                  <Link to="/organizer" className="text-xs font-semibold text-accent-teal hover:underline">
                    Organizer workspace →
                  </Link>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {organized.slice(0, 6).map((t) => (
                    <TournamentRow key={t.id} t={t} to={`/organizer/${t.id}`} right={statusRight(t)} />
                  ))}
                </div>
              </>
            )
          )}
        </div>
      </section>
    </div>
  );
}
