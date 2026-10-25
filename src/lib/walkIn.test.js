import { describe, it, expect } from "vitest";
import { parseWalkInList } from "./walkIn";

const names = (rows) => rows.map((r) => r.players.map((p) => p.name).join(" / "));

describe("parseWalkInList — singles", () => {
  it("reads a numbered WhatsApp list with optional phones", () => {
    const rows = parseWalkInList("1. Rahul Sharma 98765 43210\n2) Arjun\n\n- Kiran K");
    expect(names(rows)).toEqual(["Rahul Sharma", "Arjun", "Kiran K"]);
    expect(rows[0].players[0].phone).toBe("9876543210");
    expect(rows[1].players[0].phone).toBeNull();
    expect(rows.every((r) => r.errors.length === 0)).toBe(true);
  });

  it("strips copied WhatsApp message prefixes (iOS and Android)", () => {
    const rows = parseWalkInList(
      "[19/10/26, 7:42:10 PM] Ravi Coach: Sneha Reddy\n19/10/26, 7:45 pm - Ravi Coach: Divya +91 91234 56789"
    );
    expect(names(rows)).toEqual(["Sneha Reddy", "Divya"]);
    expect(rows[1].players[0].phone).toBe("919123456789");
  });

  it("skips headings and picks up 'paid' marks and emoji", () => {
    const rows = parseWalkInList("Men's singles:\n✅ Rahul (paid)\n👉 Arjun");
    expect(names(rows)).toEqual(["Rahul", "Arjun"]);
    expect(rows[0].paid).toBe(true);
    expect(rows[1].paid).toBe(false);
  });

  it("does not split a singles name on separators", () => {
    expect(names(parseWalkInList("Rahul & Co"))).toEqual(["Rahul & Co"]);
  });
});

describe("parseWalkInList — doubles", () => {
  it("splits pairs on common separators", () => {
    const rows = parseWalkInList("Rahul / Arjun\nSneha & Divya\nKiran and Ravi\nAmit + Sumit", { isDoubles: true });
    expect(names(rows)).toEqual(["Rahul / Arjun", "Sneha / Divya", "Kiran / Ravi", "Amit / Sumit"]);
  });

  it("keeps each partner's phone with the right name", () => {
    const [row] = parseWalkInList("Rahul, 98765 43210 / Arjun +91 91234 56789", { isDoubles: true });
    expect(row.players).toEqual([
      { name: "Rahul", phone: "9876543210" },
      { name: "Arjun", phone: "919123456789" },
    ]);
  });

  it("flags a line that isn't a pair", () => {
    const [row] = parseWalkInList("Rahul", { isDoubles: true });
    expect(row.errors).toContain("Needs two names, e.g. Rahul / Arjun");
  });
});

describe("parseWalkInList — duplicates", () => {
  it("marks names already in the category and repeats within the paste", () => {
    const rows = parseWalkInList("Rahul\narjun\nArjun ", { existingNames: ["Rahul"] });
    expect(rows.map((r) => r.duplicate)).toEqual([true, false, true]);
  });
});

describe("parseWalkInList — doubles pairs written with a space", () => {
  // The organizer's WhatsApp list for Sunday mixed doubles, as sent.
  const LIST = `Who are all in for Sunday mixed doubles

1. Rathi ajith
2. Appurva Rajesh
8. Arjun pair
13. Suchitra Dinesh Karthick
19. Sowmiya Magesh`;

  it("splits two words into partners and names the partner of an 'X pair'", () => {
    const rows = parseWalkInList(LIST, { isDoubles: true });
    const ok = rows.filter((r) => r.errors.length === 0).map((r) => r.players.map((p) => p.name).join(" / "));
    expect(ok).toEqual(["Rathi / Ajith", "Appurva / Rajesh", "Arjun / Arjun's partner", "Sowmiya / Magesh"]);
  });

  it("asks for a / when three words could split either way", () => {
    const rows = parseWalkInList(LIST, { isDoubles: true });
    const bad = rows.find((r) => r.line.includes("Suchitra"));
    expect(bad.errors[0]).toMatch(/put \/ between the partners/);
    const fixed = parseWalkInList("Suchitra / Dinesh Karthick", { isDoubles: true })[0];
    expect(fixed.players.map((p) => p.name)).toEqual(["Suchitra", "Dinesh Karthick"]);
  });

  it("still keeps a single name as an error", () => {
    expect(parseWalkInList("Rahul", { isDoubles: true })[0].errors.length).toBe(1);
  });
});
