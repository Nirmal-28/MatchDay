import { Link } from "react-router-dom";
import { Compass, SearchX } from "lucide-react";
import { Btn, Card } from "../components/ui/primitives";

// Any URL that matches no route. Previously these rendered nothing at all —
// the header and nav appeared, the page body was simply empty, which reads as
// a broken app rather than a wrong address. This is most likely to be hit by
// a shared link to a tournament that was deleted or never published.
export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-14">
      <Card className="p-7 text-center">
        <SearchX className="mx-auto mb-3 text-ink-3" size={32} />
        <h1 className="text-lg font-semibold text-ink">Page not found</h1>
        <p className="mt-1.5 text-sm text-ink-2">
          This address does not match anything on MatchDay. If you followed a link to a
          tournament, it may have been unpublished or removed by its organizer.
        </p>
        <Link to="/" className="mt-5 inline-block">
          <Btn icon={Compass}>Browse tournaments</Btn>
        </Link>
      </Card>
    </div>
  );
}
