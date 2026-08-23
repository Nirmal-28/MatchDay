import { useRef } from "react";
import { Download, Printer, FileSpreadsheet } from "lucide-react";
import {
  divisionLabel, entryName, entryShort, matchStageLabel, fmtDateTime, fmtDate, roundLabel,
  BadmintonScoringEngine, toAB, computeStandings,
} from "../lib/engines";
import {
  participantsCsv, teamsCsv, scheduleCsv, resultsCsv, standingsCsv, hasStandings,
  downloadCsv, exportFilename, printSection,
} from "../lib/exports";
import { Btn, Card } from "../components/ui/primitives";

// Exports run entirely in the browser: a CSV is a Blob, and a print view is a
// second window with its own light stylesheet. No spreadsheet or PDF library
// is pulled in for either — neither would add a capability here.

function ExportRow({ title, hint, count, onDownload, disabled }) {
  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 p-3.5">
      <div className="min-w-0">
        <div className="text-sm font-semibold text-ink">{title}</div>
        <div className="text-[11px] text-ink-3">{disabled ? hint : `${count} row${count === 1 ? "" : "s"} · ${hint}`}</div>
      </div>
      <Btn size="sm" variant="secondary" icon={Download} disabled={disabled} onClick={onDownload}>CSV</Btn>
    </Card>
  );
}

