import { useRouterState } from "@tanstack/react-router";
import { Search, Plus, Clock, User, Info, MessageSquare } from "lucide-react";
import { useState } from "react";
import { IntakeModal } from "@/components/bids/IntakeModal";
import { useCurrentUser } from "@/lib/auth";

type PageMeta = { title: string; subtitle: string };

const PAGE_META: Record<string, PageMeta> = {
  dashboard:     { title: "Dashboard",            subtitle: "Overview of all your pursuits and tasks" },
  pipeline:      { title: "Pursuits",             subtitle: "All active bids across pipeline stages" },
  queue:         { title: "My Queue",             subtitle: "Your assigned questions and deliverables" },
  analytics:     { title: "Reports & Analytics",  subtitle: "Pipeline metrics and win rate trends" },
  docs:          { title: "Knowledge Hub",         subtitle: "Bid documents and templates" },
  ai:            { title: "RFx Generator",          subtitle: "AI-powered pursuit assistance" },
  calendar:      { title: "Calendar",             subtitle: "Deadlines and key dates" },
  notifications: { title: "Notifications",        subtitle: "Activity and alerts" },
  settings:      { title: "Settings",             subtitle: "Workspace configuration" },
  bids:          { title: "Bid Detail",           subtitle: "Stage workspace and deliverables" },
};

function usePageMeta(): PageMeta {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const seg = path.split("/").filter(Boolean)[0] ?? "dashboard";
  return PAGE_META[seg] ?? { title: seg, subtitle: "" };
}

export function TopBar() {
  const { title, subtitle } = usePageMeta();
  const [open, setOpen] = useState(false);
  const { isPreSales } = useCurrentUser();

  return (
    <header className="h-[52px] min-h-[52px] shrink-0 bg-card border-b hairline border-border-strong flex items-center px-5 gap-3">
      <div className="shrink-0">
        <div className="text-[16px] font-semibold leading-tight">{title}</div>
        {subtitle && (
          <div className="text-[11px] text-muted-foreground leading-tight mt-px">
            {subtitle}
          </div>
        )}
      </div>

      <div className="ml-5 flex-1 max-w-[360px] h-[34px] bg-background border hairline border-border-strong rounded-[8px] flex items-center px-2.5 gap-1.5 text-muted-foreground text-[12px]">
        <Search className="size-3.5 shrink-0" strokeWidth={1.75} />
        <span>Search pursuits, clients, tasks…</span>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-1.5">
        <IconBtn icon={Clock} title="Recent activity" />
        <IconBtn icon={User} title="Profile" badge={12} />
        <IconBtn icon={Info} title="Help" />
        <IconBtn icon={MessageSquare} title="Messages" badge={3} />
      </div>

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

function IconBtn({
  icon: Icon,
  title,
  badge,
}: {
  icon: React.ElementType;
  title: string;
  badge?: number;
}) {
  return (
    <button
      title={title}
      className="size-[34px] rounded-[8px] border hairline border-border-strong bg-card flex items-center justify-center text-muted-foreground hover:bg-background relative"
    >
      <Icon className="size-4" strokeWidth={1.5} />
      {badge !== undefined && (
        <span className="absolute top-[5px] right-[5px] min-w-[14px] h-[14px] bg-accent text-white text-[8px] font-bold rounded-full flex items-center justify-center px-[3px] border border-white">
          {badge}
        </span>
      )}
    </button>
  );
}
