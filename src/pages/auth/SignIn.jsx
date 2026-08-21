import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { signIn } from "../../lib/repository";
import { Field, Btn, Card, inputCls } from "../../components/ui/primitives";

export default function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setSaving(true);
    try {
      await signIn(email, password);
      navigate("/organizer");
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  };

  return (
    <div className="mx-auto max-w-sm py-10">
      <h1 className="mb-5 text-xl font-bold text-ink">Organizer sign in</h1>
      <Card className="p-5">
        <form className="space-y-3" onSubmit={submit}>
          <Field label="Email"><input type="email" required className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Password"><input type="password" required className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          {error && <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}
          <Btn className="w-full" disabled={saving} type="submit">Sign in</Btn>
        </form>
      </Card>
      <p className="mt-3 text-center text-sm text-ink-2">No account yet? <Link className="text-accent-teal hover:underline" to="/signup">Sign up</Link></p>
    </div>
  );
}
