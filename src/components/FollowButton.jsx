import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Heart } from "lucide-react";
import { cx } from "../lib/engines";
import { isFollowing, followSubject, unfollowSubject, getFollowerCount } from "../lib/repository";
import { useAuth } from "../lib/AuthContext";

/* Follow a player or a tournament.

   Deliberately the whole of the "social" surface: there is no feed, no
   follower list, no mutual-follow concept. Following a tournament means "keep
   this on my dashboard"; following a player means "I want to find them again".
   The count is an aggregate from a SECURITY DEFINER function, so a page can
   show how many people follow something without ever being able to enumerate
   who they are (migration 012).

   Signed-out visitors see the count and a prompt to sign in rather than a
   button that fails — following requires an account by design, since the row
   is keyed on a user id. */

export default function FollowButton({
  subjectType, subjectId, size = "md", showCount = true, className,
}) {
  const { caps } = useAuth();
  const signedIn = !!caps?.signedIn;

  const [following, setFollowing] = useState(false);
  const [count, setCount] = useState(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!subjectId) return undefined;
    (async () => {
      const [f, c] = await Promise.all([
        signedIn ? isFollowing(subjectType, subjectId).catch(() => false) : Promise.resolve(false),
        showCount ? getFollowerCount(subjectType, subjectId).catch(() => null) : Promise.resolve(null),
      ]);
      if (cancelled) return;
      setFollowing(f);
      setCount(c);
      setReady(true);
    })();
    return () => { cancelled = true; };
  }, [subjectType, subjectId, signedIn, showCount]);

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    // Optimistic, but the count moves with it so the two never disagree
    // on screen; both roll back together if the write fails.
    const prev = following;
    setFollowing(!prev);
    setCount((c) => (c === null ? c : Math.max(0, c + (prev ? -1 : 1))));
    try {
      if (prev) await unfollowSubject(subjectType, subjectId);
      else await followSubject(subjectType, subjectId);
    } catch {
      setFollowing(prev);
      setCount((c) => (c === null ? c : Math.max(0, c + (prev ? 1 : -1))));
    } finally { setBusy(false); }
  };

  const sizing = size === "sm"
    ? "px-2.5 py-1 text-[11px] gap-1"
    : "px-3 py-1.5 text-xs gap-1.5";

  const countLabel = showCount && count !== null
    ? <span className="tabular-nums opacity-80">{count}</span>
    : null;

  if (!signedIn) {
    return (
      <Link
        to="/signin"
        className={cx(
          "inline-flex items-center rounded-md border border-line bg-surface-2 font-medium text-ink-2 transition-colors hover:border-accent-teal/40 hover:text-ink",
          sizing, className
        )}
        title={`Sign in to follow this ${subjectType.toLowerCase()}`}
      >
        <Heart size={size === "sm" ? 11 : 13} /> Follow {countLabel}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy || !ready}
      aria-pressed={following}
      className={cx(
        "inline-flex items-center rounded-md border font-medium transition-colors disabled:opacity-60",
        following
          ? "border-accent-teal/40 bg-accent-teal/10 text-accent-teal hover:bg-accent-teal/15"
          : "border-line bg-surface-2 text-ink-2 hover:border-accent-teal/40 hover:text-ink",
        sizing, className
      )}
    >
      {following ? <Heart size={size === "sm" ? 11 : 13} fill="currentColor" /> : <Heart size={size === "sm" ? 11 : 13} />}
      {following ? "Following" : "Follow"} {countLabel}
    </button>
  );
}

// Companion for a "you follow this" indicator where a button would be noise.
export function FollowingBadge({ className }) {
  return (
    <span className={cx("inline-flex items-center gap-1 text-[11px] text-accent-teal", className)}>
      <Heart size={10} fill="currentColor" /> Following
    </span>
  );
}
