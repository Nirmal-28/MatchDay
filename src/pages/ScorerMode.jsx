import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, Lock, Radio } from "lucide-react";
import { CATEGORY_META, entryShort, matchStageLabel } from "../lib/engines";
import {
  getTournament, listEvents, listEntries, listMatches, getMyRole, getMatch,
  startMatch, scorePoint, undoLastGame, retireMatch, subscribeToEvent,
} from "../lib/repository";
import { BrandLoader, LivePulse } from "../components/ui/motion";
import { EmptyState, Badge } from "../components/ui/primitives";
import ScorerPanel from "../components/ScorerPanel";
import ConnectionBanner from "../components/ConnectionBanner";
import { useAuth } from "../lib/AuthContext";
import { enqueue, registerHandler, drain } from "../lib/offlineQueue";

// Venue wifi drops. Every scoring write goes through the durable queue in
// offlineQueue.js so a lost connection costs nothing: the taps are kept on
// the device, in order, and sent when the signal returns. Registered here
// rather than inside the queue so that module never imports the repository.
registerHandler("scorePoint", (matchId, side, delta) => scorePoint(matchId, side, delta));
registerHandler("startMatch", (matchId) => startMatch(matchId));
registerHandler("undoLastGame", (matchId) => undoLastGame(matchId));
registerHandler("retireMatch", (matchId, side) => retireMatch(matchId, side));

