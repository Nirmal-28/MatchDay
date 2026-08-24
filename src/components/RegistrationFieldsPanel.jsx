import { useEffect, useMemo, useState } from "react";
import {
  ClipboardList, Plus, Trash2, ChevronUp, ChevronDown, Eye, EyeOff, Lock, Info, AlertTriangle,
} from "lucide-react";
import { cx } from "../lib/engines";
import {
  FIELD_TYPES, FIELD_PRESETS, VISIBILITY, MAX_FIELDS,
  normaliseFields, validateFieldDefinitions, uniqueFieldKey, toFieldKey, isSensitive,
} from "../lib/registrationFields";
import { updateRegistrationFields } from "../lib/repository";
import { Badge, Btn, Card, Field, inputCls } from "./ui/primitives";

/* The organizer's registration form builder.
   Name, phone and email are always collected and are not editable here —
   they're what links an entry to a player profile, so they're structural
   rather than configurable. Everything below is what this organizer wants to
   ask on top of that.

   Answers are stored in `entry_details`, not on `entries`, because `entries`
   is readable by anon for any published tournament. That's also why a field
   that looks like contact or identity data cannot be marked public: the
   builder refuses rather than relying on the organizer to spot the
   difference at midnight before a tournament. */

function VisibilityToggle({ field, onChange }) {
  const sensitive = isSensitive(field);
  const isPublic = field.visibility === "PUBLIC";

  if (sensitive) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-md border border-line bg-surface-2 px-2 py-1 text-[10px] font-medium text-ink-3"
        title="Personal contact or identity data is always private — it can never be shown on the public tournament page."
      >
        <Lock size={10} /> Always private
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onChange(isPublic ? "PRIVATE" : "PUBLIC")}
      title={VISIBILITY[isPublic ? "PUBLIC" : "PRIVATE"].hint}
      className={cx(
        "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium transition-colors",
        isPublic
          ? "border-accent-teal/40 bg-accent-teal/10 text-accent-teal"
          : "border-line bg-surface-2 text-ink-2 hover:bg-surface-3"
      )}
    >
      {isPublic ? <Eye size={10} /> : <EyeOff size={10} />}
      {isPublic ? "Public" : "Private"}
    </button>
  );
}

