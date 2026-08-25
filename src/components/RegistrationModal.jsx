import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Users, User, CreditCard, ChevronLeft, MapPin, CalendarDays, Info, AlertTriangle } from "lucide-react";
import {
  cx, inr, fmtDate, fmtDateTime, divisionLabel, CATEGORY_META,
} from "../lib/engines";
import { registrationState, REG_STATE } from "../lib/lifecycle";
import { getEventCapacity } from "../lib/repository";
import {
  normaliseFields, blankAnswers, validateAnswers, cleanAnswers,
} from "../lib/registrationFields";
import { useAuth } from "../lib/AuthContext";
import { Modal, Field, Btn, Badge, inputCls } from "./ui/primitives";

/* The registration flow, as steps rather than one long form.
   Singles:  CATEGORY -> DETAILS -> REVIEW -> CONFIRMATION
   Doubles:  CATEGORY -> PARTNER -> DETAILS -> REVIEW -> CONFIRMATION

   Two things this deliberately does NOT do: it never shows a payment sheet
   (no gateway is connected, so there is nothing to charge against), and it
   never reports an entry as confirmed. What it reports is exactly what the
   database recorded — pending, or waitlisted when the category was full. */

const blankPlayer = () => ({ name: "", phone: "", email: "" });

function Stepper({ steps, current }) {
  return (
    <div className="mb-4 flex items-center gap-1.5">
      {steps.map((s, i) => (
        <div key={s} className="flex flex-1 items-center gap-1.5">
          <div className={cx(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
            i < current ? "bg-accent-teal text-navy-950"
              : i === current ? "border-2 border-accent-teal text-accent-teal"
              : "border border-line text-ink-3"
          )}>
            {i < current ? "✓" : i + 1}
          </div>
          <span className={cx("hidden text-[10px] font-medium uppercase tracking-wide sm:inline",
            i === current ? "text-accent-teal" : "text-ink-3")}>{s}</span>
          {i < steps.length - 1 && <div className={cx("h-px flex-1", i < current ? "bg-accent-teal" : "bg-line")} />}
        </div>
      ))}
    </div>
  );
}

/* The organizer's own questions, rendered from tournaments.registration_fields.
   Definitions and validation are shared with the builder (lib/registrationFields)
   so the two can never disagree about what "required" or "public" means. */
