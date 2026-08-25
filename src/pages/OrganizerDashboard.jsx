import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Trophy, MapPin, Calendar, Layers, Users, Radio } from "lucide-react";
import { fmtDate, fmtDateRange, TOURNAMENT_STATUS_META } from "../lib/engines";
import { listMyTournaments, createTournament, publishTournament, listMySeries, createSeries } from "../lib/repository";
import { Btn, Badge, Card, Field, inputCls, useToasts, Toasts } from "../components/ui/primitives";
import { BrandLoader, Reveal, StaggerList, StaggerItem } from "../components/ui/motion";
import { StatusPill, sportAccent } from "../components/ui/md";
import { MaskText } from "../components/ui/reveal";
import CreateTournamentWizard from "../components/CreateTournamentWizard";
import { useDocumentMeta } from "../lib/useDocumentMeta";

// What a first-time organizer sees instead of an empty list.
//
// A bare "nothing here yet" card told someone what was absent, not what to do
// or what they were about to commit to. This lays out the whole path before
// they start — the point being that step one is small and the rest is the app
// doing the work, which is exactly the worry that stops a club secretary
// moving off a spreadsheet.
const FIRST_RUN_STEPS = [
  { icon: Layers, title: "Set it up", body: "Name, dates, venue, and your categories. A few minutes in the wizard — nothing is public until you publish it." },
  { icon: Users, title: "Take entries", body: "Share one link. Players register themselves and the window closes on the date you set." },
  { icon: Trophy, title: "Seed and draw", body: "Set seeds; the bracket, byes and progression are generated. Then assign courts and times with clashes flagged." },
  { icon: Radio, title: "Run the day", body: "Score from a phone at the net post. Players, the public page and the venue screen all update live." },
];

function FirstRun({ onCreate }) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-line p-5 sm:p-6">
        <h2 className="text-lg font-bold text-ink">Run your first tournament</h2>
        <p className="mt-1 max-w-xl text-sm text-ink-2">
          Creating one makes you the organizer of that tournament. It does not change your account
          or affect the tournaments you play in — roles stay per-tournament.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Btn icon={Plus} onClick={onCreate}>Create tournament</Btn>
          <Link to="/host"><Btn variant="secondary">See what it can do</Btn></Link>
        </div>
      </div>

      <ol className="grid divide-y divide-line sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4">
        {FIRST_RUN_STEPS.map((s, i) => (
          <li key={s.title} className="p-4 sm:border-r sm:border-line sm:last:border-r-0">
            <div className="flex items-center gap-2">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-accent-teal/10 text-[11px] font-bold text-accent-teal">
                {i + 1}
              </span>
              <s.icon size={15} className="text-ink-3" />
            </div>
            <div className="mt-2 text-sm font-semibold text-ink">{s.title}</div>
            <p className="mt-0.5 text-[12px] leading-snug text-ink-2">{s.body}</p>
          </li>
        ))}
      </ol>
    </Card>
  );
}

