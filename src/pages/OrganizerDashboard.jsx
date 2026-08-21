import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Trophy, MapPin, Calendar } from "lucide-react";
import { fmtDateRange, TOURNAMENT_STATUS_META } from "../lib/engines";
import { listMyTournaments, createTournament, publishTournament } from "../lib/repository";
import { Btn, Badge, Eyebrow, EmptyState, useToasts, Toasts } from "../components/ui/primitives";
import { BrandLoader, Reveal, StaggerList, StaggerItem } from "../components/ui/motion";
import CreateTournamentWizard from "../components/CreateTournamentWizard";

export default function OrganizerDashboard() {
  const [tournaments, setTournaments] = useState(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const { toasts, notify } = useToasts();
  const navigate = useNavigate();

  const refresh = () => listMyTournaments().then(setTournaments);
  useEffect(() => { refresh(); }, []);

  const handleCreate = async ({ basics, categories, settings, publish }) => {
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
      <Reveal className="mb-5 flex items-center justify-between">
        <div>
          <Eyebrow>Organizer</Eyebrow>
          <h1 className="text-2xl font-bold text-ink">Command center</h1>
        </div>
        <Btn icon={Plus} onClick={() => setWizardOpen(true)}>Create tournament</Btn>
      </Reveal>
      {tournaments.length === 0 ? (
        <EmptyState icon={Trophy} title="Your next match starts here" hint="Create your first tournament to start registration, draws and live scoring." action={<Btn size="sm" icon={Plus} className="mt-2" onClick={() => setWizardOpen(true)}>Create tournament</Btn>} />
      ) : (
        <StaggerList className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tournaments.map((t) => (
            <StaggerItem key={t.id}>
              <button onClick={() => navigate(`/organizer/${t.id}`)} className="w-full rounded-lg border border-line bg-surface p-4 text-left shadow-sm transition-all hover:border-accent-teal/50 hover:shadow-md">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="font-semibold text-ink">{t.name}</div>
                  <Badge tone={TOURNAMENT_STATUS_META[t.status].tone}>{TOURNAMENT_STATUS_META[t.status].label}</Badge>
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
      <CreateTournamentWizard open={wizardOpen} onClose={() => setWizardOpen(false)} onSubmit={handleCreate} />
      <Toasts toasts={toasts} />
    </div>
  );
}