function CustomFields({ fields, answers, errors, onChange }) {
  if (!fields.length) return null;
  return (
    <div className="space-y-3">
      <div className="md-eyebrow">
        {"A few questions from the organizer"}
      </div>
      {fields.map((f) => {
        const err = errors?.[f.key];
        const set = (v) => onChange({ ...answers, [f.key]: v });

        if (f.type === "checkbox") {
          return (
            <div key={f.key}>
              <label className="flex cursor-pointer items-start gap-2 text-sm text-ink-2">
                <input
                  type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-teal-500"
                  checked={answers[f.key] === true}
                  onChange={(e) => set(e.target.checked)}
                />
                <span>
                  {f.label} {f.required && <span className="text-red-400">*</span>}
                  {f.help && <span className="mt-0.5 block text-[11px] text-ink-3">{f.help}</span>}
                </span>
              </label>
              {err && <p className="mt-1 text-[11px] text-red-300">{err}</p>}
            </div>
          );
        }

        return (
          <Field key={f.key} label={f.label} required={f.required} hint={f.help || undefined}>
            {f.type === "select" ? (
              <select className={inputCls} value={answers[f.key] ?? ""} onChange={(e) => set(e.target.value)}>
                <option value="">Select…</option>
                {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : f.type === "textarea" ? (
              <textarea className={cx(inputCls, "resize-none")} rows={3}
                value={answers[f.key] ?? ""} onChange={(e) => set(e.target.value)} />
            ) : (
              <input
                className={inputCls}
                type={f.type === "number" ? "number" : f.type === "date" ? "date" : f.type === "email" ? "email" : "text"}
                inputMode={f.type === "tel" ? "tel" : undefined}
                value={answers[f.key] ?? ""}
                onChange={(e) => set(e.target.value)}
              />
            )}
            {err && <p className="mt-1 text-[11px] text-red-300">{err}</p>}
          </Field>
        );
      })}
    </div>
  );
}

function PlayerFields({ label, value, onChange, hint }) {
  return (
    <div className="space-y-3">
      <div className="md-eyebrow">{label}</div>
      {hint && <p className="-mt-1 text-[11px] text-ink-3">{hint}</p>}
      <Field label="Full name" required>
        <input className={inputCls} value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Phone" required hint="Used to link results to a player profile.">
          <input inputMode="tel" className={inputCls} value={value.phone} onChange={(e) => onChange({ ...value, phone: e.target.value })} />
        </Field>
        <Field label="Email">
          <input type="email" className={inputCls} value={value.email} onChange={(e) => onChange({ ...value, email: e.target.value })} />
        </Field>
      </div>
    </div>
  );
}

export default function RegistrationModal({ open, onClose, event, tournament, onSubmit }) {
  const { caps } = useAuth();
  const kind = event ? CATEGORY_META[event.category].kind : "SINGLES";
  const isDoubles = kind === "DOUBLES";

  const [step, setStep] = useState(0);
  const [p1, setP1] = useState(blankPlayer);
  const [p2, setP2] = useState(blankPlayer);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);   // the entry the database actually created
  const [capacity, setCapacity] = useState(null);

  // The organizer's extra questions, and this registrant's answers to them.
  const customFields = useMemo(
    () => normaliseFields(tournament?.registration_fields),
    [tournament?.registration_fields]
  );
  const [answers, setAnswers] = useState({});
  const [answerErrors, setAnswerErrors] = useState({});

  const steps = isDoubles ? ["Category", "Partner", "Details", "Review"] : ["Category", "Details", "Review"];

  const reset = useCallback(() => {
    setStep(0);
    setError("");
    setResult(null);
    setAnswers(blankAnswers(customFields));
    setAnswerErrors({});
    // Prefill from the signed-in player's own profile — they should not have
    // to retype their own name and number to enter a tournament.
    setP1(caps?.player
      ? { name: caps.player.name || "", phone: caps.player.phone || "", email: caps.player.email || "" }
      : blankPlayer());
    setP2(blankPlayer());
  }, [caps, customFields]);

  useEffect(() => { if (open) reset(); }, [open, event, reset]);

  useEffect(() => {
    if (!open || !event) return;
    getEventCapacity(event.id).then(setCapacity).catch(() => setCapacity(null));
  }, [open, event]);

  if (!open || !event) return null;

  const state = registrationState(tournament, event, capacity?.taken ?? 0);
  const willWaitlist = state.key === REG_STATE.WAITLIST.key;
  const spotsLeft = Math.max(0, (event.max_entries || 0) - (capacity?.taken ?? 0));

  const next = () => {
    setError("");
    // Validate only what this step is responsible for.
    if (isDoubles && step === 1 && (!p2.name.trim() || !p2.phone.trim())) {
      setError("Enter your partner's name and phone number."); return;
    }
    const detailsStep = isDoubles ? 2 : 1;
    if (step === detailsStep) {
      if (!p1.name.trim() || !p1.phone.trim()) {
        setError("Enter your name and phone number."); return;
      }
      // The organizer's own questions are answered on the same step, so they
      // are validated here rather than being discovered at submit.
      const errs = validateAnswers(customFields, answers);
      setAnswerErrors(errs);
      if (Object.keys(errs).length) {
        setError("Please check the highlighted questions."); return;
      }
    }
    setStep((s) => s + 1);
  };

  const submit = async () => {
    setError(""); setSaving(true);
    try {
      const players = isDoubles ? [p1, p2] : [p1];
      // cleanAnswers strips anything not defined as a field, so a tampered
      // form cannot smuggle extra keys into the stored JSON.
      const entry = await onSubmit(event.id, players, cleanAnswers(customFields, answers));
      setResult(entry || { reg_status: "PENDING" });
    } catch (e) {
      // RLS refuses inserts outside the registration window, so a closed
      // deadline surfaces here rather than silently succeeding.
      setError(
        /row-level security|violates/i.test(e.message)
          ? "Registration for this category is closed."
          : e.message
      );
    } finally { setSaving(false); }
  };

  /* ---------------------------- CONFIRMATION ---------------------------- */
  if (result) {
    const waitlisted = result.reg_status === "WAITLISTED";
    return (
      <Modal open={open} onClose={onClose} title="Registration received">
        <div className="space-y-4">
          <div className="flex flex-col items-center gap-2 py-2 text-center">
            <CheckCircle2 className={waitlisted ? "text-amber-400" : "text-emerald-500"} size={34} />
            <div className="text-lg font-bold text-ink">
              {waitlisted ? "You're on the waitlist" : "You're registered"}
            </div>
            <p className="max-w-sm text-sm text-ink-2">
              {waitlisted
                ? `${divisionLabel(event)} was full, so your entry was added to the waitlist${result.waitlist_position ? ` at position ${result.waitlist_position}` : ""}. You'll be notified automatically if a place opens up.`
                : `Your entry for ${divisionLabel(event)} has been recorded.`}
            </p>
          </div>

          <div className="rounded-lg border border-line bg-surface-2 p-3">
            <div className="mb-2 md-eyebrow">What happens next</div>
            <ol className="space-y-1.5 text-sm text-ink-2">
              <li><span className="font-medium text-ink">1.</span> The organizer reviews and confirms your entry.</li>
              {Number(event.fee_inr) > 0 && (
                <li>
                  <span className="font-medium text-ink">2.</span> Pay the {inr(event.fee_inr)} entry fee directly to the
                  organizer. They record it, and your payment status updates here.
                </li>
              )}
              <li><span className="font-medium text-ink">{Number(event.fee_inr) > 0 ? 3 : 2}.</span> Once registration closes, the draw and schedule are published.</li>
              <li><span className="font-medium text-ink">{Number(event.fee_inr) > 0 ? 4 : 3}.</span> Check in at the venue, then play.</li>
            </ol>
          </div>

          {/* Never claim money moved. */}
          {Number(event.fee_inr) > 0 && (
            <div className="flex gap-2 rounded-md border border-amber-400/30 bg-amber-400/[0.07] px-3 py-2.5 text-[11px] leading-relaxed text-amber-200">
              <Info size={13} className="mt-px shrink-0" />
              <span>
                No online payment was taken — MatchDay has no payment gateway connected. Your entry stays
                <span className="font-medium"> unpaid</span> until the organizer records your fee.
              </span>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {caps?.signedIn
              ? <Link to="/me" onClick={onClose}><Btn size="sm">Go to my matches</Btn></Link>
              : <Link to="/signup" onClick={onClose}><Btn size="sm">Create an account to track this</Btn></Link>}
            <Btn size="sm" variant="ghost" onClick={onClose}>Close</Btn>
          </div>
          {!caps?.signedIn && (
            <p className="text-[11px] text-ink-3">
              Sign up with this same phone number and this entry — plus your results — attaches to your account automatically.
            </p>
          )}
        </div>
      </Modal>
    );
  }

  /* ------------------------------- STEPS -------------------------------- */
  const detailsStep = isDoubles ? 2 : 1;
  const reviewStep = steps.length - 1;

  return (
    <Modal open={open} onClose={onClose} title={`Register — ${divisionLabel(event)}`}>
      <Stepper steps={steps} current={step} />

      {/* Step 0 — the category, and what entering it commits you to. */}
      {step === 0 && (
        <div className="space-y-3">
          <div className="rounded-lg border border-line bg-surface-2 p-3.5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-semibold text-ink">{divisionLabel(event)}</div>
                <div className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-2">
                  {isDoubles ? <Users size={12} /> : <User size={12} />}
                  {isDoubles ? "Team of two" : "Individual entry"}
                </div>
              </div>
              <Badge tone={state.tone}>{state.label}</Badge>
            </div>

            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="md-eyebrow">Entry fee</dt>
                <dd className="font-semibold text-ink">{Number(event.fee_inr) > 0 ? inr(event.fee_inr) : "Free"}</dd>
              </div>
              <div>
                <dt className="md-eyebrow">Places</dt>
                <dd className="text-ink">
                  {capacity === null ? "…"
                    : willWaitlist ? `Full — ${capacity.waitlisted} on the waitlist`
                    : `${spotsLeft} of ${event.max_entries} left`}
                </dd>
              </div>
              {tournament?.registration_closes_at ? (
                <div>
                  <dt className="md-eyebrow">Registration closes</dt>
                  <dd className="text-ink">{fmtDateTime(tournament.registration_closes_at)}</dd>
                </div>
              ) : tournament?.registration_deadline ? (
                <div>
                  <dt className="md-eyebrow">Deadline</dt>
                  <dd className="text-ink">{fmtDate(tournament.registration_deadline)}</dd>
                </div>
              ) : null}
              <div>
                <dt className="md-eyebrow">Tournament dates</dt>
                <dd className="flex items-center gap-1 text-ink"><CalendarDays size={12} className="text-ink-3" />{fmtDate(tournament?.start_date)}</dd>
              </div>
            </dl>

            {tournament?.venue && (
              <div className="mt-2 flex items-center gap-1.5 text-xs text-ink-2">
                <MapPin size={12} className="text-ink-3" />{tournament.venue}{tournament.location ? `, ${tournament.location}` : ""}
              </div>
            )}
          </div>

          {willWaitlist && (
            <div className="flex gap-2 rounded-md border border-amber-400/30 bg-amber-400/[0.07] px-3 py-2.5 text-xs text-amber-200">
              <AlertTriangle size={13} className="mt-px shrink-0" />
              <span>This category is full. You can still enter — you&apos;ll join the waitlist and be promoted automatically if someone withdraws.</span>
            </div>
          )}
          {!state.canRegister && (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              Registration for this category is {state.label.toLowerCase()}.
            </div>
          )}

          <Btn className="w-full" disabled={!state.canRegister} onClick={next}>
            {willWaitlist ? "Join the waitlist" : "Start registration"}
          </Btn>
        </div>
      )}

      {/* Step 1 (doubles only) — partner first, because not having one stops you. */}
      {isDoubles && step === 1 && (
        <div className="space-y-4">
          <PlayerFields
            label="Your partner"
            hint="Doubles entries are registered as a pair. Your partner does not need a MatchDay account — if they have one, this links to it by phone number."
            value={p2} onChange={setP2}
          />
          {error && <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}
          <div className="flex gap-2">
            <Btn variant="ghost" icon={ChevronLeft} onClick={() => setStep(step - 1)}>Back</Btn>
            <Btn className="flex-1" onClick={next}>Continue</Btn>
          </div>
        </div>
      )}

      {/* Details */}
      {step === detailsStep && (
        <div className="space-y-4">
          <PlayerFields label="Your details" value={p1} onChange={setP1} />
          <CustomFields
            fields={customFields} answers={answers} errors={answerErrors}
            onChange={(a) => { setAnswers(a); setAnswerErrors({}); }}
          />
          {error && <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}
          <div className="flex gap-2">
            <Btn variant="ghost" icon={ChevronLeft} onClick={() => setStep(step - 1)}>Back</Btn>
            <Btn className="flex-1" onClick={next}>Review</Btn>
          </div>
        </div>
      )}

      {/* Review + submit */}
      {step === reviewStep && (
        <div className="space-y-3">
          <div className="rounded-lg border border-line bg-surface-2 p-3.5">
            <div className="mb-2 md-eyebrow">Review your entry</div>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-ink-2">Category</dt><dd className="text-right font-medium text-ink">{divisionLabel(event)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-2">{isDoubles ? "Team" : "Player"}</dt>
                <dd className="text-right font-medium text-ink">{isDoubles ? `${p1.name} / ${p2.name}` : p1.name}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-2">Contact</dt><dd className="text-right text-ink">{p1.phone}</dd>
              </div>
              {customFields
                .filter((f) => (f.type === "checkbox" ? answers[f.key] === true : String(answers[f.key] ?? "").trim()))
                .map((f) => (
                  <div key={f.key} className="flex justify-between gap-3">
                    <dt className="text-ink-2">{f.label}</dt>
                    <dd className="text-right text-ink">
                      {f.type === "checkbox" ? "Accepted" : String(answers[f.key])}
                    </dd>
                  </div>
                ))}
              <div className="flex justify-between gap-3 border-t border-line-soft pt-2">
                <dt className="font-medium text-ink">Entry fee</dt>
                <dd className="text-right font-bold text-ink">{Number(event.fee_inr) > 0 ? inr(event.fee_inr) : "Free"}</dd>
              </div>
            </dl>
          </div>

          <div className="flex gap-2 rounded-md border border-line bg-surface-2 px-3 py-2.5 text-[11px] leading-relaxed text-ink-2">
            <CreditCard size={13} className="mt-px shrink-0 text-ink-3" />
            <span>
              {Number(event.fee_inr) > 0
                ? <>No card is charged now. MatchDay has no payment gateway connected — you pay the organizer directly and they record it against your entry.</>
                : <>This category is free to enter.</>}
              {tournament?.contact_email && <> Questions: <span className="text-ink">{tournament.contact_email}</span>.</>}
            </span>
          </div>

          {error && <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}

          <div className="flex gap-2">
            <Btn variant="ghost" icon={ChevronLeft} disabled={saving} onClick={() => setStep(step - 1)}>Back</Btn>
            <Btn className="flex-1" disabled={saving} onClick={submit}>
              {saving ? "Submitting…" : willWaitlist ? "Join waitlist" : "Confirm entry"}
            </Btn>
          </div>
        </div>
      )}
    </Modal>
  );
}
