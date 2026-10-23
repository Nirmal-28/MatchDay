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
