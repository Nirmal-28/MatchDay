import { useState } from "react";
import { Link } from "react-router-dom";
import { MailCheck } from "lucide-react";
import { requestPasswordReset } from "../../lib/repository";
import { validateEmail } from "../../lib/validation";
import { Field, Btn, Card, inputCls } from "../../components/ui/primitives";

// Step one of password recovery. Deliberately says the same thing whether or
// not the address has an account — see requestPasswordReset() for why.
export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const invalid = validateEmail(email);
    if (invalid) { setError(invalid); return; }
    setError(""); setSaving(true);
    try {
      await requestPasswordReset(email.trim());
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally { setSaving(false); }
  };

  if (sent) {
    return (
      <div className="mx-auto max-w-sm py-12 text-center">
        <MailCheck className="mx-auto mb-2 text-emerald-500" size={32} />
        <h1 className="text-lg font-semibold text-ink">Check your email</h1>
        <p className="mt-1.5 text-sm text-ink-2">
          If <span className="text-ink">{email.trim()}</span> has a MatchDay account, a reset
          link is on its way. The link works once and expires in an hour.
        </p>
        <p className="mt-3 text-xs text-ink-3">
          Nothing arrived? Check spam, then try again in a few minutes.
        </p>
        <Link className="mt-5 inline-block text-sm text-accent-teal hover:underline" to="/login">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm py-10">
      <h1 className="mb-1 text-xl font-bold text-ink">Reset your password</h1>
      <p className="mb-5 text-sm text-ink-2">
        Enter the email you signed up with and we will send you a link to set a new password.
      </p>
      <Card className="p-5">
        <form className="space-y-3" onSubmit={submit} noValidate>
          <Field label="Email">
            <input
              type="email" autoComplete="email" required className={inputCls}
              value={email} onChange={(e) => setEmail(e.target.value)}
              aria-invalid={!!error} aria-describedby={error ? "reset-error" : undefined}
            />
          </Field>
          {error && (
            <div id="reset-error" role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}
          <Btn className="w-full" disabled={saving} type="submit">
            {saving ? "Sending…" : "Send reset link"}
          </Btn>
        </form>
      </Card>
      <p className="mt-3 text-center text-sm text-ink-2">
        Remembered it? <Link className="text-accent-teal hover:underline" to="/login">Sign in</Link>
      </p>
    </div>
  );
}