function FieldRow({ field, index, count, onPatch, onMove, onRemove }) {
  const typeMeta = FIELD_TYPES.find((t) => t.key === field.type);

  return (
    <Card className="space-y-2.5 p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <input
            className={cx(inputCls, "font-medium")}
            value={field.label}
            placeholder="Question label"
            onChange={(e) => onPatch({ label: e.target.value })}
          />
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button type="button" onClick={() => onMove(-1)} disabled={index === 0}
            aria-label="Move question up"
            className="rounded p-1.5 text-ink-3 hover:bg-surface-3 hover:text-ink disabled:opacity-30">
            <ChevronUp size={14} />
          </button>
          <button type="button" onClick={() => onMove(1)} disabled={index === count - 1}
            aria-label="Move question down"
            className="rounded p-1.5 text-ink-3 hover:bg-surface-3 hover:text-ink disabled:opacity-30">
            <ChevronDown size={14} />
          </button>
          <button type="button" onClick={onRemove} aria-label="Remove question"
            className="rounded p-1.5 text-ink-3 hover:bg-red-500/10 hover:text-red-300">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <select className={inputCls} value={field.type} aria-label="Field type"
          onChange={(e) => onPatch({ type: e.target.value })}>
          {FIELD_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-ink-2">
            <input type="checkbox" className="h-3.5 w-3.5 accent-teal-500"
              checked={field.required} onChange={(e) => onPatch({ required: e.target.checked })} />
            Required
          </label>
          <VisibilityToggle field={field} onChange={(v) => onPatch({ visibility: v })} />
        </div>
      </div>

      {typeMeta?.hasOptions && (
        <Field label="Options" hint="One per line.">
          <textarea
            className={cx(inputCls, "resize-none font-mono text-xs")} rows={3}
            value={(field.options || []).join("\n")}
            onChange={(e) => onPatch({ options: e.target.value.split("\n") })}
            placeholder={"S\nM\nL"}
          />
        </Field>
      )}

      <input
        className={cx(inputCls, "text-xs")}
        value={field.help || ""}
        placeholder="Helper text (optional)"
        onChange={(e) => onPatch({ help: e.target.value })}
      />
    </Card>
  );
}

export default function RegistrationFieldsPanel({ tournament, notify, onChanged }) {
  const [fields, setFields] = useState(() => normaliseFields(tournament?.registration_fields));
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Re-sync when the tournament reloads from the server, but never clobber
  // edits the organizer has in progress.
  useEffect(() => {
    if (!dirty) setFields(normaliseFields(tournament?.registration_fields));
  }, [tournament?.registration_fields, dirty]);

  const errors = useMemo(() => validateFieldDefinitions(fields), [fields]);
  const keys = useMemo(() => fields.map((f) => f.key), [fields]);

  const mutate = (next) => { setFields(next); setDirty(true); };

  const patchAt = (i, patch) => mutate(fields.map((f, j) => {
    if (j !== i) return f;
    const merged = { ...f, ...patch };
    // A field that becomes sensitive must not stay public — this is the same
    // rule the validator enforces, applied the moment it becomes true so the
    // organizer sees the badge flip rather than hitting an error on save.
    if (isSensitive(merged)) merged.visibility = "PRIVATE";
    return merged;
  }));

  const addField = (preset) => {
    if (fields.length >= MAX_FIELDS) return;
    const label = preset?.label || "New question";
    mutate([...fields, {
      key: uniqueFieldKey(preset?.key || toFieldKey(label), keys),
      label,
      type: preset?.type || "text",
      required: !!preset?.required,
      visibility: preset?.visibility === "PUBLIC" ? "PUBLIC" : "PRIVATE",
      options: preset?.options || [],
      help: preset?.help || "",
    }]);
  };

  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= fields.length) return;
    const next = [...fields];
    [next[i], next[j]] = [next[j], next[i]];
    mutate(next);
  };

  const save = async () => {
    if (errors.length) return;
    setSaving(true);
    try {
      // Keys are regenerated from labels only for brand-new fields; an
      // existing key must stay put or every answer already collected against
      // it becomes orphaned.
      await updateRegistrationFields(tournament.id, fields);
      setDirty(false);
      notify?.("Registration form saved.");
      await onChanged?.();
    } catch (e) {
      notify?.(e.message, "error");
    } finally { setSaving(false); }
  };

  const unusedPresets = FIELD_PRESETS.filter((p) => !keys.includes(p.key));

  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-2">
          <ClipboardList size={13} /> Registration form
        </div>
        <Badge tone="slate">{fields.length} extra question{fields.length === 1 ? "" : "s"}</Badge>
      </div>

      <div className="flex gap-2 rounded-md border border-line bg-surface-2 px-3 py-2.5 text-[11px] leading-relaxed text-ink-2">
        <Info size={13} className="mt-px shrink-0 text-ink-3" />
        <span>
          Every entrant always gives their <span className="font-medium text-ink">name, phone and email</span> — that's
          what links their results to a player profile. Anything you add here is asked on top of that.
          Answers are visible to you and your staff; only questions you mark <span className="font-medium text-ink">Public</span> ever
          appear on the public tournament page.
        </span>
      </div>

      {fields.length > 0 && (
        <div className="space-y-2">
          {fields.map((f, i) => (
            <FieldRow
              key={f.key} field={f} index={i} count={fields.length}
              onPatch={(p) => patchAt(i, p)}
              onMove={(d) => move(i, d)}
              onRemove={() => mutate(fields.filter((_, j) => j !== i))}
            />
          ))}
        </div>
      )}

      {unusedPresets.length > 0 && fields.length < MAX_FIELDS && (
        <div>
          <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-3">Common questions</div>
          <div className="flex flex-wrap gap-1.5">
            {unusedPresets.map((p) => (
              <button key={p.key} type="button" onClick={() => addField(p)}
                className="inline-flex items-center gap-1 rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-xs text-ink-2 transition-colors hover:border-accent-teal/40 hover:text-ink">
                <Plus size={11} /> {p.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {errors.length > 0 && (
        <div className="space-y-1 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2.5">
          {errors.map((e) => (
            <div key={e} className="flex gap-1.5 text-[11px] text-red-300">
              <AlertTriangle size={12} className="mt-px shrink-0" /> {e}
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-line-soft pt-3">
        <Btn size="sm" variant="secondary" icon={Plus} disabled={fields.length >= MAX_FIELDS}
          onClick={() => addField(null)}>
          Add question
        </Btn>
        <Btn size="sm" disabled={saving || !dirty || errors.length > 0} onClick={save}>
          {saving ? "Saving…" : "Save form"}
        </Btn>
        {dirty && errors.length === 0 && <span className="text-[11px] text-amber-300">Unsaved changes</span>}
      </div>
    </Card>
  );
}