// A separate, mobile-first shell for courtside scoring — deliberately NOT
// the organizer control center. One job: get a scorer from "which match" to
// "point scored" in as few taps as possible, with nothing else competing
// for attention on a small screen in bright sunlight.
export default function ScorerMode() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [role, setRole] = useState(undefined); // undefined = checking, null = denied
  const [tournament, setTournament] = useState(null);
  const [events, setEvents] = useState([]);
  const [entriesById, setEntriesById] = useState({});
  const [matches, setMatches] = useState([]);
  const [openMatchId, setOpenMatchId] = useState(null);
  const { session } = useAuth();
  const userId = session?.user?.id;

  const loadAll = useCallback(async () => {
    const [t, evs] = await Promise.all([getTournament(id), listEvents(id)]);
    setTournament(t);
    setEvents(evs);
    const results = await Promise.all(evs.map(async (e) => ({ entries: await listEntries(e.id), matches: await listMatches(e.id) })));
    const eb = {};
    results.forEach((r) => r.entries.forEach((en) => (eb[en.id] = en)));
    setEntriesById(eb);
    setMatches(results.flatMap((r) => r.matches));
  }, [id]);

  // A read that fails because the connection is gone must not throw into the
  // click handler — the queue already holds the write, and the banner already
  // tells the scorer what is unsent. Crashing here would be the one thing
  // worse than a stale number on screen.
  const refresh = useCallback(async (fn) => {
    try { await fn(); } catch { /* offline: keep the last known state */ }
  }, []);

  useEffect(() => {
    getMyRole(id).then((r) => setRole(r || null));
  }, [id]);

  useEffect(() => { if (role) loadAll(); }, [role, loadAll]);

  useEffect(() => {
    if (events.length === 0) return;
    const unsubs = events.map((e) => subscribeToEvent(e.id, loadAll));
    return () => unsubs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events.map((e) => e.id).join(",")]);

  if (role === undefined) return <BrandLoader label="Checking access…" />;
  if (role === null) {
    return (
      <div className="mx-auto max-w-sm py-16 text-center">
        <Lock className="mx-auto mb-3 text-ink-3" size={28} />
        <h1 className="text-lg font-semibold text-ink">Scorer access required</h1>
        <p className="mt-1 text-sm text-ink-2">You need to be added as a scorer, referee, or organizer for this tournament.</p>
      </div>
    );
  }
  if (!tournament) return <BrandLoader />;

  const eventById = Object.fromEntries(events.map((e) => [e.id, e]));
  const openMatch = matches.find((m) => m.id === openMatchId);

  // Every scorer/referee can still cover any court — courts get reassigned all
  // the time and a locked-down list would be worse than useless mid-session.
  // What the assignment does is put YOUR matches first and label them, so the
  // list answers "which one is mine?" without hiding the rest.
  const mine = (m) => m.scorer_id === userId || m.referee_id === userId;
  const scorable = matches
    .filter((m) => m.status === "LIVE" || m.status === "READY")
    .sort((a, b) => (mine(b) ? 1 : 0) - (mine(a) ? 1 : 0) ||
      (a.scheduled_at || "~").localeCompare(b.scheduled_at || "~"));
  const assignedCount = scorable.filter(mine).length;

  return (
    <div className="mx-auto min-h-screen max-w-lg bg-navy-950 px-3 py-4 text-white">
      <div className="mb-4 flex items-center justify-between">
        {openMatch ? (
          <button className="flex items-center gap-1 text-sm text-ink-3" onClick={() => setOpenMatchId(null)}><ChevronLeft size={16} /> Courts</button>
        ) : (
          <button className="flex items-center gap-1 text-sm text-ink-3" onClick={() => navigate(-1)}><ChevronLeft size={16} /> Back</button>
        )}
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wide text-accent-teal">Scorer mode · {role}</div>
          <div className="text-sm font-semibold">{tournament.name}</div>
        </div>
      </div>

      <ConnectionBanner />

      {openMatch ? (
        <ScorerPanel
          match={openMatch} event={eventById[openMatch.event_id]} entriesById={entriesById}
          tournamentId={tournament.id}
          onStart={async (mid) => { enqueue("startMatch", [mid]); await drain(); await refresh(loadAll); }}
          onScore={async (mid, side, delta) => {
            enqueue("scorePoint", [mid, side, delta]);
            await drain();
            // Re-read rather than guessing: the server may have closed the
            // game, opened the next one, or completed the match. If we are
            // offline this read fails and the screen keeps its last known
            // state — the banner is what tells the scorer the truth.
            await refresh(async () => {
              const fresh = await getMatch(mid);
              if (fresh.status === "COMPLETED" || fresh.status === "WALKOVER") await loadAll();
              else setMatches((ms) => ms.map((m) => (m.id === mid ? fresh : m)));
            });
          }}
          onUndo={async (mid) => {
            enqueue("undoLastGame", [mid]);
            await drain();
            await refresh(async () => {
              const fresh = await getMatch(mid);
              setMatches((ms) => ms.map((m) => (m.id === mid ? fresh : m)));
            });
          }}
          onRetire={async (mid, side) => {
            enqueue("retireMatch", [mid, side]);
            await drain();
            await refresh(loadAll);
            setOpenMatchId(null);
          }}
        />
      ) : scorable.length === 0 ? (
        <EmptyState icon={Radio} title="No matches ready to score" hint="Matches show up here once they're scheduled and ready to start." />
      ) : (
        <div className="space-y-2">
          {assignedCount > 0 && (
            <div className="pb-1 text-[11px] uppercase tracking-wide text-accent-teal">
              {assignedCount} assigned to you
            </div>
          )}
          {scorable.map((m) => {
            const ev = eventById[m.event_id];
            const isMine = mine(m);
            return (
              <button key={m.id} onClick={() => setOpenMatchId(m.id)}
                className={`block w-full rounded-lg border p-4 text-left active:bg-white/10 ${isMine ? "border-accent-teal/50 bg-accent-teal/10" : "border-white/10 bg-white/5"}`}>
                <div className="mb-1 flex flex-wrap items-center justify-between gap-1.5">
                  <div className="flex items-center gap-1.5">
                    <Badge tone="slate" className="border-white/20 bg-white/10 text-white">{m.court || "Court —"}</Badge>
                    {isMine && (
                      <Badge tone="teal">
                        {m.referee_id === userId && m.scorer_id === userId ? "Yours" : m.referee_id === userId ? "You referee" : "You score"}
                      </Badge>
                    )}
                  </div>
                  {m.status === "LIVE" ? <LivePulse /> : <Badge tone="teal">Ready</Badge>}
                </div>
                <div className="md-eyebrow">{CATEGORY_META[ev.category].label} · {matchStageLabel(m, ev)}</div>
                <div className="mt-1 text-base font-semibold">{entryShort(entriesById[m.entry_a])} <span className="text-ink-3">vs</span> {entryShort(entriesById[m.entry_b])}</div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
