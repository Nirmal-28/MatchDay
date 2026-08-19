import { useState } from "react";
import { Bell } from "lucide-react";
import { timeAgo } from "../lib/engines";

export default function NotificationBell({ notifications, onMarkRead }) {
  const [open, setOpen] = useState(false);
  const unread = notifications.filter((n) => !n.read).length;
  return (
    <div className="relative">
      <button className="relative rounded-md p-2 text-stone-500 hover:bg-stone-100" onClick={() => { setOpen(!open); if (!open) onMarkRead(); }}>
        <Bell size={17} />
        {unread > 0 && <span className="absolute right-1 top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-600 text-[9px] font-bold text-white">{unread}</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-80 rounded-lg border border-stone-200 bg-white shadow-lg">
            <div className="border-b border-stone-100 px-3.5 py-2.5 text-xs font-semibold uppercase tracking-wide text-stone-500">Notifications</div>
            <div className="max-h-80 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="px-3.5 py-6 text-center text-xs text-stone-400">Nothing yet</div>
              ) : notifications.slice(0, 20).map((n) => (
                <div key={n.id} className="border-b border-stone-50 px-3.5 py-2.5 text-sm text-stone-700 last:border-0">
                  {n.message}
                  <div className="mt-0.5 text-[11px] text-stone-400">{timeAgo(n.created_at)}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
