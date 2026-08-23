import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CheckCircle2, ShieldAlert } from "lucide-react";
import { updateMyPassword, getSession } from "../../lib/repository";
import { validatePassword } from "../../lib/validation";
import { useAuth } from "../../lib/AuthContext";
import { Field, Btn, Card, inputCls } from "../../components/ui/primitives";

// Step two of password recovery — the page the emailed link lands on.
//
// Supabase turns the token in the URL fragment into a real (recovery) session
// before React mounts, so the check here is simply "is there a session?". If
// someone opens this URL directly with no session, they are told to request a
// link rather than shown a form that cannot possibly work.
export default function ResetPassword() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [checking, setChecking] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const navigate = useNavigate();
  const { refreshCaps } = useAuth();

  useEffect(() => {
    let alive = true;
    // The recovery session is established from the URL fragment
    // asynchronously, so a single immediate check can race it. Re-check
    // briefly before concluding the link is bad.
    const attempt = async (triesLeft) => {
      const session = await getSession();
      if (!alive) return;
      if (session) { setHasSession(true); setChecking(false); return; }
      if (triesLeft > 0) { setTimeout(() => attempt(triesLeft - 1), 300); return; }
      setChecking(false);
    };
    attempt(5);
    return () => { alive = false; };
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    const invalid = validatePassword(password);
    if (invalid) { setError(invalid); return; }
    if (password !== confirm) { setError("Both passwords must match."); return; }
    setError(""); setSaving(true);
    try {
      await updateMyPassword(password);
      await refreshCaps();
      setDone(true);
      // The recovery link has now been spent, and they are signed in.
      setTimeout(() => navigate("/me", { replace: true }), 1600);
    } catch (err) {
      setError(err.message);
    } finally { setSaving(false); }
  };

  if (checking) {
    return <div className="py-16 text-center text-sm text-ink-2">Checking your reset link…</div>;
  }

  if (!hasSession) {
    return (
      <div className="mx-auto max-w-sm py-12 text-center">
        <ShieldAlert className="mx-auto mb-2 text-amber-400" size={32} />
        <h1 className="text-lg font-semibold text-ink">This reset link is not valid</h1>
        <p className="mt-1.5 text-sm text-ink-2">
          Reset links work once and expire after an hour. Request a fresh one and use the
          newest email — older links stop working as soon as a new one is sent.
        </p>
        <Link className="mt-5 inline-block text-sm text-accent-teal hover:underline" to="/forgot-password">
          Send a new link
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="mx-auto max-w-sm py-12 text-center">
        <CheckCircle2 className="mx-auto mb-2 text-emerald-500" size={32} />
        <h1 className="text-lg font-semibold text-ink">Password updated</h1>
        <p className="mt-1.5 text-sm text-ink-2">You are signed in. Taking you to your matches…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm py-10">
      <h1 className="mb-1 text-xl font-bold text-ink">Choose a new password</h1>
      <p className="mb-5 text-sm text-ink-2">At least 8 characters. You will be signed in straight after.</p>
      <Card className="p-5">
        <form className="space-y-3" onSubmit={submit} noValidate>
          <Field label="New password">
            <input
              type="password" autoComplete="new-password" required className={inputCls}
              value={password} onChange={(e) => setPassword(e.target.value)}
              aria-invalid={!!error}
            />
          </Field>
          <Field label="Confirm new password">
            <input
              type="password" autoComplete="new-password" required className={inputCls}
              value={confirm} onChange={(e) => setConfirm(e.target.value)}
            />
          </Field>
          {error && (
            <div role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}
          <Btn className="w-full" disabled={saving} type="submit">
            {saving ? "Updating…" : "Update password"}
          </Btn>
        </form>
      </Card>
    </div>
  );
}
