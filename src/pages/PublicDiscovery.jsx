import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Trophy, MapPin, Calendar, Radio } from "lucide-react";
import { fmtDateRange, TOURNAMENT_STATUS_META } from "../lib/engines";
import { listPublishedTournaments } from "../lib/repository";
import { Badge, Eyebrow, EmptyState } from "../components/ui/primitives";

export default function PublicDiscovery() {
  const [tournaments, setTournaments] = useState(null);

  useEffect(() => {
    let cancelled = false;
    listPublishedTournaments().then((t) => { if (!cancelled) setTournaments(t); });
    return () => { cancelled = true; };
  }, []);

  if (!tournaments) return <div className="py-14 text-center text-sm text-stone-400">Loading…</div>;

  return (
    <div>
      <div className="mb-6">
        <Eyebrow>Matchday</Eyebrow>
        <h1 className="text-2xl font-bold text-stone-900">Find a tournament</h1>
        <p className="mt-1 text-sm text-stone-500">Browse live and upcoming badminton tournaments — no account needed to follow along.</p>
      </div>
      {tournaments.length === 0 ? (
        <EmptyState icon={Trophy} title="No tournaments published yet" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tournaments.map((t) => (
            <Link key={t.id} to={`/t/${t.slug}`} className="rounded-lg border border-stone-200 bg-white p-4 text-left shadow-sm transition-all hover:border-teal-300 hover:shadow-md">
              <div className="mb-2 flex items-start justify-between gap-2">
                <div className="font-semibold text-stone-900">{t.name}</div>
                <Badge tone={TOURNAMENT_STATUS_META[t.status].tone}>{t.status === "LIVE" ? <><Radio size={10} className="animate-pulse" /> Live</> : TOURNAMENT_STATUS_META[t.status].label}</Badge>
              </div>
              <p className="mb-2 truncate text-xs text-stone-500">{t.description}</p>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-stone-500">
                <span className="flex items-center gap-1"><MapPin size={11} />{t.location || t.venue}</span>
                <span className="flex items-center gap-1"><Calendar size={11} />{fmtDateRange(t.start_date, t.end_date)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
