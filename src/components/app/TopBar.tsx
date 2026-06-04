import { Link, useRouterState } from "@tanstack/react-router";
import { Bell, Search, Plus } from "lucide-react";
import { useState } from "react";
import { IntakeModal } from "@/components/bids/IntakeModal";
import { useCurrentUser } from "@/lib/auth";

function useCrumbs(): { label: string; to?: string }[] {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const segments = path.split("/").filter(Boolean);
  const map: Record<string, string> = {
    dashboard: "Pipeline",
    queue: "My queue",
    analytics: "Analytics",
    docs: "Documents",
    hubspot: "HubSpot sync",
    settings: "Settings",
    bids: "Pipeline",
    gonogo: "Go / No-Go",
  };
  const crumbs: { label: string; to?: string }[] = [{ label: "BidTrack", to: "/dashboard" }];
  if (segments[0]) crumbs.push({ label: map[segments[0]] ?? segments[0] });
  return crumbs;
}

export function TopBar() {
  const crumbs = useCrumbs();
  const [open, setOpen] = useState(false);
  const { isPreSales } = useCurrentUser();
  return (
    <header className="h-11 shrink-0 bg-card hairline border-b flex items-center px-4 gap-3">
      <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
        {crumbs.map((c, i) => (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-border-strong">/</span>}
            {c.to ? (
              <Link to={c.to} className="hover:text-foreground">
                {c.label}
              </Link>
            ) : (
              <span className="text-foreground font-medium">{c.label}</span>
            )}
          </span>
        ))}
      </div>
      <div className="flex-1" />
      <button className="size-8 rounded-md hover:bg-muted flex items-center justify-center text-muted-foreground">
        <Search className="size-4" strokeWidth={1.75} />
      </button>
      <button className="size-8 rounded-md hover:bg-muted flex items-center justify-center text-muted-foreground relative">
        <Bell className="size-4" strokeWidth={1.75} />
        <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-accent" />
      </button>
      {isPreSales && (
        <button
          onClick={() => setOpen(true)}
          className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-[12px] font-medium inline-flex items-center gap-1.5 hover:opacity-90"
        >
          <Plus className="size-3.5" /> New bid
        </button>
      )}
      <IntakeModal open={open} onOpenChange={setOpen} />
    </header>
  );
}