export default function ExportsPanel({ tournament, events, courts, entriesByEvent, matchesByEvent, entriesById, notify }) {
  const scheduleRef = useRef(null);
  const bracketRef = useRef(null);
  const participantsRef = useRef(null);
  const resultsRef = useRef(null);

  const grab = (builder, kind, label) => () => {
    const { headers, rows } = builder;
    if (!rows.length) { notify?.(`Nothing to export for ${label} yet.`, "error"); return; }
    downloadCsv(exportFilename(tournament, kind), headers, rows);
    notify?.(`${label} CSV downloaded.`);
  };

  const participants = participantsCsv(events, entriesByEvent);
  const teams = teamsCsv(events, entriesByEvent);
  const schedule = scheduleCsv(events, matchesByEvent, entriesById, courts);
  const results = resultsCsv(events, matchesByEvent, entriesById);
  const standings = standingsCsv(events, matchesByEvent, entriesById);
  const standingsExist = hasStandings(events, matchesByEvent);

  const allMatches = events.flatMap((e) => (matchesByEvent[e.id] || []).map((m) => ({ ...m, _event: e })));
  const scheduled = allMatches
    .filter((m) => !m.is_bye)
    .sort((a, b) => (a.scheduled_at || "~").localeCompare(b.scheduled_at || "~"));
  const finished = allMatches.filter((m) => ["COMPLETED", "WALKOVER"].includes(m.status));

  const print = (ref, title) => printSection(ref.current, `${tournament.name} — ${title}`);

  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-2">
          <FileSpreadsheet size={13} /> Spreadsheet exports
        </h3>
        <div className="space-y-2">
          <ExportRow title="Participants" hint="one row per player, with contact details, seed, payment and check-in status"
            count={participants.rows.length} disabled={!participants.rows.length}
            onDownload={grab(participants, "participants", "Participants")} />
          <ExportRow title="Teams / entries" hint="one row per entry — a doubles pair on a single line"
            count={teams.rows.length} disabled={!teams.rows.length}
            onDownload={grab(teams, "teams", "Teams")} />
          <ExportRow title="Schedule" hint="every match with its court, time and line-up"
            count={schedule.rows.length} disabled={!schedule.rows.length}
            onDownload={grab(schedule, "schedule", "Schedule")} />
          <ExportRow title="Results" hint="completed matches with winners and game-by-game scores"
            count={results.rows.length} disabled={!results.rows.length}
            onDownload={grab(results, "results", "Results")} />
          <ExportRow
            title="Standings"
            hint={standingsExist ? "group and round-robin tables" : "only produced by round-robin and group formats — this tournament has none"}
            count={standings.rows.length} disabled={!standings.rows.length}
            onDownload={grab(standings, "standings", "Standings")} />
        </div>
        <p className="mt-2 text-[11px] text-ink-3">
          Files are UTF-8 with a byte-order mark so Excel opens ₹ and non-ASCII names correctly.
        </p>
      </section>

      <section>
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-2">
          <Printer size={13} /> Print-friendly views
        </h3>
        <div className="flex flex-wrap gap-2">
          <Btn size="sm" variant="secondary" icon={Printer} disabled={!scheduled.length} onClick={() => print(scheduleRef, "Schedule")}>Schedule</Btn>
          <Btn size="sm" variant="secondary" icon={Printer} disabled={!participants.rows.length} onClick={() => print(participantsRef, "Participants")}>Participants</Btn>
          <Btn size="sm" variant="secondary" icon={Printer} disabled={!allMatches.length} onClick={() => print(bracketRef, "Draw sheet")}>Draw sheet</Btn>
          <Btn size="sm" variant="secondary" icon={Printer} disabled={!finished.length} onClick={() => print(resultsRef, "Results")}>Results</Btn>
        </div>
        <p className="mt-2 text-[11px] text-ink-3">
          Each opens a light, ink-friendly page in a new tab and calls up the print dialog — meant for a wall
          at the venue or a referee&apos;s clipboard.
        </p>
      </section>

      {/* Hidden print sources. Kept out of the visual flow but in the DOM so
          they can be cloned into a clean print window on demand. */}
      <div className="hidden">
        <div ref={scheduleRef}>
          <table>
            <thead>
              <tr><th>Time</th><th>Court</th><th>Category</th><th>Stage</th><th>Side A</th><th>Side B</th><th>Status</th></tr>
            </thead>
            <tbody>
              {scheduled.map((m) => (
                <tr key={m.id}>
                  <td>{m.scheduled_at ? fmtDateTime(m.scheduled_at) : "TBD"}</td>
                  <td>{m.court || courts.find((c) => c.id === m.court_id)?.name || ""}</td>
                  <td>{divisionLabel(m._event)}</td>
                  <td>{matchStageLabel(m, m._event)}</td>
                  <td>{entryName(entriesById[m.entry_a])}</td>
                  <td>{entryName(entriesById[m.entry_b])}</td>
                  <td>{m.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div ref={participantsRef}>
          {events.map((ev) => (
            <div key={ev.id}>
              <h2>{divisionLabel(ev)}</h2>
              <table>
                <thead><tr><th>#</th><th>Entry</th><th>Seed</th><th>Reg.</th><th>Payment</th><th>Check-in code</th><th>Signature</th></tr></thead>
                <tbody>
                  {(entriesByEvent[ev.id] || []).map((en, i) => (
                    <tr key={en.id}>
                      <td>{i + 1}</td>
                      <td>{entryName(en)}</td>
                      <td>{en.seed ?? ""}</td>
                      <td>{en.reg_status}</td>
                      <td>{en.payment_status}</td>
                      <td>{en.check_in_code || ""}</td>
                      <td style={{ width: "22%" }}>&nbsp;</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>

        <div ref={bracketRef}>
          {events.map((ev) => {
            const ms = (matchesByEvent[ev.id] || []).filter((m) => !m.is_bye);
            if (!ms.length) return null;
            const groups = [...new Set(ms.map((m) => m.group_label).filter(Boolean))].sort();
            return (
              <div key={ev.id}>
                <h2>{divisionLabel(ev)}</h2>
                {groups.map((g) => {
                  const gm = ms.filter((m) => m.group_label === g);
                  const ids = [...new Set(gm.flatMap((m) => [m.entry_a, m.entry_b]).filter(Boolean))];
                  return (
                    <div key={g}>
                      <h3>{g === "RR" ? "Round robin" : `Group ${g}`}</h3>
                      <table>
                        <thead><tr><th>Pos</th><th>Team</th><th>P</th><th>W</th><th>L</th><th>Games</th></tr></thead>
                        <tbody>
                          {computeStandings(ids, gm).map((r, i) => (
                            <tr key={r.entryId}>
                              <td>{i + 1}</td><td>{entryName(entriesById[r.entryId])}</td>
                              <td>{r.played}</td><td>{r.won}</td><td>{r.lost}</td>
                              <td>{r.gamesFor}–{r.gamesAgainst}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })}
                <table>
                  <thead><tr><th>Round</th><th>#</th><th>Side A</th><th>Side B</th><th>Court / time</th><th>Score</th></tr></thead>
                  <tbody>
                    {ms.filter((m) => !m.group_label)
                      .sort((a, b) => a.round - b.round || a.match_number - b.match_number)
                      .map((m) => (
                        <tr key={m.id}>
                          <td>{ev.total_rounds ? roundLabel(m.round, ev.total_rounds) : `Round ${m.round}`}</td>
                          <td>{m.match_number}</td>
                          <td>{entryName(entriesById[m.entry_a])}</td>
                          <td>{entryName(entriesById[m.entry_b])}</td>
                          <td>{m.court || ""} {m.scheduled_at ? fmtDateTime(m.scheduled_at) : ""}</td>
                          <td style={{ width: "18%" }}>&nbsp;</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>

        <div ref={resultsRef}>
          <table>
            <thead><tr><th>Category</th><th>Stage</th><th>Winner</th><th>Runner-up</th><th>Games</th><th>Scores</th><th>Date</th></tr></thead>
            <tbody>
              {finished.map((m) => {
                const games = [...(m.games || [])].sort((a, b) => a.game_number - b.game_number);
                const tally = BadmintonScoringEngine.gameTally(toAB(games));
                const loserId = m.winner_entry_id === m.entry_a ? m.entry_b : m.entry_a;
                return (
                  <tr key={m.id}>
                    <td>{divisionLabel(m._event)}</td>
                    <td>{matchStageLabel(m, m._event)}</td>
                    <td>{entryName(entriesById[m.winner_entry_id])}</td>
                    <td>{entryShort(entriesById[loserId])}</td>
                    <td>{tally.a}–{tally.b}</td>
                    <td>{games.map((g) => `${g.score_a}-${g.score_b}`).join("  ")}</td>
                    <td>{m.completed_at ? fmtDate(m.completed_at) : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
