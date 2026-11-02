import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowRight, ArrowUp, Calendar, ChevronDown, Clock, Info, Loader2, MapPin, RotateCcw, Sparkles } from "lucide-react";
import { cx, fmtDateRange, inr, todayLocal, FORMAT_META } from "../lib/engines";
import { buildPlan, draftChanges } from "../lib/assistantPlan";
import { askAssistant, createTournamentFromPlan } from "../lib/repository";
import { useAuth } from "../lib/AuthContext";
import { Btn, Badge, Card, inputCls } from "./ui/primitives";

/* The front door for organizing: paste what you have, check the result, tap
   Create. The chat only ever produces a draft. Everything on the right is
   built from that draft by lib/assistantPlan.js, and nothing is saved until
   the Create button. */

const MAX_CHARS = 38000; // Leaves room for the draft inside the server's 40,000.

const EXAMPLE = `Sunday doubles at Smash Arena, 9am, 2 courts, groups of 3, top 2 go through

1. Rahul / Arjun
2. Kiran / Ravi
3. Sneha / Divya
4. Priya / Meera
5. Ajith / Vijay
6. Suresh / Dinesh`;

const emptyChat = { messages: [], draft: null };

// The chat survives moving to another page and back. It is only a convenience,
// so a blocked or empty sessionStorage just means starting from a clean box.
function loadChat(key) {
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(key));
    return Array.isArray(saved?.messages) ? saved : emptyChat;
  } catch {
    return emptyChat;
  }
}
function saveChat(key, chat) {
  try { window.sessionStorage.setItem(key, JSON.stringify(chat)); } catch { /* no-op */ }
}

function changeNote({ added, removed }) {
  const parts = [];
  if (added.length) parts.push(`Added: ${added.join(", ")}`);
  if (removed.length) parts.push(`Removed: ${removed.join(", ")}`);
  return parts.join(". ");
}

function Bubble({ message }) {
  const mine = message.role === "user";
  return (
    <div className={cx("flex", mine ? "justify-end" : "justify-start")}>
      <div className={cx(
        "max-w-[90%] rounded-lg px-3 py-2 text-sm",
        mine ? "max-h-44 overflow-y-auto whitespace-pre-wrap break-words bg-surface-3 text-ink" : "border border-line bg-surface-2 text-ink"
      )}>
        {message.text}
        {message.note && <div className="mt-1.5 border-t border-line-soft pt-1.5 text-xs font-medium text-accent-teal">{message.note}</div>}
      </div>
    </div>
  );
}

