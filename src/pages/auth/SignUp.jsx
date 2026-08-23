import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CheckCircle2, Trophy, User, Gavel } from "lucide-react";
import { signUp, claimMyInvites, linkMyPlayer } from "../../lib/repository";
import { validateEmail, validatePassword, validatePhone, validateText, collect, firstError, normalisePhone, LIMITS } from "../../lib/validation";
import { useAuth } from "../../lib/AuthContext";
import { Field, Btn, Card, inputCls } from "../../components/ui/primitives";

// ONE MatchDay account.
//
// There is deliberately no "are you a player or an organizer?" step here.
// The same person competes in one tournament, runs another, and referees a
// third — those are capabilities attached to tournaments, not account types.
// Signing up always creates the player identity (it costs nothing and means
// their history attaches the first time an organizer enters them); creating a
// tournament later is what makes someone an organizer, of that tournament.
const CAPABILITIES = [
  { icon: User, title: "Play", body: "Enter tournaments, track your matches, results and ranking." },
  { icon: Trophy, title: "Organize", body: "Create a tournament any time — no second account needed." },
  { icon: Gavel, title: "Officiate", body: "Referee or score when an organizer adds you to their staff." },
];

export default function SignUp() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const navigate = useNavigate();
  const { refreshCaps } = useAuth();

  const submit = async (e) => {
    e.preventDefault();

    // Everything is checked before a network call, so a typo in the phone
    // number does not cost someone an account they then cannot link.
    const errors = collect({
      name: validateText(name, { label: "Full name", max: LIMITS.name }),
      phone: validatePhone(phone),
      email: validateEmail(email),
      password: validatePassword(password),
    });
    setFieldErrors(errors || {});
    if (errors) { setError(firstError(errors)); return; }

    setError(""); setSaving(true);
    try {
      const data = await signUp(email.trim(), password);

      // Without email confirmation Supabase returns a session immediately;
      // with it, the account exists but nothing is signed in yet, so profile
      // setup waits until they confirm and sign in.
      if (!data.session) { setDone(true); return; }

      await claimMyInvites();
      // Claims an existing player row when this phone/email was already
      // entered into a tournament by an organizer, so the new account arrives
      // with its match history already attached.
      await linkMyPlayer({ phone: normalisePhone(phone), name: name.trim() });
      await refreshCaps();
      navigate("/me");
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  };

  if (done) {
    return (
      <div className="mx-auto max-w-sm py-10 text-center">
        <CheckCircle2 className="mx-auto mb-2 text-emerald-500" size={32} />
        <h1 className="text-lg font-semibold text-ink">Check your email</h1>
        <p className="mt-1 text-sm text-ink-2">Confirm your address, then sign in to finish setting up your profile.</p>
        <Link className="mt-4 inline-block text-sm text-accent-teal hover:underline" to="/login">Go to sign in</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md py-10">
      <h1 className="mb-1 text-xl font-bold text-ink">Create your MatchDay account</h1>
      <p className="mb-5 text-sm text-ink-2">
        One account does everything — play, organize and officiate. You never need a second one.
      </p>

      <div className="mb-4 grid gap-2 sm:grid-cols-3">
        {CAPABILITIES.map((c) => (
          <div key={c.title} className="rounded-lg border border-line bg-surface p-3">
            <c.icon size={15} className="text-accent-teal" />
            <div className="mt-1.5 text-sm font-semibold text-ink">{c.title}</div>
            <div className="mt-0.5 text-[11px] leading-snug text-ink-2">{c.body}</div>
          </div>
        ))}
      </div>

      <Card className="p-5">
        <form className="space-y-3" onSubmit={submit} noValidate>
          <Field label="Full name" required hint={fieldErrors.name}>
            <input required autoComplete="name" maxLength={LIMITS.name} className={inputCls} value={name}
              aria-invalid={!!fieldErrors.name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Phone" hint={fieldErrors.phone || "If an organizer has already entered you in a tournament, this links that history to your account."}>
            <input inputMode="tel" autoComplete="tel" className={inputCls} value={phone}
              aria-invalid={!!fieldErrors.phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field label="Email" hint={fieldErrors.email}>
            <input type="email" autoComplete="email" required className={inputCls} value={email}
              aria-invalid={!!fieldErrors.email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password" hint={fieldErrors.password || "At least 8 characters."}>
            <input type="password" autoComplete="new-password" required className={inputCls} value={password}
              aria-invalid={!!fieldErrors.password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {error && <div role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}
          <Btn className="w-full" disabled={saving} type="submit">{saving ? "Creating account…" : "Create account"}</Btn>
        </form>
      </Card>
      <p className="mt-3 text-center text-sm text-ink-2">Already have an account? <Link className="text-accent-teal hover:underline" to="/login">Sign in</Link></p>
    </div>
  );
}
