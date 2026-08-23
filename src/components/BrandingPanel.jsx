import { useRef, useState } from "react";
import { Image, Loader2, Plus, Trash2, Palette, Megaphone, Eye } from "lucide-react";
import { cx, accentTheme } from "../lib/engines";
import { updateTournament, uploadTournamentMedia } from "../lib/repository";
import { Btn, Card, Field, inputCls, Badge } from "../components/ui/primitives";

// Organizer branding for the public tournament page and venue display.
// MatchDay stays the master brand: an organizer supplies a logo, a cover
// image, one accent colour and sponsor art. The accent is validated as a
// six-digit hex in the database and only ever used for accents — never as a
// page background — and text drawn on it picks black or white by luminance,
// so a badly chosen colour can dull the page but cannot make it unreadable.

const PRESETS = ["#2DD4BF", "#38BDF8", "#A78BFA", "#F472B6", "#FBBF24", "#34D399", "#F87171", "#818CF8"];

function ImageField({ label, hint, value, onChange, onUpload, uploading, aspect = "h-24 w-24" }) {
  const ref = useRef(null);
  return (
    <div>
      <span className="mb-1 block text-xs font-medium text-ink-2">{label}</span>
      <div className="flex items-center gap-3">
        <div className={cx("flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-surface-2", aspect)}>
          {value ? <img src={value} alt="" className="h-full w-full object-cover" /> : <Image size={18} className="text-ink-3" />}
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex gap-1.5">
            <Btn size="sm" variant="secondary" disabled={uploading} onClick={() => ref.current?.click()}>
              {uploading ? <Loader2 size={14} className="animate-spin" /> : "Upload"}
            </Btn>
            {value && <Btn size="sm" variant="ghost" onClick={() => onChange("")}>Remove</Btn>}
          </div>
          <input
            className={cx(inputCls, "py-1 text-xs")} placeholder="…or paste an image URL"
            value={value || ""} onChange={(e) => onChange(e.target.value)}
          />
        </div>
      </div>
      <input ref={ref} type="file" accept="image/*" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ""; }} />
      {hint && <span className="mt-1 block text-[11px] text-ink-3">{hint}</span>}
    </div>
  );
}

