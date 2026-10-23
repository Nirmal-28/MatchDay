import { useMemo, useRef, useState } from "react";
import { ClipboardList, UserPlus, CheckCircle2, AlertCircle } from "lucide-react";
import { cx, divisionLabel, CATEGORY_META } from "../lib/engines";
import { parseWalkInList, normaliseName } from "../lib/walkIn";
import { Modal, Field, Btn, Badge, inputCls } from "./ui/primitives";

/* The organizer's way in — no player accounts, no registration steps.
   "Paste list" takes the WhatsApp list as-is; "One by one" is for the desk on
   the day. Everything added here is CONFIRMED straight away (see
   addWalkInEntries in repository.js), so it goes into the draw without a
   separate approve step.

   Mounted only while open (see ParticipantsPanel), so every open starts
   from a blank form without a reset effect. */

const blank = { name: "", phone: "", partnerName: "", partnerPhone: "", paid: false };

function Summary({ result }) {
  if (!result) return null;
  const { added, waitlisted, failed } = result;
  return (
    <div className="space-y-1 rounded-md border border-line bg-surface-2 px-3 py-2.5 text-sm">
      {added > 0 && <div className="flex items-center gap-1.5 text-emerald-400"><CheckCircle2 size={14} />{added} added and confirmed.</div>}
      {waitlisted > 0 && <div className="text-amber-400">{waitlisted} went to the waitlist, because the category is full.</div>}
      {failed.map((f, i) => (
        <div key={i} className="flex items-start gap-1.5 text-red-400">
          <AlertCircle size={13} className="mt-0.5 shrink-0" />
          <span>{f.item.players.map((p) => p.name).join(" / ")}: {f.error}</span>
        </div>
      ))}
    </div>
  );
}

