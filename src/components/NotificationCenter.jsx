import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Bell, CheckCheck } from "lucide-react";
import { cx, timeAgo, fmtDateTime, notificationMeta, isUrgentNotification, NOTIFICATION_GROUPS, TONE_CLASSES } from "../lib/engines";
import {
  listMyNotifications, countMyUnreadNotifications, markNotificationRead,
  markAllNotificationsRead, subscribeToMyNotifications,
} from "../lib/repository";
import { CHANNELS } from "../lib/notifications/channels";

// The signed-in user's notification inbox — the same component serves a
// player ("your match moved to Court 3") and an organizer ("3 registrations
// confirmed"), because both are just rows targeted at a user id.
//
// Rows are persistent database records written by triggers, not toasts: they
// survive a reload, and they arrive whether or not the relevant screen was
// open when the change happened.
export default function NotificationCenter({ userId }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [showDelivery, setShowDelivery] = useState(false);
  const [group, setGroup] = useState("ALL");

  const refresh = useCallback(async () => {
    try {
      const [list, count] = await Promise.all([listMyNotifications(50), countMyUnreadNotifications()]);
      setItems(list);
      setUnread(count);
    } catch {
      // A signed-out or mid-refresh session shouldn't break the header.
    }
  }, []);

  useEffect(() => { if (userId) refresh(); }, [userId, refresh]);

  useEffect(() => {
    if (!userId) return;
    return subscribeToMyNotifications(userId, refresh);
  }, [userId, refresh]);

  if (!userId) return null;

  const markAll = async () => {
    await markAllNotificationsRead();
    setItems((n) => n.map((x) => ({ ...x, read: true })));
    setUnread(0);
  };

  const openItem = async (n) => {
    if (!n.read) {
      await markNotificationRead(n.id);
      setItems((list) => list.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      setUnread((u) => Math.max(0, u - 1));
    }
    setOpen(false);
  };

  const connected = CHANNELS.filter((c) => c.isConnected()).map((c) => c.label);
  const pending = CHANNELS.filter((c) => !c.isConnected());

  const urgentCount = items.filter(isUrgentNotification).length;

  // Unread urgent items float to the top regardless of age — a court change
  // from 20 minutes ago matters more than a result from 20 seconds ago.
  const visible = items
    .filter((n) => group === "ALL" || (group === "URGENT" ? isUrgentNotification(n) : notificationMeta(n.type).group === group))
    .sort((a, b) => (isUrgentNotification(b) ? 1 : 0) - (isUrgentNotification(a) ? 1 : 0)
      || (b.created_at || "").localeCompare(a.created_at || ""));

  return (
    <div className="relative">
      <button
        className="relative rounded-md p-2 text-ink-2 hover:bg-surface-2 hover:text-ink"
        onClick={() => setOpen((o) => !o)}
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
      >
        <Bell size={17} />
        {unread > 0 && (
          <span className="absolute right-0.5 top-0.5 flex min-w-[16px] items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-bold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-[min(92vw,22rem)] overflow-hidden rounded-lg border border-line bg-surface shadow-2xl">
            <div className="flex items-center justify-between border-b border-line-soft px-3.5 py-2.5">
              <span className="md-eyebrow">Notifications</span>
              {unread > 0 && (
                <button className="flex items-center gap-1 text-[11px] font-medium text-accent-teal hover:underline" onClick={markAll}>
                  <CheckCheck size={12} /> Mark all read
                </button>
              )}
            </div>

            {/* Category filter. Scrolls horizontally so it stays usable on a phone. */}
            <div className="flex gap-1 overflow-x-auto border-b border-line-soft px-2 py-1.5">
              {NOTIFICATION_GROUPS.map((g) => (
                <button
                  key={g.key} onClick={() => setGroup(g.key)}
                  className={cx(
                    "flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors",
                    group === g.key ? "bg-accent-teal/15 text-accent-teal" : "text-ink-3 hover:text-ink-2"
                  )}
                >
                  {g.label}
                  {g.key === "URGENT" && urgentCount > 0 && (
                    <span className="ml-1 rounded-full bg-red-500/20 px-1 text-[9px] font-bold text-red-300">{urgentCount}</span>
                  )}
                </button>
              ))}
            </div>

            <div className="max-h-[22rem] overflow-y-auto">
              {visible.length === 0 ? (
                <div className="px-3.5 py-8 text-center text-xs text-ink-3">
                  {items.length === 0
                    ? "Nothing yet. Registration updates, schedule changes and results will show up here."
                    : "Nothing in this category."}
                </div>
              ) : visible.map((n) => {
                const meta = notificationMeta(n.type);
                const urgent = isUrgentNotification(n);
                const body = (
                  <>
                    <div className="flex items-center gap-1.5">
                      <span className={cx("rounded border px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide", TONE_CLASSES[meta.tone])}>
                        {meta.label}
                      </span>
                      {urgent && (
                        <span className="rounded border border-red-400/40 bg-red-400/10 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-red-300">
                          Urgent
                        </span>
                      )}
                      {!n.read && <span className="h-1.5 w-1.5 rounded-full bg-accent-teal" />}
                      <span className="ml-auto text-[10px] text-ink-3" title={fmtDateTime(n.created_at)}>{timeAgo(n.created_at)}</span>
                    </div>
                    {n.title && <div className="mt-1 text-sm font-semibold text-ink">{n.title}</div>}
                    <div className="text-xs text-ink-2">{n.message}</div>
                    {n.tournaments?.name && <div className="mt-0.5 text-[10px] text-ink-3">{n.tournaments.name}</div>}
                  </>
                );
                const cls = cx(
                  "block w-full border-b border-line-soft px-3.5 py-2.5 text-left last:border-0",
                  urgent ? "bg-red-500/[0.07] hover:bg-red-500/10"
                    : n.read ? "hover:bg-surface-2" : "bg-accent-teal/[0.06] hover:bg-accent-teal/10"
                );
                return n.link ? (
                  <Link key={n.id} to={n.link} className={cls} onClick={() => openItem(n)}>{body}</Link>
                ) : (
                  <button key={n.id} className={cls} onClick={() => openItem(n)}>{body}</button>
                );
              })}
            </div>

            {/* Says plainly where these actually reach the user. No channel is
                implied to be live when it isn't. */}
            <div className="border-t border-line-soft px-3.5 py-2">
              <button className="text-[10px] text-ink-3 hover:text-ink-2" onClick={() => setShowDelivery((s) => !s)}>
                Delivered via {connected.join(", ")} · {showDelivery ? "hide" : "other channels"}
              </button>
              {showDelivery && (
                <ul className="mt-1.5 space-y-1">
                  {pending.map((c) => (
                    <li key={c.key} className="text-[10px] leading-snug text-ink-3">
                      <span className="font-medium text-ink-2">{c.label}</span> — not connected. Needs {c.requirement}.
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
