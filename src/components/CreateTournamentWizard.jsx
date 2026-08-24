import React, { useMemo, useState } from "react";
import { MapPin, Calendar, Check, ChevronLeft, ChevronRight, ArrowRight, Gauge, AlertTriangle } from "lucide-react";
import { cx, fmtDateRange, inr, CATEGORY_META, AGE_GROUPS, SKILL_GRADES, FORMAT_META } from "../lib/engines";
import { estimateTournament } from "../lib/intelligence";
import { Modal, Field, Btn, Badge, Card, inputCls } from "./ui/primitives";
import { SportIcon, SPORT_KEYS } from "./ui/motion";

/* The honest feasibility read, plus what MatchDay takes off the organizer's
   hands once this exists. Both halves matter: the promise only lands if the
   numbers next to it are real, and every number here is arithmetic over what
   they just typed (see lib/intelligence.js estimateTournament). */
const HANDLED = [
  "Registration and waitlists",
  "Draws and seeding",
  "Scheduling across courts",
  "Check-in",
  "Live scoring",
  "Results and standings",
  "A public tournament page",
];

function Estimate({ estimate }) {
  const { totalMatches, totalEntries, courtHoursNeeded, estimatedFinish, recommendedCourts, courts, fits, warnings } = estimate;

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-line bg-surface-2 p-3.5">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-2">
          <Gauge size={13} /> What this will take
        </div>
        {totalMatches === 0 ? (
          <p className="text-xs text-ink-3">Add at least one category to see an estimate.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "Matches", value: totalMatches },
                { label: "Entries", value: totalEntries },
                { label: "Court hours", value: `${courtHoursNeeded}h` },
                { label: "Likely finish", value: estimatedFinish || "Past midnight" },
              ].map((s) => (
                <div key={s.label}>
                  <div className="text-[10px] uppercase tracking-wide text-ink-3">{s.label}</div>
                  <div className="font-display text-lg font-bold text-ink">{s.value}</div>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
              Assumes {courts} court{courts === 1 ? "" : "s"} running continuously.
              {!fits && recommendedCourts > courts && (
                <> You&apos;d need about <span className="font-medium text-ink-2">{recommendedCourts} courts</span> to finish inside the day.</>
              )}
            </p>
          </>
        )}
      </div>

      {warnings.map((w) => (
        <div key={w} className="flex gap-2 rounded-md border border-amber-400/30 bg-amber-400/[0.07] px-3 py-2.5 text-[11px] leading-relaxed text-amber-200">
          <AlertTriangle size={13} className="mt-px shrink-0" />
          <span>{w}</span>
        </div>
      ))}

      <div className="rounded-lg border border-line bg-surface-2 p-3.5">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-2">MatchDay handles</div>
        <div className="grid gap-1 sm:grid-cols-2">
          {HANDLED.map((h) => (
            <div key={h} className="flex items-center gap-1.5 text-xs text-ink-2">
              <Check size={12} className="shrink-0 text-accent-teal" /> {h}
            </div>
          ))}
        </div>
        {/* Never promise the parts that aren't connected. */}
        <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
          Entry fees are recorded by you against each entry — no payment gateway is connected yet, so
          MatchDay never takes money on your behalf.
        </p>
      </div>
    </div>
  );
}

