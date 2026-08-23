import { useState } from "react";
import { KeyRound, Check } from "lucide-react";
import { updateMyPassword } from "../lib/repository";
import { validatePassword } from "../lib/validation";
import { Card, Btn, Field, inputCls } from "./ui/primitives";

// Changing a password while signed in — the counterpart to the emailed
// recovery flow in pages/auth/ResetPassword.jsx. Both go through the same
// updateMyPassword() and the same validatePassword() rules, so the floor for
// what counts as an acceptable password is defined in exactly one place.
export default function ChangePassword() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const invalid = validatePassword(password);
    if (invalid) { setError(invalid); return; }
    if (password !== confirm) { setError("Both passwords must match."); return; }
    setError(""); setSaving(true);
    try {
      await updateMyPassword(password);
      setDone(true);
      setPassword(""); setConfirm(""); setOpen(false);
      setTimeout(() => setDone(false), 3000);
    } catch (err) {
      setError(err.message);
    } finally { setSaving(false); }
  };

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <KeyRound size={15} className="text-accent-teal" />
          <div>
            <h2 className="text-sm font-semibold text-ink">Password</h2>
            <p className="text-[11px] text-ink-2">Change the password you sign in with.</p>
          </div>
        </div>
        {done ? (
          <span className="flex items-center gap-1 text-[11px] text-emerald-400"><Check size={12} /> Updated</span>
        ) : (
          <Btn type="button" size="sm" variant="secondary" onClick={() => { setOpen((o) => !o); setError(""); }}>
            {open ? "Cancel" : "Change"}
          </Btn>
        )}
      </div>

      {open && (
        // Not nested in the profile form — a form inside a form is invalid
        // HTML and would submit both.
        <form className="mt-4 space-y-3" onSubmit={submit} noValidate>
          <Field label="New password" hint="At least 8 characters.">
            <input type="password" autoComplete="new-password" className={inputCls}
              value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!error} />
          </Field>
          <Field label="Confirm new password">
            <input type="password" autoComplete="new-password" className={inputCls}
              value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          {error && (
            <div role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}
          <Btn type="submit" size="sm" disabled={saving}>{saving ? "Updating…" : "Update password"}</Btn>
        </form>
      )}
    </Card>
  );
}
