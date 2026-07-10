import { useRouterState } from "@tanstack/react-router";
import { Search, Plus, Settings2 } from "lucide-react";
import { useState } from "react";
import { IntakeModal } from "@/components/bids/IntakeModal";
import { useCurrentUser } from "@/lib/auth";
import { useAiConfigure } from "@/lib/ai-configure-context";

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
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);
  const { isPreSales, isAdmin } = useCurrentUser();
  const { setOpen: setConfigureOpen } = useAiConfigure();
  const isAiPage = path.startsWith("/ai");

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

      {isAiPage && isAdmin && (
        <button
          onClick={() => setConfigureOpen(true)}
          title="Configure RFx Responder"
          className="h-8 px-3 rounded-md border hairline border-border text-muted-foreground text-[12px] font-medium inline-flex items-center gap-1.5 hover:bg-background hover:text-foreground transition-colors"
        >
          <Settings2 className="size-3.5" /> Configure
        </button>
      )}

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