export default function CreateTournamentWizard({ open, onClose, onSubmit }) {
  const [step, setStep] = useState(1);
  const [sport, setSport] = useState("badminton");
  const [basics, setBasics] = useState({
    name: "", description: "", organizerName: "", venue: "", location: "",
    startDate: "", endDate: "", registrationDeadline: "", contactEmail: "", contactPhone: "",
  });
  const [selectedCats, setSelectedCats] = useState({ MS: true });
  const [catConfig, setCatConfig] = useState({ MS: { maxEntries: 16, feeINR: 300 } });
  const [settings, setSettings] = useState({ courtsCount: 2, matchDurationMins: 40, startTime: "09:00", rules: "BWF rally-point scoring, best of 3 games to 21." });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const categories = Object.keys(selectedCats).filter((c) => selectedCats[c]).map((c) => ({ category: c, ...catConfig[c] }));

  // Days are inclusive of both ends — a Saturday-to-Sunday tournament has two
  // days of court time, not one.
  const days = basics.startDate && basics.endDate
    ? Math.max(1, Math.round((new Date(basics.endDate) - new Date(basics.startDate)) / 86400000) + 1)
    : 1;

  // Must run before the `!open` early return — hooks cannot be conditional.
  const estimate = useMemo(
    () => estimateTournament({
      categories, courtsCount: settings.courtsCount,
      matchDurationMins: settings.matchDurationMins,
      startTime: settings.startTime, endTime: "21:00", days,
    }),
    // `categories` is rebuilt every render, so depend on the values it derives
    // from rather than the array identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(categories), settings.courtsCount, settings.matchDurationMins, settings.startTime, days]
  );

  if (!open) return null;

  const toggleCat = (c) => {
    setSelectedCats((s) => ({ ...s, [c]: !s[c] }));
    setCatConfig((s) => ({
      ...s,
      [c]: s[c] || {
        maxEntries: CATEGORY_META[c].kind === "SINGLES" ? 16 : 8,
        feeINR: CATEGORY_META[c].kind === "SINGLES" ? 300 : 500,
        format: "SINGLE_ELIM", ageGroup: "OPEN", skillGrade: null,
        groupCount: 2, advancePerGroup: 2,
      },
    }));
  };

  const canNext = () => {
    if (step === 1) return basics.name && basics.venue && basics.startDate && basics.endDate;
    if (step === 2) return categories.length > 0;
    return true;
  };

  const handlePublishNow = async (publish) => {
    setError("");
    setSaving(true);
    try {
      await onSubmit({ basics, categories, settings, publish, sport });
      setStep(1);
      setBasics({ name: "", description: "", organizerName: "", venue: "", location: "", startDate: "", endDate: "", registrationDeadline: "", contactEmail: "", contactPhone: "" });
      setSport("badminton");
      setSelectedCats({ MS: true });
      setCatConfig({ MS: { maxEntries: 16, feeINR: 300 } });
      onClose();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Create tournament" width="max-w-2xl">
      <div className="mb-5 flex items-center gap-1.5">
        {["Basics", "Categories", "Settings", "Review"].map((label, i) => (
          <React.Fragment key={label}>
            <div className={cx("flex items-center gap-1.5 text-xs font-medium", step === i + 1 ? "text-accent-teal" : step > i + 1 ? "text-ink-2" : "text-ink-3")}>
              <span className={cx("flex h-5 w-5 items-center justify-center rounded-full border text-[10px]", step === i + 1 ? "border-accent-teal bg-accent-teal text-navy-950" : step > i + 1 ? "border-line bg-surface-2" : "border-line")}>
                {step > i + 1 ? <Check size={11} /> : i + 1}
              </span>
              {label}
            </div>
            {i < 3 && <div className="h-px flex-1 bg-line" />}
          </React.Fragment>
        ))}
      </div>

      {step === 1 && (
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Field label="Sport" required>
              <div className="flex flex-wrap gap-1.5">
                {SPORT_KEYS.map((s) => (
                  <button key={s} type="button" disabled={s !== "badminton"}
                    onClick={() => setSport(s)}
                    title={s === "badminton" ? undefined : "Coming soon — draws and scoring aren't built for this sport yet"}
                    className={cx(
                      "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium",
                      sport === s ? "border-accent-teal bg-accent-teal/10 text-accent-teal" : "border-line text-ink-2",
                      s !== "badminton" ? "cursor-not-allowed opacity-40" : "hover:bg-surface-2"
                    )}>
                    <SportIcon sport={s} className="h-3.5 w-3.5" />
                    {s[0].toUpperCase() + s.slice(1)}
                    {s !== "badminton" && <span className="text-[9px] uppercase">Soon</span>}
                  </button>
                ))}
              </div>
            </Field>
          </div>
          <div className="col-span-2"><Field label="Tournament name" required><input className={inputCls} value={basics.name} onChange={(e) => setBasics((b) => ({ ...b, name: e.target.value }))} placeholder="e.g. Coimbatore Winter Open 2026" /></Field></div>
          <div className="col-span-2"><Field label="Description"><textarea className={cx(inputCls, "resize-none")} rows={2} value={basics.description} onChange={(e) => setBasics((b) => ({ ...b, description: e.target.value }))} /></Field></div>
          <Field label="Organizer"><input className={inputCls} value={basics.organizerName} onChange={(e) => setBasics((b) => ({ ...b, organizerName: e.target.value }))} /></Field>
          <Field label="Venue" required><input className={inputCls} value={basics.venue} onChange={(e) => setBasics((b) => ({ ...b, venue: e.target.value }))} /></Field>
          <Field label="Location"><input className={inputCls} value={basics.location} onChange={(e) => setBasics((b) => ({ ...b, location: e.target.value }))} placeholder="City, State" /></Field>
          <Field label="Registration deadline"><input type="date" className={inputCls} value={basics.registrationDeadline} onChange={(e) => setBasics((b) => ({ ...b, registrationDeadline: e.target.value }))} /></Field>
          <Field label="Start date" required><input type="date" className={inputCls} value={basics.startDate} onChange={(e) => setBasics((b) => ({ ...b, startDate: e.target.value }))} /></Field>
          <Field label="End date" required><input type="date" className={inputCls} value={basics.endDate} onChange={(e) => setBasics((b) => ({ ...b, endDate: e.target.value }))} /></Field>
          <Field label="Contact email" hint="Shown publicly on your tournament page."><input className={inputCls} value={basics.contactEmail} onChange={(e) => setBasics((b) => ({ ...b, contactEmail: e.target.value }))} /></Field>
          <Field label="Contact phone"><input className={inputCls} value={basics.contactPhone} onChange={(e) => setBasics((b) => ({ ...b, contactPhone: e.target.value }))} /></Field>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-2">
          <p className="mb-3 text-xs text-ink-2">Choose the categories this tournament will run. Each gets its own draw, schedule and results.</p>
          {Object.entries(CATEGORY_META).map(([code, meta]) => (
            <div key={code} className={cx("rounded-md border px-3 py-2.5", selectedCats[code] ? "border-accent-teal/50 bg-accent-teal/10" : "border-line")}>
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-sm font-medium text-ink">
                  <input type="checkbox" checked={!!selectedCats[code]} onChange={() => toggleCat(code)} className="h-4 w-4 accent-teal-500" />
                  {meta.label} <span className="text-[11px] font-normal text-ink-3">({meta.kind === "SINGLES" ? "1 vs 1" : "2 vs 2"})</span>
                </label>
              </div>
              {selectedCats[code] && (
                <div className="mt-2 space-y-2 pl-6">
                  <div className="grid grid-cols-2 gap-2">
                    <Field label={meta.kind === "SINGLES" ? "Max players" : "Max teams"}>
                      <input type="number" min={2} className={inputCls} value={catConfig[code]?.maxEntries ?? ""} onChange={(e) => setCatConfig((s) => ({ ...s, [code]: { ...s[code], maxEntries: Number(e.target.value) } }))} />
                    </Field>
                    <Field label="Entry fee (₹)">
                      <input type="number" min={0} className={inputCls} value={catConfig[code]?.feeINR ?? ""} onChange={(e) => setCatConfig((s) => ({ ...s, [code]: { ...s[code], feeINR: Number(e.target.value) } }))} />
                    </Field>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <Field label="Age group">
                      <select className={inputCls} value={catConfig[code]?.ageGroup ?? "OPEN"} onChange={(e) => setCatConfig((s) => ({ ...s, [code]: { ...s[code], ageGroup: e.target.value } }))}>
                        {AGE_GROUPS.map((a) => <option key={a} value={a}>{a === "OPEN" ? "Open" : a}</option>)}
                      </select>
                    </Field>
                    <Field label="Grade">
                      <select className={inputCls} value={catConfig[code]?.skillGrade ?? ""} onChange={(e) => setCatConfig((s) => ({ ...s, [code]: { ...s[code], skillGrade: e.target.value || null } }))}>
                        <option value="">None</option>
                        {SKILL_GRADES.map((g) => <option key={g} value={g}>Grade {g}</option>)}
                      </select>
                    </Field>
                    <Field label="Format">
                      <select className={inputCls} value={catConfig[code]?.format ?? "SINGLE_ELIM"} onChange={(e) => setCatConfig((s) => ({ ...s, [code]: { ...s[code], format: e.target.value } }))}>
                        {Object.entries(FORMAT_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                      </select>
                    </Field>
                  </div>
                  <p className="text-[11px] text-ink-3">
                    {FORMAT_META[catConfig[code]?.format ?? "SINGLE_ELIM"].hint}
                  </p>
                  {catConfig[code]?.format === "GROUP_KO" && (
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Number of groups">
                        <input type="number" min={2} max={8} className={inputCls} value={catConfig[code]?.groupCount ?? 2} onChange={(e) => setCatConfig((s) => ({ ...s, [code]: { ...s[code], groupCount: Number(e.target.value) } }))} />
                      </Field>
                      <Field label="Advance per group">
                        <input type="number" min={1} max={4} className={inputCls} value={catConfig[code]?.advancePerGroup ?? 2} onChange={(e) => setCatConfig((s) => ({ ...s, [code]: { ...s[code], advancePerGroup: Number(e.target.value) } }))} />
                      </Field>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {step === 3 && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Number of courts" hint="Used by the scheduling engine to spread matches across courts.">
            <input type="number" min={1} className={inputCls} value={settings.courtsCount} onChange={(e) => setSettings((s) => ({ ...s, courtsCount: Number(e.target.value) }))} />
          </Field>
          <Field label="Match duration (minutes)"><input type="number" min={15} className={inputCls} value={settings.matchDurationMins} onChange={(e) => setSettings((s) => ({ ...s, matchDurationMins: Number(e.target.value) }))} /></Field>
          <Field label="Daily start time"><input type="time" className={inputCls} value={settings.startTime} onChange={(e) => setSettings((s) => ({ ...s, startTime: e.target.value }))} /></Field>
          <div className="col-span-2"><Field label="Rules / notes"><textarea className={cx(inputCls, "resize-none")} rows={2} value={settings.rules} onChange={(e) => setSettings((s) => ({ ...s, rules: e.target.value }))} /></Field></div>
          {/* Live feedback right where courts and duration are chosen — this
              is the screen where the decision is actually made. */}
          {estimate.totalMatches > 0 && (
            <div className={cx(
              "col-span-2 flex gap-2 rounded-md border px-3 py-2.5 text-[11px] leading-relaxed",
              estimate.fits ? "border-line bg-surface-2 text-ink-2" : "border-amber-400/30 bg-amber-400/[0.07] text-amber-200"
            )}>
              {estimate.fits ? <Gauge size={13} className="mt-px shrink-0 text-ink-3" /> : <AlertTriangle size={13} className="mt-px shrink-0" />}
              <span>
                {estimate.totalMatches} matches over about {estimate.courtHoursNeeded} court-hours.
                {estimate.fits
                  ? ` On ${estimate.courts} court${estimate.courts === 1 ? "" : "s"} that finishes around ${estimate.estimatedFinish}.`
                  : ` That doesn't fit — you'd need about ${estimate.recommendedCourts} courts, another day, or fewer entries.`}
              </span>
            </div>
          )}
        </div>
      )}

      {step === 4 && (
        <div className="space-y-4">
          <Card className="p-4">
            <div className="text-base font-semibold text-ink">{basics.name || "Untitled tournament"}</div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
              <span className="flex items-center gap-1"><MapPin size={12} />{basics.venue}{basics.location ? `, ${basics.location}` : ""}</span>
              <span className="flex items-center gap-1"><Calendar size={12} />{fmtDateRange(basics.startDate, basics.endDate)}</span>
            </div>
          </Card>

          {/* What this actually means in matches and hours. A first-time
              organizer has no way to know that 32 players on 2 courts is a
              14-hour day until it is 9 p.m. and eight matches remain — so the
              arithmetic is done here, before anything is committed. */}
          <Estimate estimate={estimate} />
          <div>
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-2">Categories</div>
            <div className="flex flex-wrap gap-1.5">
              {categories.map((c) => (
                <Badge key={`${c.category}-${c.ageGroup}-${c.skillGrade ?? ""}`} tone="teal">
                  {CATEGORY_META[c.category].label}
                  {c.ageGroup && c.ageGroup !== "OPEN" ? ` · ${c.ageGroup}` : ""}
                  {c.skillGrade ? ` · ${c.skillGrade}` : ""}
                  {" · "}{FORMAT_META[c.format ?? "SINGLE_ELIM"].label} · {inr(c.feeINR)} · max {c.maxEntries}
                </Badge>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 text-xs text-ink-2">
            <div><div className="font-semibold text-ink-2">{settings.courtsCount}</div>Courts</div>
            <div><div className="font-semibold text-ink-2">{settings.matchDurationMins}m</div>Per match</div>
            <div><div className="font-semibold text-ink-2">{settings.startTime}</div>Daily start</div>
          </div>
          {error && <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}
        </div>
      )}

      <div className="mt-6 flex items-center justify-between border-t border-line-soft pt-4">
        <Btn variant="ghost" size="sm" icon={ChevronLeft} onClick={() => (step === 1 ? onClose() : setStep(step - 1))}>{step === 1 ? "Cancel" : "Back"}</Btn>
        {step < 4 ? (
          <Btn size="sm" icon={ChevronRight} disabled={!canNext()} onClick={() => setStep(step + 1)}>Continue</Btn>
        ) : (
          <div className="flex gap-2">
            <Btn variant="secondary" size="sm" disabled={saving} onClick={() => handlePublishNow(false)}>Save as draft</Btn>
            <Btn size="sm" icon={ArrowRight} disabled={saving} onClick={() => handlePublishNow(true)}>Publish now</Btn>
          </div>
        )}
      </div>
    </Modal>
  );
}
