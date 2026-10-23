import { useMemo, useState } from "react";
import { ClipboardPaste, ChevronDown, AlertCircle } from "lucide-react";
import { cx, entryName, CATEGORY_META, FORMAT_META } from "../lib/engines";
import { parseMatchups, planCustomDraw } from "../lib/matchups";
import { Btn, Badge, inputCls } from "./ui/primitives";

/* For the organizer who has already made the matchups, usually by pasting
   the WhatsApp list into ChatGPT. MatchDay takes those matches exactly as
   written instead of generating its own draw. */

const HOW = {
  SINGLE_ELIM: "Paste the first-round matches top to bottom. The winners of matches 1 and 2 meet next, then 3 and 4, and so on. Write \"Rahul vs bye\" for a free pass. Semifinal and final lines like \"Winner of Match 1\" are skipped because they fill in from results.",
  ROUND_ROBIN: "Paste every match. \"Round 1\" / \"Round 2\" headings are kept if you have them.",
  GROUP_KO: "Put each group's matches under a \"Group A\", \"Group B\" heading. The knockout is built from the group results later, as usual.",
};

export default function CustomDrawPanel({ event, entries, disabled, disabledReason, onCreate }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  const format = event.format || "SINGLE_ELIM";
  const isDoubles = CATEGORY_META[event.category].kind === "DOUBLES";
  const existing = useMemo(
    () => entries.filter((e) => ["PENDING", "CONFIRMED"].includes(e.reg_status)).map((e) => ({ id: e.id, name: entryName(e) })),
    [entries]
  );
  const plan = useMemo(
    () => planCustomDraw(parseMatchups(text, { isDoubles }), { format, existing }),
    [text, isDoubles, format, existing]
  );
  const newKeys = new Set(plan.newSides.map((s) => s.key));
  const ready = text.trim() && plan.problems.length === 0;

  const create = async () => {
    setSaving(true);
    try { await onCreate(plan); } finally { setSaving(false); }
  };

  return (
    <div className="rounded-lg border border-line bg-surface">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-4 py-3 text-left">
        <ClipboardPaste size={16} className="shrink-0 text-accent-teal" />
        <span className="flex-1">
          <span className="block text-sm font-semibold text-ink">Already made the matchups?</span>
          <span className="block text-xs text-ink-3">Paste them, from ChatGPT or anywhere, and MatchDay uses them exactly instead of making its own draw.</span>
        </span>
        <ChevronDown size={16} className={cx("shrink-0 text-ink-3 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="space-y-3 border-t border-line-soft px-4 py-3">
          <p className="text-xs text-ink-2">
            <Badge tone="teal">{FORMAT_META[format].label}</Badge>{" "}{HOW[format]}
            {" "}Change the format above first if this isn&apos;t the right one.
          </p>
          <textarea
            className={cx(inputCls, "min-h-[160px] resize-y font-mono text-xs")}
            placeholder={isDoubles
              ? "Match 1: Rahul / Arjun vs Kiran / Ravi\nMatch 2: Sneha / Divya vs Priya / Meera"
              : "Match 1: Rahul vs Arjun\nMatch 2: Kiran vs Sneha\nMatch 3: Divya vs Priya\nMatch 4: Meera vs bye"}
            value={text} onChange={(e) => setText(e.target.value)}
          />

          {plan.matches.length > 0 && (
            <div className="max-h-72 overflow-y-auto rounded-md border border-line">
              <table className="w-full text-left text-xs">
                <tbody className="divide-y divide-line-soft">
                  {plan.matches.map((m, i) => (
                    <tr key={i}>
                      <td className="w-14 px-2 py-1.5 text-ink-3">
                        {format === "GROUP_KO" ? (m.group ? `Grp ${m.group}` : "?") : format === "ROUND_ROBIN" ? `R${m.round}` : `M${i + 1}`}
                      </td>
                      <td className="px-2 py-1.5 text-ink">
                        {m.sides.map((s, j) => (
                          <span key={j}>
                            {j > 0 && <span className="px-1.5 text-ink-3">vs</span>}
                            {s ? s.players.map((p) => p.name).join(" / ") : <span className="text-ink-3">bye</span>}
                            {s && !s.errors.length && newKeys.has(s.key) && <Badge tone="indigo" className="ml-1">new</Badge>}
                          </span>
                        ))}
                        {m.errors.length > 0 && <div className="mt-0.5 text-red-400">{m.errors.join(", ")}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {text.trim() && plan.problems.length > 0 && (
            <div className="space-y-1 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {plan.problems.map((p) => <div key={p} className="flex gap-1.5"><AlertCircle size={12} className="mt-px shrink-0" />{p}</div>)}
            </div>
          )}
          {ready && plan.newSides.length > 0 && (
            <p className="text-xs text-ink-2">
              <Badge tone="indigo">new</Badge> {plan.newSides.length} name{plan.newSides.length === 1 ? " isn't" : "s aren't"} in this category yet and will be added as players.
              If one is a spelling difference (e.g. &ldquo;Rahul S&rdquo; vs &ldquo;Rahul Sharma&rdquo;), fix it in the text so it matches.
            </p>
          )}
          {ready && plan.unused.length > 0 && (
            <p className="text-xs text-amber-400">
              Not in any match, so won&apos;t play: {plan.unused.join(", ")}.
            </p>
          )}

          <div className="flex items-center justify-end gap-2">
            {disabled && disabledReason && <span className="text-xs text-ink-3">{disabledReason}</span>}
            <Btn size="sm" disabled={!ready || disabled || saving} onClick={create}>
              {saving ? "Creating…" : `Create draw from ${plan.matches.length} match${plan.matches.length === 1 ? "" : "es"}`}
            </Btn>
          </div>
        </div>
      )}
    </div>
  );
}
