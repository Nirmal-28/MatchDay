import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/* Guards audit finding F4: the control center must never render a control the
   database will refuse.

   This class of bug is invisible at runtime. An UPDATE blocked by RLS does not
   raise — it matches zero rows and returns success — so the `guarded()` wrapper
   has nothing to catch and no toast appears. The button just does nothing. The
   only defence is that the tab's `roles` list matches what RLS actually allows,
   and the only way to keep those in step as the schema evolves is to assert it.

   Two halves, both needed:
     1. ORG_TABS matches the permission map below.
     2. The map still matches the SQL — so if someone later loosens or tightens
        a policy, this fails instead of the UI silently drifting out of step. */

const ROOT = join(import.meta.dirname, "../..");
const SQL_DIR = join(ROOT, "supabase-integration/migrations");

const sqlText = [
  readFileSync(join(ROOT, "supabase-integration/schema.sql"), "utf8"),
  ...readdirSync(SQL_DIR).filter((f) => f.endsWith(".sql")).map((f) => readFileSync(join(SQL_DIR, f), "utf8")),
].join("\n");

// The tab list, read out of the source rather than duplicated here, so the
// test cannot silently pass against a stale copy.
function readOrgTabs() {
  const src = readFileSync(join(ROOT, "src/pages/TournamentControlCenter.jsx"), "utf8");
  const block = src.slice(src.indexOf("const ORG_TABS = ["));
  const body = block.slice(0, block.indexOf("\n];"));
  const tabs = {};
  for (const line of body.split("\n")) {
    const key = line.match(/key:\s*"([^"]+)"/);
    if (!key) continue;
    const roles = line.match(/roles:\s*\[([^\]]*)\]/);
    tabs[key[1]] = roles
      ? roles[1].split(",").map((r) => r.trim().replace(/"/g, "")).filter(Boolean)
      : null; // null = open to anyone with access
  }
  return tabs;
}

const ORG_TABS = readOrgTabs();

// Every non-OWNER role that can hold a tournament_members row.
const STAFF_ROLES = ["ORGANIZER", "ADMIN", "REFEREE", "SCORER", "VOLUNTEER"];

describe("ORG_TABS is a complete, parseable list", () => {
  it("found the tabs", () => {
    expect(Object.keys(ORG_TABS).length).toBeGreaterThan(10);
    expect(ORG_TABS).toHaveProperty("settings");
    expect(ORG_TABS).toHaveProperty("live");
  });
});

/* ── 1. Owner-only tabs ────────────────────────────────────────────────────
   Every control on these writes (or reads) an owner-scoped table, so there is
   no useful read-only remainder — a staff member seeing them would get a page
   of dead controls. */
describe("tabs whose every action is owner-scoped are OWNER-only", () => {
  const ownerOnly = {
    settings: "tournaments UPDATE (owner_update_tournaments)",
    courts: "courts + court_availability writes (owner_*_courts)",
    staff: "tournament_members + tournament_invites (owner_manage_*)",
    finance: "payments SELECT (owner_select_payments -> is_entry_owner)",
    branding: "tournaments UPDATE (owner_update_tournaments)",
  };

  for (const [tab, why] of Object.entries(ownerOnly)) {
    it(`${tab} — ${why}`, () => {
      expect(ORG_TABS[tab], `${tab} tab is missing`).toBeTruthy();
      expect(ORG_TABS[tab]).toEqual(["OWNER"]);
    });
  }

  it("no staff role can open any of them", () => {
    for (const tab of Object.keys(ownerOnly)) {
      for (const role of STAFF_ROLES) {
        expect(ORG_TABS[tab].includes(role), `${role} must not see the ${tab} tab`).toBe(false);
      }
    }
  });
});

/* ── 2. Staff-writable tabs ───────────────────────────────────────────────
   These have real staff policies, so the roles listed must be exactly the
   roles those policies name — no more (dead controls), no fewer (lost work). */
