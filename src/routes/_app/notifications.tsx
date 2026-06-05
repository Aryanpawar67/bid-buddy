import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { Bell } from "lucide-react";
import {
  useNotifications,
  useMarkRead,
  useMarkAllRead,
  type Notification,
} from "@/lib/notification-queries";

export const Route = createFileRoute("/_app/notifications")({
  component: NotificationsPage,
});

type FilterType = "all" | "unread" | "stage_change" | "deadline" | "task_done" | "gonogo" | "bid_created";

const FILTERS: { key: FilterType; label: string }[] = [
  { key: "all",          label: "All" },
  { key: "unread",       label: "Unread" },
  { key: "stage_change", label: "Stage" },
  { key: "deadline",     label: "Deadlines" },
  { key: "task_done",    label: "Tasks" },
  { key: "gonogo",       label: "Go/No-Go" },
  { key: "bid_created",  label: "New Bids" },
];

const TYPE_ICON: Record<string, string> = {
  stage_change: "🔄",
  deadline:     "⚠️",
  gonogo:       "✅",
  bid_created:  "📄",
  task_done:    "☑️",
};

const TYPE_BG: Record<string, string> = {
  stage_change: "#ede9fd",
  deadline:     "#fff1f1",
  gonogo:       "#edfaf4",
  bid_created:  "#fff0e8",
  task_done:    "#f0eeff",
};

function relativeTime(dateStr: string): string {
  const diff = new Date().getTime() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function NotificationsPage() {
  const { data: notifications = [], isLoading } = useNotifications();
  const markRead = useMarkRead();
  const markAllRead = useMarkAllRead();
  const [filter, setFilter] = useState<FilterType>("all");
  const [selected, setSelected] = useState<Notification | null>(null);

  const filtered = notifications.filter((n) => {
    if (filter === "all") return true;
    if (filter === "unread") return !n.read;
    return n.type === filter;
  });

  // Auto-select first unread on load
  useEffect(() => {
    if (!selected && filtered.length > 0) {
      const first = filtered.find((n) => !n.read) ?? filtered[0];
      setSelected(first);
    }
  }, [filtered.length]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSelect(n: Notification) {
    setSelected(n);
    if (!n.read) markRead.mutate(n.id);
  }

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div className="h-full flex flex-col">
      {/* Page actions bar */}
      <div className="flex items-center gap-3 px-5 py-3 border-b hairline border-border bg-card">
        <div className="flex gap-1.5 flex-wrap">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={[
                "text-[10px] px-3 py-[4px] rounded-full border transition-colors",
                filter === f.key
                  ? "bg-primary text-white border-primary"
                  : "border-border-strong text-muted-foreground hover:bg-background",
              ].join(" ")}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {unreadCount > 0 && (
          <button
            onClick={() => markAllRead.mutate()}
            className="text-[11px] text-primary font-medium hover:underline"
          >
            Mark all read
          </button>
        )}
        <span className="text-[11px] text-muted-foreground">
          {unreadCount} unread
        </span>
      </div>

      {/* Master/Detail */}
      <div className="flex flex-1 min-h-0">

        {/* List panel */}
        <div className="w-[280px] shrink-0 border-r hairline border-border flex flex-col overflow-hidden">
          {isLoading ? (
            <div className="flex-1 flex items-center justify-center text-[12px] text-muted-foreground">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-[12px] text-muted-foreground">No notifications</div>
          ) : (
            <div className="flex-1 overflow-y-auto py-1.5">
              {filtered.map((n) => (
                <button
                  key={n.id}
                  onClick={() => handleSelect(n)}
                  className={[
                    "w-full flex gap-2.5 items-start px-3 py-2.5 text-left transition-colors border-b hairline border-border last:border-b-0",
                    selected?.id === n.id
                      ? "bg-primary/5"
                      : n.read
                        ? "bg-card hover:bg-background"
                        : "bg-primary/[0.04] hover:bg-primary/[0.07]",
                  ].join(" ")}
                >
                  <div
                    className="size-7 rounded-[7px] flex items-center justify-center text-[12px] shrink-0 mt-px"
                    style={{ background: TYPE_BG[n.type] ?? "#f5f4fa" }}
                  >
                    {TYPE_ICON[n.type] ?? "🔔"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className={`text-[11px] leading-[1.35] truncate ${n.read ? "" : "font-semibold"}`}>
                      {n.title}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {relativeTime(n.created_at)}
                    </div>
                  </div>
                  {!n.read && (
                    <div className="size-1.5 rounded-full bg-primary shrink-0 mt-[5px]" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Detail pane */}
        <div className="flex-1 flex flex-col min-w-0">
          {selected ? (
            <>
              <div className="px-6 py-4 border-b hairline border-border">
                <div className="flex items-start gap-3">
                  <div
                    className="size-9 rounded-[9px] flex items-center justify-center text-[16px] shrink-0"
                    style={{ background: TYPE_BG[selected.type] ?? "#f5f4fa" }}
                  >
                    {TYPE_ICON[selected.type] ?? "🔔"}
                  </div>
                  <div>
                    <div className="text-[15px] font-semibold leading-tight">{selected.title}</div>
                    <div className="text-[11px] text-muted-foreground mt-1">
                      {selected.type.replace(/_/g, " ")} · {relativeTime(selected.created_at)}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex-1 px-6 py-5 overflow-y-auto">
                <div className="bg-background border hairline border-border-strong rounded-xl p-4 text-[13px] text-foreground leading-relaxed max-w-[560px]">
                  {selected.body}
                </div>
                {selected.bids && (
                  <div className="mt-4 text-[12px] text-muted-foreground">
                    Bid: <span className="font-medium text-foreground">{selected.bids.title}</span>
                    {" · "}{selected.bids.client_name}
                  </div>
                )}
              </div>

              <div className="px-6 py-4 border-t hairline border-border flex items-center gap-3">
                {selected.bid_id && (
                  <Link
                    to="/bids/$id"
                    params={{ id: selected.bid_id }}
                    className="h-8 px-4 rounded-md bg-primary text-primary-foreground text-[12px] font-medium inline-flex items-center gap-1.5 hover:opacity-90"
                  >
                    View Bid →
                  </Link>
                )}
                {!selected.read && (
                  <button
                    onClick={() => markRead.mutate(selected.id)}
                    className="h-8 px-4 rounded-md border hairline border-border-strong text-[12px] text-muted-foreground hover:bg-background"
                  >
                    Dismiss
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 text-muted-foreground">
              <Bell className="size-10 opacity-20" strokeWidth={1} />
              <div className="text-[13px]">Select a notification to read it</div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