export default function OrganizerDashboard() {
  const [tournaments, setTournaments] = useState(null);
  useDocumentMeta({ title: "Your tournaments" });
  const [wizardOpen, setWizardOpen] = useState(false);
  const [series, setSeries] = useState(null);
  const [seriesOpen, setSeriesOpen] = useState(false);
  const [seriesName, setSeriesName] = useState("");
  const [seriesDesc, setSeriesDesc] = useState("");
  const { toasts, notify } = useToasts();
  const navigate = useNavigate();

  const refresh = () => listMyTournaments().then(setTournaments);
  useEffect(() => { refresh(); listMySeries().then(setSeries).catch(() => setSeries([])); }, []);

  const handleCreate = async ({ basics, categories, settings, publish, sport }) => {
    const t = await createTournament({
      name: basics.name,
      description: basics.description,
      organizer_name: basics.organizerName,
      venue: basics.venue,
      location: basics.location,
      start_date: basics.startDate,
      end_date: basics.endDate,
      registration_deadline: basics.registrationDeadline || null,
      contact_email: basics.contactEmail,
      contact_phone: basics.contactPhone,
      sport: sport || "badminton",
    }, categories, settings);
    if (publish) {
      const slugBase = basics.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      await publishTournament(t.id, slugBase);
    }
    notify("Tournament created.");
    navigate(`/organizer/${t.id}`);
  };

  if (!tournaments) return <BrandLoader />;

  return (
    <div>
      <Reveal className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="md-eyebrow mb-1 text-accent-teal">Organize</div>
          <MaskText as="h1" className="md-display md-h2 text-ink" lines={["Tournaments", "I organize"]} />
          <p className="mt-0.5 text-sm text-ink-2">
            Tournaments you own or help run. Your player profile is unaffected — it&apos;s the same account.
          </p>
        </div>
        <Btn icon={Plus} onClick={() => setWizardOpen(true)}>Create tournament</Btn>
      </Reveal>
      {tournaments.length === 0 ? (
        <FirstRun onCreate={() => setWizardOpen(true)} />
      ) : (
        <StaggerList className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tournaments.map((t) => (
            <StaggerItem key={t.id}>
              {/* The same card language discovery uses, with the sport's
                  accent on the leading court line — an organizer running
                  events in two sports can tell them apart at a glance. */}
              <button
                onClick={() => navigate(`/organizer/${t.id}`)}
                className="md-card md-card-link md-edge h-full w-full p-4 pl-5 text-left"
                style={{ "--md-edge": t.status === "LIVE" ? "var(--color-live)" : sportAccent(t.sport) }}
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="md-display md-clamp-2 text-xl text-ink">{t.name}</div>
                  {t.status === "LIVE"
                    ? <StatusPill status="live" />
                    : <Badge tone={TOURNAMENT_STATUS_META[t.status].tone}>{TOURNAMENT_STATUS_META[t.status].label}</Badge>}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-2">
                  <span className="flex items-center gap-1"><MapPin size={11} />{t.venue}</span>
                  <span className="flex items-center gap-1"><Calendar size={11} />{fmtDateRange(t.start_date, t.end_date)}</span>
                </div>
              </button>
            </StaggerItem>
          ))}
        </StaggerList>
      )}
      {/* Series — recurring competition built from ordinary tournaments. */}
      <Reveal className="mt-8">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="md-display md-rule flex items-center gap-2 text-xl text-ink"><Layers size={17} /> Series</h2>
            <p className="text-xs text-ink-2">Group tournaments into matchdays with standings that carry across them.</p>
          </div>
          <Btn size="sm" variant="secondary" icon={Plus} onClick={() => setSeriesOpen((o) => !o)}>New series</Btn>
        </div>

        {seriesOpen && (
          <Card className="mb-2 space-y-2 p-4">
            <Field label="Series name" required>
              <input className={inputCls} placeholder="Summer League 2026" value={seriesName}
                onChange={(e) => setSeriesName(e.target.value)} />
            </Field>
            <Field label="Description">
              <input className={inputCls} placeholder="Six matchdays, standings across all of them."
                value={seriesDesc} onChange={(e) => setSeriesDesc(e.target.value)} />
            </Field>
            <div className="flex gap-2">
              <Btn size="sm" disabled={!seriesName.trim()} onClick={async () => {
                try {
                  const s = await createSeries({ name: seriesName.trim(), description: seriesDesc.trim() });
                  setSeriesOpen(false); setSeriesName(""); setSeriesDesc("");
                  navigate(`/series/${s.id}`);
                } catch (e) { notify(e.message, "error"); }
              }}>Create series</Btn>
              <Btn size="sm" variant="ghost" onClick={() => setSeriesOpen(false)}>Cancel</Btn>
            </div>
          </Card>
        )}

        {series === null ? null : series.length === 0 ? (
          <Card className="px-4 py-5 text-center text-sm text-ink-3">
            No series yet. A series is just an ordered set of your existing tournaments — nothing about them changes.
          </Card>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {series.map((s) => (
              <Link key={s.id} to={`/series/${s.id}`} className="block">
                {/* Purple is the series accent throughout the product, so a
                    circuit never reads as just another tournament. */}
                <div
                  className="md-card md-card-link md-edge h-full p-3.5 pl-5"
                  style={{ "--md-edge": "var(--color-accent-purple)" }}
                >
                  <div className="md-display text-lg text-ink">{s.name}</div>
                  {s.description && <p className="mt-0.5 line-clamp-2 text-xs text-ink-2">{s.description}</p>}
                  <div className="md-eyebrow mt-1.5">Created {fmtDate(s.created_at)}</div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Reveal>

      <CreateTournamentWizard open={wizardOpen} onClose={() => setWizardOpen(false)} onSubmit={handleCreate} />
      <Toasts toasts={toasts} />
    </div>
  );
}