describe("staff-writable tabs match their RLS policy roles exactly", () => {
  it("check-in matches staff_update_checkin (ORGANIZER/ADMIN/VOLUNTEER)", () => {
    expect(new Set(ORG_TABS.checkin)).toEqual(
      new Set(["OWNER", "ORGANIZER", "ADMIN", "VOLUNTEER"]));
  });

  it("live scoring matches can_score_match (ORGANIZER/ADMIN/REFEREE/SCORER)", () => {
    expect(new Set(ORG_TABS.live)).toEqual(
      new Set(["OWNER", "ORGANIZER", "ADMIN", "REFEREE", "SCORER"]));
  });

  it("disputes matches scorer_insert_disputes (ORGANIZER/ADMIN/REFEREE/SCORER)", () => {
    expect(new Set(ORG_TABS.disputes)).toEqual(
      new Set(["OWNER", "ORGANIZER", "ADMIN", "REFEREE", "SCORER"]));
  });
});

/* ── 3. The map still matches the SQL ─────────────────────────────────────
   If a future migration changes who may write, these fail — which is the
   signal to revisit the tab lists above rather than let them drift. */
describe("the RLS policies these decisions rest on still say what we think", () => {
  const ownerScoped = [
    ["owner_update_tournaments", /owner_update_tournaments[\s\S]{0,200}?organizer_id = \(select auth\.uid\(\)\)/],
    ["owner_update_courts", /owner_update_courts[\s\S]{0,200}?is_tournament_owner/],
    ["owner_manage_members", /owner_manage_members[\s\S]{0,200}?is_tournament_owner/],
    ["owner_manage_invites", /owner_manage_invites[\s\S]{0,200}?is_tournament_owner/],
    ["owner_select_payments", /owner_select_payments[\s\S]{0,200}?is_entry_owner/],
    ["owner_write_court_availability", /owner_write_court_availability[\s\S]{0,300}?is_tournament_owner/],
  ];

  for (const [name, re] of ownerScoped) {
    it(`${name} is still owner-scoped`, () => {
      expect(sqlText, `${name} changed shape — recheck the tab roles`).toMatch(re);
    });
  }

  it("staff_update_checkin still names ORGANIZER/ADMIN/VOLUNTEER", () => {
    const m = sqlText.match(/staff_update_checkin[\s\S]{0,400}?array\[([^\]]+)\]/);
    expect(m).toBeTruthy();
    expect(new Set(m[1].split(",").map((s) => s.trim().replace(/'/g, ""))))
      .toEqual(new Set(["ORGANIZER", "ADMIN", "VOLUNTEER"]));
  });

  it("can_score_match still names ORGANIZER/ADMIN/REFEREE/SCORER", () => {
    const m = sqlText.match(/function public\.can_score_match[\s\S]{0,400}?array\[([^\]]+)\]/);
    expect(m).toBeTruthy();
    expect(new Set(m[1].split(",").map((s) => s.trim().replace(/'/g, ""))))
      .toEqual(new Set(["ORGANIZER", "ADMIN", "REFEREE", "SCORER"]));
  });

  it("has_tournament_role still treats the owner as holding every role", () => {
    // Every tab list above assumes OWNER passes any has_tournament_role check.
    expect(sqlText).toMatch(
      /function public\.has_tournament_role[\s\S]{0,300}?is_tournament_owner\(t_id\) or exists/);
  });
});

/* ── 4. Known-mixed tabs are documented, not silently narrowed ────────────
   Participants, Draw and Schedule are readable by staff but their writes are
   owner-scoped. They intentionally remain visible with an in-tab explanation;
   this records that as a deliberate decision so it is not mistaken for the
   same bug F4 fixed. */
describe("mixed-permission tabs are deliberately still staff-visible", () => {
  for (const tab of ["participants", "draw", "schedule"]) {
    it(`${tab} remains visible to staff (with an owner-only notice in-tab)`, () => {
      expect(ORG_TABS[tab]).toContain("ORGANIZER");
    });
  }

  it("the control center renders a staff notice for exactly those tabs", () => {
    const src = readFileSync(join(ROOT, "src/pages/TournamentControlCenter.jsx"), "utf8");
    expect(src).toMatch(/!isOwner && \["participants", "draw", "schedule"\]\.includes\(activeTab\)/);
  });
});
