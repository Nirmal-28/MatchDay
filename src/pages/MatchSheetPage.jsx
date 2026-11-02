import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, Printer } from "lucide-react";
import { getTournament, listEntries, listEvents, listMatches } from "../lib/repository";
import { buildMatchSheet } from "../lib/matchSheet";
import { useDocumentMeta } from "../lib/useDocumentMeta";
import { BrandLoader } from "../components/ui/motion";
import { Btn } from "../components/ui/primitives";

/* Always black on white, whatever the site theme: this is designed for paper,
   and it reads the same on screen so what you see is what prints. Styles are
   under .md-sheet in index.css. */

function Blanks({ count }) {
  return Array.from({ length: count }, (_, i) => <td key={i} className="md-sheet-box" />);
}

function PlayerTable({ players }) {
  return (
    <table className="md-sheet-table">
      <thead>
        <tr><th>Player</th><th className="md-sheet-narrow">Here</th><th className="md-sheet-narrow">Won</th><th className="md-sheet-narrow">Lost</th><th className="md-sheet-narrow">Points</th><th className="md-sheet-narrow">Place</th></tr>
      </thead>
      <tbody>
        {players.map((p) => <tr key={p}><td>{p}</td><Blanks count={5} /></tr>)}
      </tbody>
    </table>
  );
}

function MatchTable({ matches, gameCount }) {
  const showTime = matches.some((m) => m.time || m.court);
  return (
    <table className="md-sheet-table">
      <thead>
        <tr>
          <th className="md-sheet-narrow">No.</th>
          {showTime && <th className="md-sheet-time">Time</th>}
          <th>Match</th>
          {Array.from({ length: gameCount }, (_, i) => <th key={i} className="md-sheet-narrow">{gameCount === 1 ? "Score" : `Game ${i + 1}`}</th>)}
        </tr>
      </thead>
      <tbody>
        {matches.map((m) => (
          <tr key={m.id}>
            <td>{m.number}</td>
            {showTime && <td>{m.time}{m.court && <div className="md-sheet-sub">{m.court}</div>}</td>}
            <td>{m.a || "____________"} <span className="md-sheet-vs">vs</span> {m.b || "____________"}{m.note && <div className="md-sheet-sub">{m.note}</div>}</td>
            {Array.from({ length: gameCount }, (_, i) => <td key={i} className="md-sheet-box">{m.games[i] || ""}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function MatchSheetPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const [tournament, events] = await Promise.all([getTournament(id), listEvents(id)]);
      const rows = await Promise.all(events.map(async (e) => ({
        id: e.id, entries: await listEntries(e.id), matches: await listMatches(e.id),
      })));
      setData({
        tournament, events,
        entriesByEvent: Object.fromEntries(rows.map((r) => [r.id, r.entries])),
        matchesByEvent: Object.fromEntries(rows.map((r) => [r.id, r.matches])),
      });
    })().catch((e) => setError(e.message));
  }, [id]);

  const sheet = useMemo(() => (data ? buildMatchSheet(data) : null), [data]);
  useDocumentMeta({ title: sheet ? `${sheet.title} match sheet` : "Match sheet" });

  if (error) return <div className="p-6 text-sm text-red-400">{error}</div>;
  if (!sheet) return <BrandLoader />;

  return (
    <div className="md-sheet">
      <div className="md-sheet-toolbar">
        <Btn size="sm" variant="secondary" icon={ChevronLeft} onClick={() => navigate(`/organizer/${id}`)}>Back</Btn>
        <Btn size="sm" icon={Printer} onClick={() => window.print()}>Print</Btn>
      </div>

      <header className="md-sheet-header">
        <h1>{sheet.title}</h1>
        <p>{sheet.meta}{sheet.meta && " · "}{sheet.rules}</p>
      </header>

      {sheet.categories.length === 0 && <p>No matches yet. Make the draw first, then print this sheet.</p>}

      {sheet.categories.map((c) => (
        <section key={c.id} className="md-sheet-category">
          <h2>{c.label} <span>{c.format}</span></h2>
          {c.sections.map((s) => (
            <div key={s.key} className="md-sheet-section">
              <h3>{s.title}</h3>
              {s.players.length > 0 && <PlayerTable players={s.players} />}
              <MatchTable matches={s.matches} gameCount={sheet.gameCount} />
            </div>
          ))}
          {c.knockoutToCome && (
            <div className="md-sheet-section">
              <h3>Knockout</h3>
              <p className="md-sheet-sub">{c.knockoutToCome.note}</p>
              <MatchTable
                gameCount={sheet.gameCount}
                matches={Array.from({ length: c.knockoutToCome.rows }, (_, i) => ({ id: i, number: "", a: "", b: "", games: [], time: "", court: "" }))}
              />
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
