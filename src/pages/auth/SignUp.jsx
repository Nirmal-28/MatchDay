import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import { signUp } from "../../lib/repository";
import { Field, Btn, Card, inputCls } from "../../components/ui/primitives";

export default function SignUp() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const navigate = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setSaving(true);
    try {
      const data = await signUp(email, password);
      if (data.session) navigate("/organizer"); else setDone(true);
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  };

  if (done) {
    return (
      <div className="mx-auto max-w-sm py-10 text-center">
        <CheckCircle2 className="mx-auto mb-2 text-emerald-600" size={32} />
        <h1 className="text-lg font-semibold text-ink">Check your email</h1>
        <p className="mt-1 text-sm text-ink-2">Confirm your address, then sign in to start creating tournaments.</p>
        <Link className="mt-4 inline-block text-sm text-accent-teal hover:underline" to="/login">Go to sign in</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm py-10">
      <h1 className="mb-5 text-xl font-bold text-ink">Create an organizer account</h1>
      <Card className="p-5">
        <form className="space-y-3" onSubmit={submit}>
          <Field label="Email"><input type="email" required className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Password" hint="At least 6 characters."><input type="password" required minLength={6} className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          {error && <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}
          <Btn className="w-full" disabled={saving} type="submit">Sign up</Btn>
        </form>
      </Card>
      <p className="mt-3 text-center text-sm text-ink-2">Already have an account? <Link className="text-accent-teal hover:underline" to="/login">Sign in</Link></p>
    </div>
  );
}
