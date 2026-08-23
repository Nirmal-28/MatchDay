import { useEffect, useState } from "react";
import { Bell, Mail, MessageSquare, Smartphone, Check } from "lucide-react";
import { getMyNotificationPreferences, updateMyNotificationPreferences } from "../lib/repository";
import { enablePush, disablePush, isPushSupported, isPushConfigured, isThisDeviceSubscribed, pushPermission } from "../lib/push";
import { Card } from "./ui/primitives";
import { cx } from "../lib/engines";

// Where a player wants to be reached.
//
// The important design rule here: a toggle is only offered when the channel
// can actually deliver. Showing an SMS switch that quietly does nothing is
// worse than not showing it, because the player then believes they will be
// texted when their match is called and stops checking the app.
//
// Whether a channel is live depends on the notify-dispatch Edge Function
// having the relevant provider secret — which is a deployment fact the
// browser cannot see. So each row states its own status plainly.

function Row({ icon: Icon, title, description, checked, onChange, disabled, status }) {
  return (
    <div className={cx("flex items-start gap-3 py-3", disabled && "opacity-60")}>
      <Icon size={17} className="mt-0.5 shrink-0 text-ink-3" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-ink">{title}</div>
        <div className="mt-0.5 text-[11px] leading-snug text-ink-2">{description}</div>
        {status && <div className="mt-1 text-[11px] text-amber-400/90">{status}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={title}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          "relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors",
          checked ? "bg-accent-teal" : "bg-surface-3",
          disabled && "cursor-not-allowed"
        )}
      >
        <span className={cx(
          "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform",
          checked ? "translate-x-4.5 left-0.5" : "left-0.5"
        )} />
      </button>
    </div>
  );
}

export default function NotificationPreferences() {
  const [prefs, setPrefs] = useState(null);
  const [deviceSubscribed, setDeviceSubscribed] = useState(false);
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getMyNotificationPreferences().then(setPrefs).catch(() => setPrefs({ email: true, sms: false, push: false }));
    isThisDeviceSubscribed().then(setDeviceSubscribed);
  }, []);

  const save = async (patch) => {
    setPrefs((p) => ({ ...p, ...patch }));
    setMessage("");
    try {
      await updateMyNotificationPreferences(patch);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setMessage(err.message);
    }
  };

  const togglePush = async (want) => {
    setMessage("");
    const result = want ? await enablePush() : await disablePush();
    if (!result.ok) { setMessage(result.reason); return; }
    setDeviceSubscribed(want);
    setPrefs((p) => ({ ...p, push: want }));
  };

  if (!prefs) return null;

  const pushSupported = isPushSupported();
  const pushConfigured = isPushConfigured();
  const permission = pushPermission();

  return (
    <Card className="p-5">
      <div className="mb-1 flex items-center gap-2">
        <Bell size={15} className="text-accent-teal" />
        <h2 className="text-sm font-semibold text-ink">Notifications</h2>
        {saved && <span className="flex items-center gap-1 text-[11px] text-emerald-400"><Check size={12} /> Saved</span>}
      </div>
      <p className="mb-1 text-[11px] text-ink-2">
        In-app notifications are always on — that is the bell in the header. These control
        whether anything is also sent to you when the app is closed.
      </p>

      <div className="divide-y divide-line">
        <Row
          icon={Mail} title="Email"
          description="Match scheduled, result confirmed, registration approved or rejected."
          checked={!!prefs.email} onChange={(v) => save({ email: v })}
        />
        <Row
          icon={Smartphone} title="Push notifications"
          description="Alerts on this device when your match is called."
          checked={!!prefs.push && deviceSubscribed}
          onChange={togglePush}
          disabled={!pushSupported || !pushConfigured || permission === "denied"}
          status={
            !pushSupported ? "This browser does not support push notifications."
            : !pushConfigured ? "Not available on this deployment yet."
            : permission === "denied" ? "Blocked in your browser settings for this site."
            : prefs.push && !deviceSubscribed ? "Enabled on another device — turn it on here too if you want alerts on this one."
            : null
          }
        />
        <Row
          icon={MessageSquare} title="SMS"
          description="Text messages for the same events, to the number on your profile."
          checked={!!prefs.sms} onChange={(v) => save({ sms: v })}
          disabled
          status="Not connected. Indian SMS needs a DLT-registered template and a gateway account — see supabase-integration/README.md."
        />
      </div>

      {message && (
        <div role="alert" className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          {message}
        </div>
      )}
    </Card>
  );
}