export default function BrandingPanel({ tournament, notify, onChanged }) {
  const [form, setForm] = useState({
    logo_url: tournament.logo_url || "",
    cover_image_url: tournament.cover_image_url || "",
    accent_color: tournament.accent_color || "",
    description: tournament.description || "",
    announcement: tournament.announcement || "",
    sponsors: Array.isArray(tournament.sponsors) ? tournament.sponsors : [],
  });
  const [uploading, setUploading] = useState(null);
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const theme = accentTheme(form.accent_color);

  const upload = (kind, key) => async (file) => {
    if (file.size > 5 * 1024 * 1024) { notify("Image must be under 5 MB.", "error"); return; }
    setUploading(kind);
    try {
      const url = await uploadTournamentMedia(tournament.id, file, kind);
      set(key, url);
    } catch (e) { notify(e.message, "error"); }
    finally { setUploading(null); }
  };

  const uploadSponsor = async (i, file) => {
    if (file.size > 5 * 1024 * 1024) { notify("Image must be under 5 MB.", "error"); return; }
    setUploading(`sponsor-${i}`);
    try {
      const url = await uploadTournamentMedia(tournament.id, file, "sponsor");
      setForm((f) => ({ ...f, sponsors: f.sponsors.map((s, j) => (j === i ? { ...s, logoUrl: url } : s)) }));
    } catch (e) { notify(e.message, "error"); }
    finally { setUploading(null); }
  };

  const save = async () => {
    setSaving(true);
    try {
      const accent = form.accent_color.trim();
      if (accent && !/^#[0-9a-fA-F]{6}$/.test(accent)) {
        throw new Error("Accent colour must be a six-digit hex value, e.g. #2DD4BF.");
      }
      await updateTournament(tournament.id, {
        logo_url: form.logo_url || null,
        cover_image_url: form.cover_image_url || null,
        accent_color: accent || null,
        description: form.description || null,
        announcement: form.announcement || null,
        sponsors: form.sponsors.filter((s) => s.name?.trim() || s.logoUrl),
      });
      notify("Branding saved.");
      await onChanged?.();
    } catch (e) { notify(e.message, "error"); }
    finally { setSaving(false); }
  };

  return (
    <div className="max-w-2xl space-y-4">
      <Card className="space-y-4 p-5">
        <div className="text-xs font-semibold uppercase tracking-wide text-ink-2">Identity</div>
        <ImageField
          label="Tournament logo" value={form.logo_url}
          hint="Square works best. Shown beside the tournament name on the public page and venue display."
          onChange={(v) => set("logo_url", v)} onUpload={upload("logo", "logo_url")} uploading={uploading === "logo"}
        />
        <ImageField
          label="Cover image" value={form.cover_image_url} aspect="h-24 w-40"
          hint="Wide banner across the top of the public page. Text sits on a scrim so any image stays readable."
          onChange={(v) => set("cover_image_url", v)} onUpload={upload("cover", "cover_image_url")} uploading={uploading === "cover"}
        />
        <Field label="Description" hint="One or two sentences shown under the tournament name.">
          <textarea rows={3} className={inputCls} value={form.description} onChange={(e) => set("description", e.target.value)} />
        </Field>
      </Card>

      <Card className="space-y-3 p-5">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-2">
          <Palette size={13} /> Accent colour
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {PRESETS.map((c) => (
            <button key={c} type="button" onClick={() => set("accent_color", c)}
              className={cx("h-7 w-7 rounded-full border-2 transition-transform hover:scale-110",
                form.accent_color.toUpperCase() === c ? "border-white" : "border-transparent")}
              style={{ background: c }} aria-label={`Use ${c}`} />
          ))}
          <input type="color" className="h-7 w-9 cursor-pointer rounded border border-line bg-surface-2"
            value={/^#[0-9a-fA-F]{6}$/.test(form.accent_color) ? form.accent_color : "#2DD4BF"}
            onChange={(e) => set("accent_color", e.target.value.toUpperCase())} aria-label="Custom colour" />
          <input className={cx(inputCls, "w-28 py-1 font-mono text-xs")} placeholder="#2DD4BF"
            value={form.accent_color} onChange={(e) => set("accent_color", e.target.value)} />
          {form.accent_color && <Btn size="sm" variant="ghost" onClick={() => set("accent_color", "")}>Reset</Btn>}
        </div>

        {/* Live preview of exactly how the accent gets used. */}
        <div className="rounded-lg border border-line bg-surface-2 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-ink-3">
            <Eye size={11} /> Preview
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md px-3 py-1.5 text-xs font-semibold"
              style={{ background: theme.accent, color: theme.onAccent }}>
              Register
            </span>
            <span className="rounded border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide"
              style={{ borderColor: theme.accent, color: theme.accent }}>
              Live
            </span>
            <span className="text-sm font-semibold" style={{ color: theme.accent }}>Tournament heading</span>
          </div>
          <p className="mt-2 text-[11px] text-ink-3">
            {theme.isCustom
              ? "Text on the accent switches between black and white automatically, so contrast holds whatever colour you pick."
              : "Using the MatchDay default accent."}
          </p>
        </div>
      </Card>

      <Card className="space-y-3 p-5">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-2">
          <Megaphone size={13} /> Announcement
        </div>
        <Field label="Venue announcement" hint="Shown as a banner on the public page and across the top of the venue display. Leave blank to hide.">
          <input className={inputCls} placeholder="Courts 3 and 4 are on the first floor."
            value={form.announcement} onChange={(e) => set("announcement", e.target.value)} />
        </Field>
      </Card>

      <Card className="space-y-3 p-5">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-2">Sponsors</div>
          <Btn size="sm" variant="secondary" icon={Plus}
            onClick={() => set("sponsors", [...form.sponsors, { name: "", logoUrl: "", url: "" }])}>
            Add sponsor
          </Btn>
        </div>
        {form.sponsors.length === 0 ? (
          <p className="text-sm text-ink-3">No sponsors added. They appear on the public page and the venue display.</p>
        ) : form.sponsors.map((s, i) => (
          <div key={i} className="space-y-2 rounded-lg border border-line p-3">
            <div className="flex items-center justify-between gap-2">
              <Badge tone="slate">Sponsor {i + 1}</Badge>
              <button className="rounded p-1 text-ink-3 hover:text-red-400"
                onClick={() => set("sponsors", form.sponsors.filter((_, j) => j !== i))} aria-label="Remove sponsor">
                <Trash2 size={14} />
              </button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Name">
                <input className={inputCls} value={s.name || ""}
                  onChange={(e) => set("sponsors", form.sponsors.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              </Field>
              <Field label="Website (optional)">
                <input className={inputCls} placeholder="https://" value={s.url || ""}
                  onChange={(e) => set("sponsors", form.sponsors.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
              </Field>
            </div>
            <ImageField
              label="Logo" value={s.logoUrl} aspect="h-16 w-24"
              onChange={(v) => set("sponsors", form.sponsors.map((x, j) => (j === i ? { ...x, logoUrl: v } : x)))}
              onUpload={(f) => uploadSponsor(i, f)} uploading={uploading === `sponsor-${i}`}
            />
          </div>
        ))}
      </Card>

      <div className="flex gap-2">
        <Btn disabled={saving} onClick={save}>{saving ? "Saving…" : "Save branding"}</Btn>
        {tournament.slug && (
          <Btn variant="secondary" onClick={() => window.open(`/t/${tournament.slug}`, "_blank")}>View public page ↗</Btn>
        )}
      </div>
    </div>
  );
}
