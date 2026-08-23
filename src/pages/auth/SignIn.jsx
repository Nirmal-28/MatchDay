import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { signIn, claimMyInvites, getMyPlayer } from "../../lib/repository";
import { validateEmail } from "../../lib/validation";
import { Field, Btn, Card, inputCls } from "../../components/ui/primitives";

export default function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const submit = async (e) => {
    e.preventDefault();
    const invalid = validateEmail(email);
    if (invalid) { setError(invalid); return; }
    if (!password) { setError("Password is required."); return; }
    setError(""); setSaving(true);
    try {
      await signIn(email.trim(), password);

      // Any staff invite addressed to this (Supabase-verified) email becomes a
      // real role now. This is the moment the invite flow completes — see
      // StaffPanel for why it cannot happen at invite time.
      await claimMyInvites();

      // Send people where they were headed. Otherwise: everyone has one
      // account with the same surfaces available, so the default landing is
      // Play — an organizer is one click away in the header and their own
      // tournaments are unaffected.
      const from = location.state?.from?.pathname;
      if (from) { navigate(from, { replace: true }); return; }
      const player = await getMyPlayer();
      navigate(player ? "/me" : "/organizer");
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  };

  return (
    <div className="mx-auto max-w-sm py-10">
      <h1 className="mb-1 text-xl font-bold text-ink">Sign in to MatchDay</h1>
      <p className="mb-5 text-sm text-ink-2">One account for playing, organizing and officiating.</p>
      <Card className="p-5">
        <form className="space-y-3" onSubmit={submit} noValidate>
          <Field label="Email">
            <input type="email" autoComplete="email" required className={inputCls} value={email}
              onChange={(e) => setEmail(e.target.value)} aria-invalid={!!error} />
          </Field>
          <Field label="Password">
            <input type="password" autoComplete="current-password" required className={inputCls} value={password}
              onChange={(e) => setPassword(e.target.value)} aria-invalid={!!error} />
          </Field>
          {error && <div role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}
          <Btn className="w-full" disabled={saving} type="submit">{saving ? "Signing in…" : "Sign in"}</Btn>
          <div className="text-center">
            <Link className="text-xs text-ink-2 hover:text-ink hover:underline" to="/forgot-password">
              Forgot your password?
            </Link>
          </div>
        </form>
      </Card>
      <p className="mt-3 text-center text-sm text-ink-2">No account yet? <Link className="text-accent-teal hover:underline" to="/signup">Sign up</Link></p>
    </div>
  );
}
