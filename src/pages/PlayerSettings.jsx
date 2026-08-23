import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronLeft, Camera, Loader2, User } from "lucide-react";
import { cx, SKILL_LEVELS, GENDERS } from "../lib/engines";
import { SPORT_KEYS, SportIcon } from "../components/ui/motion";
import { getMyPlayer, linkMyPlayer, updateMyProfile, uploadAvatar } from "../lib/repository";
import { useAuth } from "../lib/AuthContext";
import { Btn, Card, Field, inputCls, EmptyState, useToasts, Toasts } from "../components/ui/primitives";
import { BrandLoader } from "../components/ui/motion";
import NotificationPreferences from "../components/NotificationPreferences";
import ChangePassword from "../components/ChangePassword";
import { useDocumentMeta } from "../lib/useDocumentMeta";

// Badminton is the only sport with a scoring/rules engine today. A player can
// still say which sports they play — that is profile data, not a claim that
// MatchDay runs those tournaments — so the others are selectable but labelled.
const SUPPORTED_SPORTS = ["badminton"];

export default function PlayerSettings() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const { toasts, notify } = useToasts();
  const fileRef = useRef(null);
  useDocumentMeta({ title: "Your profile" });

  const [player, setPlayer] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const p = await getMyPlayer();
    setPlayer(p);
    setForm({
      name: p?.name ?? "",
      phone: p?.phone ?? "",
      email: p?.email ?? session?.user?.email ?? "",
      city: p?.city ?? "",
      club: p?.club ?? "",
      gender: p?.gender ?? "",
      date_of_birth: p?.date_of_birth ?? "",
      skill_level: p?.skill_level ?? "",
      sports: p?.sports?.length ? p.sports : ["badminton"],
      bio: p?.bio ?? "",
      photo_url: p?.photo_url ?? "",
    });
  }, [session]);

  useEffect(() => { if (session) load(); }, [session, load]);

  if (loading) return <BrandLoader />;
  if (!session) {
    return (
      <EmptyState icon={User} title="Sign in to edit your profile"
        action={<Btn size="sm" className="mt-2" onClick={() => navigate("/login")}>Sign in</Btn>} />
    );
  }
  if (!form) return <BrandLoader />;

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const toggleSport = (s) =>
    setForm((f) => ({ ...f, sports: f.sports.includes(s) ? f.sports.filter((x) => x !== s) : [...f.sports, s] }));

  const pickPhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { notify("Photo must be under 5 MB.", "error"); return; }
    setUploading(true);
    try {
      const url = await uploadAvatar(file);
      set("photo_url", url);
      // Persist immediately — an uploaded file the user can't see saved is
      // worse than one extra write.
      if (player) await updateMyProfile({ photo_url: url });
      notify("Photo updated.");
    } catch (err) { notify(err.message, "error"); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setSaving(true);
    try {
      // link_my_player() is idempotent: it claims an existing phone/email
      // match created when an organizer registered this person, or creates a
      // fresh row. Either way the user ends up owning exactly one profile.
      if (!player) await linkMyPlayer({ phone: form.phone, name: form.name });

      const patch = {
        name: form.name.trim(),
        phone: form.phone.replace(/[^\d]/g, "").slice(-10) || null,
        email: form.email.trim() || null,
        city: form.city.trim() || null,
        club: form.club.trim() || null,
        gender: form.gender || null,
        date_of_birth: form.date_of_birth || null,
        skill_level: form.skill_level || null,
        sports: form.sports.length ? form.sports : ["badminton"],
        bio: form.bio.trim() || null,
        photo_url: form.photo_url || null,
      };
      const saved = await updateMyProfile(patch);
      setPlayer(saved);
      notify("Profile saved.");
      navigate("/me");
    } catch (err) {
      setError(err.message);
    } finally { setSaving(false); }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <Link to="/me" className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-ink-2 hover:text-ink">
        <ChevronLeft size={14} /> Dashboard
      </Link>
      <h1 className="mb-1 text-xl font-bold text-ink">{player ? "Your player profile" : "Set up your player profile"}</h1>
      <p className="mb-5 text-sm text-ink-2">
        {player
          ? "This is how organizers and other players see you."
          : "Add your phone number and MatchDay will connect this account to tournaments you have already been registered for."}
      </p>

      <form className="space-y-4" onSubmit={submit}>
        <Card className="p-5">
          <div className="flex flex-wrap items-center gap-4">
            <div className="relative">
              {form.photo_url ? (
                <img src={form.photo_url} alt="" className="h-20 w-20 rounded-2xl object-cover" />
              ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-accent-teal to-accent-blue font-display text-2xl font-bold text-white">
                  {(form.name || "?").split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()}
                </div>
              )}
              <button
                type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
                className="absolute -bottom-1 -right-1 rounded-full border border-line bg-surface p-1.5 text-ink-2 shadow hover:text-ink disabled:opacity-50"
                aria-label="Change photo"
              >
                {uploading ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
              </button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={pickPhoto} />
            </div>
            <div className="min-w-[12rem] flex-1">
              <Field label="Full name" required>
                <input required className={inputCls} value={form.name} onChange={(e) => set("name", e.target.value)} />
              </Field>
            </div>
          </div>
        </Card>

        <Card className="grid gap-3 p-5 sm:grid-cols-2">
          <Field label="Phone" hint="Used to link you to entries an organizer created for you.">
            <input inputMode="tel" className={inputCls} value={form.phone} onChange={(e) => set("phone", e.target.value)} />
          </Field>
          <Field label="Email">
            <input type="email" className={inputCls} value={form.email} onChange={(e) => set("email", e.target.value)} />
          </Field>
          <Field label="Date of birth" hint="Used only to check age-group eligibility.">
            <input type="date" className={inputCls} value={form.date_of_birth} onChange={(e) => set("date_of_birth", e.target.value)} />
          </Field>
          <Field label="Gender" hint="Determines which categories you can enter.">
            <select className={inputCls} value={form.gender} onChange={(e) => set("gender", e.target.value)}>
              <option value="">Not specified</option>
              {GENDERS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
            </select>
          </Field>
          <Field label="City">
            <input className={inputCls} value={form.city} onChange={(e) => set("city", e.target.value)} />
          </Field>
          <Field label="Club / academy">
            <input className={inputCls} value={form.club} onChange={(e) => set("club", e.target.value)} />
          </Field>
        </Card>

        <Card className="space-y-3 p-5">
          <Field label="Skill level">
            <select className={inputCls} value={form.skill_level} onChange={(e) => set("skill_level", e.target.value)}>
              <option value="">Not specified</option>
              {SKILL_LEVELS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </Field>

          <div>
            <span className="mb-1.5 block text-xs font-medium text-ink-2">Sports you play</span>
            <div className="flex flex-wrap gap-1.5">
              {SPORT_KEYS.map((s) => {
                const on = form.sports.includes(s);
                const supported = SUPPORTED_SPORTS.includes(s);
                return (
                  <button
                    key={s} type="button" onClick={() => toggleSport(s)}
                    title={supported ? undefined : "MatchDay does not run tournaments for this sport yet"}
                    className={cx(
                      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                      on ? "border-accent-teal bg-accent-teal/10 text-accent-teal" : "border-line text-ink-2 hover:bg-surface-2",
                      !supported && "opacity-70"
                    )}
                  >
                    <SportIcon sport={s} className="h-3.5 w-3.5" />
                    {s[0].toUpperCase() + s.slice(1)}
                    {!supported && <span className="text-[9px] uppercase text-ink-3">soon</span>}
                  </button>
                );
              })}
            </div>
            <span className="mt-1 block text-[11px] text-ink-3">Badminton is the only sport MatchDay runs tournaments for today.</span>
          </div>

          <Field label="About you" hint="Optional. Shown on your public profile.">
            <textarea rows={3} className={inputCls} value={form.bio} onChange={(e) => set("bio", e.target.value)} />
          </Field>
        </Card>

        {error && <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}

        <div className="flex gap-2">
          <Btn type="submit" disabled={saving || !form.name.trim()}>{saving ? "Saving…" : "Save profile"}</Btn>
          <Btn type="button" variant="ghost" onClick={() => navigate("/me")}>Cancel</Btn>
        </div>
      </form>

      {/* Account settings sit outside the profile form deliberately: they save
          themselves immediately, and nesting them would make "Save profile"
          look like it was responsible for them. */}
      <div className="mt-4 space-y-4">
        <NotificationPreferences />
        <ChangePassword />
      </div>

      <Toasts toasts={toasts} />
    </div>
  );
}
