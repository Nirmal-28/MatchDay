// Tournament exports. Deliberately dependency-free: the browser can build a
// CSV blob and print a stylesheet-scoped view without a spreadsheet or PDF
// library, and adding one would be weight for no capability.
//
// The parsing counterpart (CSV import) lives in ./csv.js.

import {
  entryName, divisionLabel, fmtDateTime, matchStageLabel, roundLabel,
  BadmintonScoringEngine, toAB, computeStandings, REG_STATUS_META, PAY_STATUS_META,
} from "./engines";

/* ------------------------------- CSV core -------------------------------- */

// Excel and Sheets both treat a leading =, +, - or @ as a formula. Prefixing
// with a single quote keeps a name like "-Ravi" text rather than something
// the spreadsheet tries to evaluate.
function cell(value) {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers, rows) {
  return [headers.map(cell).join(","), ...rows.map((r) => r.map(cell).join(","))].join("\r\n");
}

export function downloadCsv(filename, headers, rows) {
  // The BOM makes Excel open UTF-8 (₹, names with accents) correctly.
  const blob = new Blob(["﻿", toCsv(headers, rows)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const slug = (s) => (s || "matchday").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export const exportFilename = (tournament, kind) =>
  `${slug(tournament?.name)}-${kind}-${new Date().toISOString().slice(0, 10)}.csv`;

/* ------------------------------ Builders --------------------------------- */

// One row per player, which is what an organizer needs for a check-in desk
// list or a mail merge — a doubles pair becomes two rows sharing an entry id.
export function participantsCsv(events, entriesByEvent) {
  const headers = [
    "Entry ID", "Division", "Category", "Age group", "Grade", "Type", "Player name",
    "Phone", "Email", "Seed", "Registration status", "Payment status", "Check-in status", "Check-in code", "Fee (INR)", "Registered at",
  ];
  const rows = [];
  events.forEach((ev) => {
    (entriesByEvent[ev.id] || []).forEach((en) => {
      const players = en.entry_players?.length ? en.entry_players : [{ name: "(no player recorded)" }];
      players.forEach((p) => {
        rows.push([
          en.id, divisionLabel(ev), ev.category, ev.age_group || "OPEN", ev.skill_grade || "",
          en.type, p.name, p.phone || "", p.email || "", en.seed ?? "",
          REG_STATUS_META[en.reg_status]?.label || en.reg_status,
          PAY_STATUS_META[en.payment_status]?.label || en.payment_status,
          en.check_in_status || "NOT_CHECKED_IN", en.check_in_code || "",
          Number(en.fee_inr || 0), en.created_at || "",
        ]);
      });
    });
  });
  return { headers, rows };
}

// One row per entry — the team view, so a doubles pair is a single line.
export function teamsCsv(events, entriesByEvent) {
  const headers = ["Entry ID", "Division", "Type", "Team", "Player 1", "Player 2", "Seed", "Registration status", "Payment status"];
  const rows = [];
  events.forEach((ev) => {
    (entriesByEvent[ev.id] || []).forEach((en) => {
      const ps = en.entry_players || [];
      rows.push([
        en.id, divisionLabel(ev), en.type, entryName(en),
        ps[0]?.name || "", ps[1]?.name || "", en.seed ?? "",
        REG_STATUS_META[en.reg_status]?.label || en.reg_status,
        PAY_STATUS_META[en.payment_status]?.label || en.payment_status,
      ]);
    });
  });
  return { headers, rows };
}

export function scheduleCsv(events, matchesByEvent, entriesById, courts = []) {
  const courtName = (m) => m.court || courts.find((c) => c.id === m.court_id)?.name || "";
  const headers = ["Date & time", "Court", "Division", "Stage", "Match #", "Side A", "Side B", "Status"];
  const rows = [];
  events.forEach((ev) => {
    (matchesByEvent[ev.id] || [])
      .filter((m) => !m.is_bye)
      .sort((a, b) => (a.scheduled_at || "~").localeCompare(b.scheduled_at || "~") || a.match_number - b.match_number)
      .forEach((m) => {
        rows.push([
          m.scheduled_at ? fmtDateTime(m.scheduled_at) : "TBD", courtName(m),
          divisionLabel(ev), matchStageLabel(m, ev), m.match_number,
          entryName(entriesById[m.entry_a]), entryName(entriesById[m.entry_b]), m.status,
        ]);
      });
  });
  return { headers, rows };
}

export function resultsCsv(events, matchesByEvent, entriesById) {
  const headers = ["Division", "Stage", "Match #", "Side A", "Side B", "Winner", "Games", "Game scores", "Status", "Completed at"];
  const rows = [];
  events.forEach((ev) => {
    (matchesByEvent[ev.id] || [])
      .filter((m) => ["COMPLETED", "WALKOVER"].includes(m.status))
      .sort((a, b) => a.round - b.round || a.match_number - b.match_number)
      .forEach((m) => {
        const games = [...(m.games || [])].sort((a, b) => a.game_number - b.game_number);
        const tally = BadmintonScoringEngine.gameTally(toAB(games));
        rows.push([
          divisionLabel(ev), matchStageLabel(m, ev), m.match_number,
          entryName(entriesById[m.entry_a]), entryName(entriesById[m.entry_b]),
          entryName(entriesById[m.winner_entry_id]),
          `${tally.a}-${tally.b}`,
          games.map((g) => `${g.score_a}-${g.score_b}`).join(" "),
          m.retired ? "RETIRED" : m.status, m.completed_at || "",
        ]);
      });
  });
  return { headers, rows };
}

// Standings only exist for formats that produce a table — round robin and
// the group phase of groups→knockout. A pure knockout has a bracket, not a
// table, so it is skipped rather than faked.
export function standingsCsv(events, matchesByEvent, entriesById) {
  const headers = ["Division", "Group", "Pos", "Team", "Played", "Won", "Lost", "Games for", "Games against", "Points for", "Points against"];
  const rows = [];
  events.forEach((ev) => {
    const matches = (matchesByEvent[ev.id] || []).filter((m) => m.group_label);
    if (!matches.length) return;
    const groups = [...new Set(matches.map((m) => m.group_label))].sort();
    groups.forEach((g) => {
      const groupMatches = matches.filter((m) => m.group_label === g);
      const ids = [...new Set(groupMatches.flatMap((m) => [m.entry_a, m.entry_b]).filter(Boolean))];
      computeStandings(ids, groupMatches).forEach((r, i) => {
        rows.push([
          divisionLabel(ev), g === "RR" ? "Round robin" : `Group ${g}`, i + 1,
          entryName(entriesById[r.entryId]), r.played, r.won, r.lost,
          r.gamesFor, r.gamesAgainst, r.pointsFor, r.pointsAgainst,
        ]);
      });
    });
  });
  return { headers, rows };
}

export function hasStandings(events, matchesByEvent) {
  return events.some((ev) => (matchesByEvent[ev.id] || []).some((m) => m.group_label));
}

/* ------------------------------- Printing -------------------------------- */

// Prints one element by cloning it into a bare document. This keeps the app's
// dark theme and chrome out of the printout — organizers print schedules and
// draw sheets to pin on a wall, and ink-heavy dark backgrounds are unusable
// for that.
export function printSection(node, title = "MatchDay") {
  if (!node) return;
  const win = window.open("", "_blank", "width=980,height=720");
  if (!win) return;
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>
  *{box-sizing:border-box}
  body{font:12px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:#111;background:#fff;margin:24px}
  h1{font-size:18px;margin:0 0 2px}
  .meta{color:#555;font-size:11px;margin-bottom:16px}
  table{width:100%;border-collapse:collapse;margin-bottom:16px}
  th,td{border:1px solid #bbb;padding:5px 7px;text-align:left;vertical-align:top}
  th{background:#f1f1f1;font-size:10px;text-transform:uppercase;letter-spacing:.04em}
  button,input,select,svg.no-print{display:none!important}
  .badge,[data-print-hide]{display:none!important}
  @page{margin:14mm}
</style></head><body>
<h1>${title}</h1><div class="meta">Generated ${new Date().toLocaleString("en-IN")} · MatchDay</div>
${node.innerHTML}
</body></html>`);
  win.document.close();
  win.focus();
  // Give the cloned markup a tick to lay out before the print dialog opens.
  setTimeout(() => { win.print(); }, 250);
}

export { roundLabel };