export default function QuickAddModal({ open, onClose, event, existingNames = [], onAdd }) {
  const isDoubles = event ? CATEGORY_META[event.category].kind === "DOUBLES" : false;
  const unit = isDoubles ? "pair" : "player";

  const [tab, setTab] = useState("paste");
  const [text, setText] = useState("");
  const [allPaid, setAllPaid] = useState(false);
  const [form, setForm] = useState(blank);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  const nameRef = useRef(null);

  const rows = useMemo(
    () => parseWalkInList(text, { isDoubles, existingNames }),
    [text, isDoubles, existingNames]
  );
  const ready = rows.filter((r) => r.errors.length === 0 && !r.duplicate);

  if (!open || !event) return null;

  const run = async (items) => {
    setSaving(true);
    try {
      const res = await onAdd(items);
      setResult({ added: res.added.length, waitlisted: res.waitlisted.length, failed: res.failed });
      return res;
    } catch (e) {
      setResult({ added: 0, waitlisted: 0, failed: [{ item: { players: [{ name: "Add" }] }, error: e.message }] });
      return null;
    } finally {
      setSaving(false);
    }
  };

  const addPasted = async () => {
    const res = await run(ready.map((r) => ({ players: r.players, paid: allPaid || r.paid })));
    if (!res) return;
    // Leave only the lines that didn't go in, so they can be fixed and retried.
    const failedLines = new Set(res.failed.map((f) => ready.find((r) => r.players === f.item.players)?.line));
    setText(rows.filter((r) => r.errors.length > 0 || failedLines.has(r.line)).map((r) => r.line).join("\n"));
  };

  const addOne = async (e) => {
    e.preventDefault();
    setFormError("");
    const players = [{ name: form.name.trim(), phone: form.phone.replace(/[^\d]/g, "") || null }];
    if (isDoubles) players.push({ name: form.partnerName.trim(), phone: form.partnerPhone.replace(/[^\d]/g, "") || null });
    if (players.some((p) => !p.name)) { setFormError(isDoubles ? "Enter both names." : "Enter a name."); return; }
    const key = players.map((p) => normaliseName(p.name)).join(" / ");
    if (existingNames.some((n) => normaliseName(n) === key)) {
      setFormError("Already in this category. Add a surname or initial if this is someone else.");
      return;
    }
    const res = await run([{ players, paid: form.paid }]);
    if (res && res.failed.length === 0) {
      setForm({ ...blank, paid: form.paid });
      nameRef.current?.focus();
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Add ${unit}s — ${divisionLabel(event)}`} width="max-w-2xl">
      <div className="mb-4 flex gap-1 rounded-md border border-line bg-surface-2 p-1">
        {[["paste", ClipboardList, "Paste list"], ["one", UserPlus, "One by one"]].map(([key, Icon, label]) => (
          <button
            key={key} type="button" onClick={() => { setTab(key); setResult(null); }}
            className={cx("flex flex-1 items-center justify-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium",
              tab === key ? "bg-surface text-ink shadow-sm" : "text-ink-3 hover:text-ink-2")}
          >
            <Icon size={14} />{label}
          </button>
        ))}
      </div>

      {tab === "paste" && (
        <div className="space-y-3">
          <p className="text-sm text-ink-2">
            Paste your WhatsApp list with one {unit} per line. Numbering, emoji and phone numbers are fine, and phone numbers are optional.
            {isDoubles && <> Separate partners with <span className="font-medium text-ink">/</span>, <span className="font-medium text-ink">&amp;</span> or <span className="font-medium text-ink">and</span>.</>}
            {" "}Lines with &ldquo;paid&rdquo; are marked paid.
          </p>
          <textarea
            className={cx(inputCls, "min-h-[140px] resize-y font-mono text-xs")}
            placeholder={isDoubles ? "1. Rahul / Arjun\n2. Sneha & Divya 98765 43210 paid" : "1. Rahul Sharma\n2. Arjun 98765 43210 paid"}
            value={text} onChange={(e) => { setText(e.target.value); setResult(null); }}
          />

          {rows.length > 0 && (
            <div className="max-h-64 overflow-y-auto rounded-md border border-line">
              <table className="w-full text-left text-xs">
                <tbody className="divide-y divide-line-soft">
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td className="px-2 py-1.5 text-ink">
                        {r.players.map((p, j) => (
                          <span key={j}>
                            {j > 0 && <span className="text-ink-3"> / </span>}
                            {p.name || <span className="text-ink-3">?</span>}
                            {p.phone && <span className="ml-1 text-ink-3">{p.phone}</span>}
                          </span>
                        ))}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        {r.errors.length > 0
                          ? <span className="text-red-400">{r.errors.join(", ")}</span>
                          : r.duplicate
                            ? <Badge tone="slate">Already added, skipped</Badge>
                            : (allPaid || r.paid) ? <Badge tone="emerald">Paid</Badge> : <Badge tone="teal">Ready</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <Summary result={result} />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-1.5 text-sm text-ink-2">
              <input type="checkbox" className="accent-teal-500" checked={allPaid} onChange={(e) => setAllPaid(e.target.checked)} />
              Mark everyone as paid
            </label>
            <Btn size="sm" disabled={ready.length === 0 || saving} onClick={addPasted}>
              {saving ? "Adding…" : `Add ${ready.length} ${unit}${ready.length === 1 ? "" : "s"}`}
            </Btn>
          </div>
        </div>
      )}

      {tab === "one" && (
        <form className="space-y-3" onSubmit={addOne}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={isDoubles ? "Player 1" : "Name"} required>
              <input ref={nameRef} autoFocus className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Phone" hint="Optional. Links results to their profile.">
              <input inputMode="tel" className={inputCls} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
            {isDoubles && <>
              <Field label="Player 2" required>
                <input className={inputCls} value={form.partnerName} onChange={(e) => setForm({ ...form, partnerName: e.target.value })} />
              </Field>
              <Field label="Phone">
                <input inputMode="tel" className={inputCls} value={form.partnerPhone} onChange={(e) => setForm({ ...form, partnerPhone: e.target.value })} />
              </Field>
            </>}
          </div>
          <label className="flex items-center gap-1.5 text-sm text-ink-2">
            <input type="checkbox" className="accent-teal-500" checked={form.paid} onChange={(e) => setForm({ ...form, paid: e.target.checked })} />
            Paid at the desk
          </label>

          {formError && <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{formError}</div>}
          <Summary result={result} />

          <div className="flex justify-end gap-2">
            <Btn type="button" size="sm" variant="ghost" onClick={onClose}>Done</Btn>
            <Btn type="submit" size="sm" disabled={saving}>{saving ? "Adding…" : `Add ${unit}`}</Btn>
          </div>
        </form>
      )}
    </Modal>
  );
}