function MatchList({ matches }) {
  return (
    <details className="group mt-2">
      <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-ink-2 hover:text-ink">
        <ChevronDown size={13} className="transition-transform group-open:rotate-180" /> See all {matches.length} matches
      </summary>
      <ol className="mt-1.5 max-h-56 space-y-1 overflow-y-auto text-xs text-ink-2">
        {matches.map((m, i) => (
          <li key={`${m.line}-${i}`} className="flex gap-2">
            <span className="w-14 shrink-0 text-ink-3">{m.group ? `Grp ${m.group}` : `M${i + 1}`}</span>
            <span className="min-w-0">
              {m.sides.map((s, j) => (
                <span key={j}>
                  {j > 0 && <span className="px-1 text-ink-3">vs</span>}
                  {s ? s.players.map((p) => p.name).join(" / ") : <span className="text-ink-3">bye</span>}
                </span>
              ))}
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}

function CategoryPreview({ category }) {
  const { label, format, players, groups, drawPlan, isDoubles, feeINR, advancePerGroup, source } = category;
  return (
    <div className="border-t border-line-soft px-4 py-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-sm font-semibold text-ink">{label}</span>
        <Badge tone="teal">{FORMAT_META[format].label}</Badge>
      </div>
      <p className="mt-0.5 text-xs text-ink-3">
        {players.length} {isDoubles ? "pairs" : "players"}
        {feeINR > 0 && ` · ${inr(feeINR)} entry`}
        {format === "GROUP_KO" && ` · top ${advancePerGroup} from each group go through`}
        {source === "matchups" && " · your matchups, exactly as written"}
      </p>
      {groups.length > 0 && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {groups.map((g) => (
            <div key={g.label} className="rounded-md border border-line bg-surface-2 px-2.5 py-2">
              <div className="md-eyebrow mb-1">Group {g.label}</div>
              <ul className="space-y-0.5 text-xs text-ink">
                {g.names.map((n) => <li key={n}>{n}</li>)}
              </ul>
            </div>
          ))}
        </div>
      )}
      {drawPlan.matches.length > 0 && <MatchList matches={drawPlan.matches} />}
    </div>
  );
}

function Notice({ tone, icon: Icon, children }) {
  return (
    <div className={cx(
      "flex gap-2 rounded-md border px-3 py-2 text-xs leading-relaxed",
      tone === "red" ? "border-red-500/30 bg-red-500/10 text-red-300" : "border-amber-400/30 bg-amber-400/[0.07] text-amber-200"
    )}>
      <Icon size={13} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

function PlanPreview({ plan, creating, onCreate }) {
  const { tournament: t, categories, missing, problems, warnings, assumed, estimate, ready } = plan;
  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-3">
        <div className="md-eyebrow mb-1 text-accent-teal">Check this</div>
        <div className="text-base font-semibold text-ink">{t.name || "Tournament name needed"}</div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-2">
          {t.venue && <span className="flex items-center gap-1"><MapPin size={12} />{t.venue}{t.location ? `, ${t.location}` : ""}</span>}
          {t.startDate && <span className="flex items-center gap-1"><Calendar size={12} />{fmtDateRange(t.startDate, t.endDate)}</span>}
          {estimate?.totalMatches > 0 && estimate.fits && (
            <span className="flex items-center gap-1"><Clock size={12} />{estimate.totalMatches} matches, finishing around {estimate.estimatedFinish}</span>
          )}
        </div>
      </div>

      {(missing.length > 0 || problems.length > 0 || warnings.length > 0) && (
        <div className="space-y-1.5 px-4 pb-3">
          {missing.length > 0 && <Notice tone="amber" icon={Info}>Still needed: {missing.join(", ")}. Add it in the chat.</Notice>}
          {problems.map((p) => <Notice key={p} tone="red" icon={AlertTriangle}>{p}</Notice>)}
          {warnings.map((w) => <Notice key={w} tone="amber" icon={AlertTriangle}>{w}</Notice>)}
        </div>
      )}

      {categories.map((c) => <CategoryPreview key={`${c.category}-${c.ageGroup}-${c.skillGrade ?? ""}`} category={c} />)}

      <div className="space-y-2 border-t border-line-soft bg-surface-2/50 px-4 py-3">
        {assumed.length > 0 && (
          <p className="text-xs text-ink-2">
            Not mentioned, so using: {assumed.join(", ")}. Say so in the chat to change any of these.
          </p>
        )}
        <Btn size="lg" className="w-full" icon={creating ? Loader2 : ArrowRight} disabled={!ready || creating} onClick={onCreate}>
          {creating ? "Creating your tournament..." : "Create tournament"}
        </Btn>
        <p className="text-[11px] text-ink-3">
          This creates the draw, the schedule and a public page anyone with the link can open. Until a match is played, the draw can still be reset.
        </p>
      </div>
    </Card>
  );
}

export default function AssistantChat({ onManual }) {
  const { session } = useAuth();
  const navigate = useNavigate();
  const storageKey = `matchday-assistant-${session?.user?.id}`;
  const [chat, setChat] = useState(() => loadChat(storageKey));
  const [text, setText] = useState("");
  const [pending, setPending] = useState(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(null);

  useEffect(() => { saveChat(storageKey, chat); }, [storageKey, chat]);

  const today = todayLocal();
  const plan = useMemo(() => (chat.draft ? buildPlan(chat.draft, { today }) : null), [chat.draft, today]);
  const started = chat.messages.length > 0 || pending;

  const send = async () => {
    const message = text.trim();
    if (!message || pending) return;
    if (message.length > MAX_CHARS) {
      setError("That's too much text for one message. Paste only the player list and the details.");
      return;
    }
    setError("");
    setPending(message);
    setText("");
    const messages = [...chat.messages, { role: "user", text: message }];
    try {
      const weekday = new Date().toLocaleDateString("en-IN", { weekday: "long" });
      const { reply, draft } = await askAssistant({
        messages: messages.map((m) => ({ role: m.role, content: m.text })),
        draft: chat.draft,
        today: `${weekday} ${today}`,
      });
      const note = plan ? changeNote(draftChanges(plan, buildPlan(draft, { today }))) : "";
      setChat({ messages: [...messages, { role: "assistant", text: reply, note }], draft });
    } catch (e) {
      setText(message);
      setError(e.message);
    } finally {
      setPending(null);
    }
  };

  const onKeyDown = (e) => {
    // Enter sends a one-line message. Once it's a list, or on a phone keyboard,
    // Enter has to stay a new line, and the button sends.
    const phone = window.matchMedia?.("(pointer: coarse)")?.matches;
    if (e.key === "Enter" && !e.shiftKey && !phone && !text.includes("\n")) {
      e.preventDefault();
      send();
    }
  };

  const startOver = () => {
    setChat(emptyChat);
    setText("");
    setError("");
    setCreated(null);
  };

  const create = async () => {
    setCreating(true);
    setError("");
    try {
      const result = await createTournamentFromPlan(plan);
      if (result.failed) {
        setCreated(result.tournament);
        setError(`The tournament was created, but this step failed: ${result.failed}`);
        return;
      }
      setChat(emptyChat);
      navigate(`/organizer/${result.tournament.id}`, { state: { createdNote: result.warning || "" } });
    } catch (e) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className={cx("grid gap-4", plan && "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:items-start")}>
      <Card className="p-4 sm:p-5">
        {started ? (
          <div className="mb-3 space-y-2" aria-live="polite">
            {chat.messages.map((m, i) => <Bubble key={i} message={m} />)}
            {pending && (
              <>
                <Bubble message={{ role: "user", text: pending }} />
                <div className="flex items-center gap-2 text-xs text-ink-3">
                  <Loader2 size={13} className="animate-spin" /> Reading your message. A long list can take up to a minute.
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="mb-3">
            <div className="flex items-center gap-2 text-accent-teal">
              <Sparkles size={16} />
              <h2 className="text-base font-semibold text-ink">Tell MatchDay about your tournament</h2>
            </div>
            <p className="mt-1 text-sm text-ink-2">
              Paste your player list, rough notes, or a whole chat from ChatGPT or Claude. MatchDay makes the groups and
              matches, and you check them before anything is saved.
            </p>
          </div>
        )}

        <textarea
          className={cx(inputCls, "resize-y", started ? "min-h-[72px]" : "min-h-[170px]")}
          aria-label="Your message"
          placeholder={started ? "Anything to change? For example: move Arjun to Group B" : "Date, venue, courts, and the list of players..."}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />

        {error && <div role="alert" className="mt-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}
        {created && <Btn size="sm" variant="secondary" className="mt-2" onClick={() => navigate(`/organizer/${created.id}`)}>Open the tournament</Btn>}

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1">
            {!started && <Btn size="sm" variant="ghost" onClick={() => setText(EXAMPLE)}>Try an example</Btn>}
            {started && <Btn size="sm" variant="ghost" icon={RotateCcw} disabled={!!pending || creating} onClick={startOver}>Start over</Btn>}
            <Btn size="sm" variant="ghost" onClick={onManual}>Set up by hand</Btn>
          </div>
          <Btn icon={ArrowUp} disabled={!text.trim() || !!pending || creating} onClick={send}>Send</Btn>
        </div>
        <p className="mt-2 text-[11px] text-ink-3">What you send here goes to Claude, Anthropic&apos;s AI, so it can read it. Phone numbers aren&apos;t needed.</p>
      </Card>

      {plan && <PlanPreview plan={plan} creating={creating} onCreate={create} />}
    </div>
  );
}
