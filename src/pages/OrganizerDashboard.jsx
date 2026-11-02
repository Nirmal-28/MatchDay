import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronDown, Plus, MapPin, Calendar, Layers } from "lucide-react";
import { fmtDate, fmtDateRange, TOURNAMENT_STATUS_META } from "../lib/engines";
import { listMyTournaments, createTournament, publishTournament, listMySeries, createSeries } from "../lib/repository";
import { Btn, Badge, Card, Field, inputCls, useToasts, Toasts } from "../components/ui/primitives";
import { BrandLoader, Reveal, StaggerList, StaggerItem } from "../components/ui/motion";
import { StatusPill, sportAccent } from "../components/ui/md";
import { MaskText } from "../components/ui/reveal";
import AssistantChat from "../components/AssistantChat";
import CreateTournamentWizard from "../components/CreateTournamentWizard";
import { useDocumentMeta } from "../lib/useDocumentMeta";

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

  // During a tournament the organizer has come back to run it, not to start
  // another one, so a live tournament goes above the chat box.
  const hasLive = tournaments.some((t) => t.status === "LIVE");

  const list = tournaments.length > 0 && (
    <div className={hasLive ? "mb-6" : "mt-8"}>
      <h2 className="md-display md-rule mb-2 text-xl text-ink">Your tournaments</h2>
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
    </div>
  );

  return (
    <div>
      <Reveal className="mb-5">
        <div className="md-eyebrow mb-1 text-accent-teal">Organize</div>
        <MaskText as="h1" className="md-display md-h2 text-ink" lines={["Run your", "tournament"]} />
      </Reveal>
      {hasLive && list}
      <AssistantChat onManual={() => setWizardOpen(true)} />
      {!hasLive && list}
      {/* Series — recurring competition built from ordinary tournaments. */}
      <details className="group mt-8" open={series?.length > 0 || undefined}>
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-semibold text-ink-2 hover:text-ink">
          <Layers size={15} /> Series
          <ChevronDown size={14} className="transition-transform group-open:rotate-180" />
        </summary>
        <div className="mb-2 mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-ink-2">Group tournaments into matchdays with standings that carry across them.</p>
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
      </details>

      <CreateTournamentWizard open={wizardOpen} onClose={() => setWizardOpen(false)} onSubmit={handleCreate} />
      <Toasts toasts={toasts} />
    </div>
  );
}
