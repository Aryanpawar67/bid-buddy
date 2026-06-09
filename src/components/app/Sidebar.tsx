import { Link, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import {
  LayoutDashboard,
  Target,
  CheckSquare,
  Sparkles,
  BookOpen,
  BarChart3,
  Calendar,
  Settings,
  Bell,
  LogOut,
  ChevronDown,
} from "lucide-react";
import { useCurrentUser } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { initials, STAGES } from "@/lib/bid-constants";
import { useBids, useMyQueue } from "@/lib/bid-queries";
import { useNotificationCount } from "@/lib/notification-queries";

export function Sidebar() {
  const { primaryRole, profile, user } = useCurrentUser();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [pursuitsOpen, setPursuitsOpen] = useState(true);

  const { data: bids = [] } = useBids();
  const { data: queueData } = useMyQueue(user?.id);
  const { data: notifCount = 0 } = useNotificationCount();

  const activeBids = bids.filter((b) => b.status === "active");

  const queueCount = [
    ...(queueData?.questions ?? []),
    ...(queueData?.deliverables ?? []),
  ].filter((i) => i.status !== "done").length;

  const isAdmin = primaryRole === "admin";
  const isPreSales = primaryRole === "pre_sales";
  const canSeePipeline = isAdmin || isPreSales;
  const canSeeAnalytics = isAdmin || isPreSales;

  return (
    <aside className="w-[220px] min-w-[220px] shrink-0 bg-sidebar flex flex-col overflow-y-auto overflow-x-hidden">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-3.5 py-4 border-b border-white/[0.08]">
        <Link to="/dashboard" className="size-8 rounded-[8px] shrink-0 overflow-hidden">
          <img src="/favicon.jpg" alt="Bid Compass" className="size-full object-cover" />
        </Link>
        <div>
          <div className="text-[13px] font-semibold text-white leading-tight">
            Bid Compass
          </div>
          <div className="text-[10px] text-white/40 mt-px">
            Pursuit Management
          </div>
        </div>
      </div>

      {/* Nav */}
      <div className="py-2 flex-1">
        <NavLink to="/dashboard" icon={LayoutDashboard} label="Dashboard" active={path === "/dashboard"} />

        {canSeePipeline && (
          <>
            <button
              onClick={() => setPursuitsOpen((o) => !o)}
              className="w-[calc(100%-12px)] mx-1.5 flex items-center gap-[9px] px-[14px] py-[7px] rounded-[6px] text-[12px] text-white/50 hover:bg-white/10 hover:text-white/85 transition-colors"
            >
              <Target className="size-4 shrink-0 opacity-75" strokeWidth={1.5} />
              <span className="flex-1 truncate text-left">Pursuits</span>
              <span className="text-[10px] text-white/35 mr-1">
                {activeBids.length}
              </span>
              <ChevronDown
                className={`size-3.5 text-white/30 transition-transform ${pursuitsOpen ? "" : "-rotate-90"}`}
                strokeWidth={1.5}
              />
            </button>

            {pursuitsOpen && (
              <div className="mb-1">
                {STAGES.map((s, i) => {
                  const count = activeBids.filter(
                    (b) => b.stage === s.key,
                  ).length;
                  return (
                    <Link
                      key={s.key}
                      to="/pipeline"
                      className="flex items-center gap-2 py-[5px] pl-[38px] pr-[14px] mx-1.5 rounded-[4px] text-[11px] text-white/38 hover:bg-white/10 hover:text-white/70 transition-colors"
                    >
                      <span className="size-4 rounded-full bg-white/[0.08] flex items-center justify-center text-[9px] text-white/50 shrink-0 font-medium">
                        {i + 1}
                      </span>
                      <span className="flex-1 truncate">{s.label}</span>
                      <span className="text-[10px] text-white/28">{count}</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </>
        )}

        <SectionLabel>Tools</SectionLabel>
        <NavLink
          to="/queue"
          icon={CheckSquare}
          label="My Queue"
          active={path.startsWith("/queue")}
          badge={queueCount > 0 ? queueCount : undefined}
          badgeVariant="accent"
        />
        <NavLink
          to="/ai"
          icon={Sparkles}
          label="RFx Generator"
          active={path.startsWith("/ai")}
          badge="New"
          badgeVariant="success"
        />
        <NavLink
          to="/docs"
          icon={BookOpen}
          label="Knowledge Hub"
          active={path.startsWith("/docs")}
        />
        {canSeeAnalytics && (
          <NavLink
            to="/analytics"
            icon={BarChart3}
            label="Reports & Analytics"
            active={path.startsWith("/analytics")}
          />
        )}
        <NavLink
          to="/calendar"
          icon={Calendar}
          label="Calendar"
          active={path.startsWith("/calendar")}
        />

        <SectionLabel>System</SectionLabel>
        {isAdmin && (
          <NavLink
            to="/settings"
            icon={Settings}
            label="Settings"
            active={path.startsWith("/settings")}
          />
        )}
        <NavLink
          to="/notifications"
          icon={Bell}
          label="Notifications"
          active={path.startsWith("/notifications")}
          badge={notifCount > 0 ? notifCount : undefined}
          badgeVariant="accent"
        />
      </div>

      {/* Footer / User row */}
      <div className="border-t border-white/[0.08] p-2">
        <div className="flex items-center gap-2.5 p-2 rounded-[6px] hover:bg-white/10 cursor-pointer group">
          <div className="size-7 rounded-full bg-accent flex items-center justify-center text-[10px] font-semibold text-white shrink-0">
            {initials(profile?.full_name ?? profile?.email ?? "?")}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] text-white/80 font-medium truncate leading-tight">
              {profile?.full_name ?? profile?.email ?? "User"}
            </div>
            <div className="text-[10px] text-white/35 capitalize">
              {primaryRole?.replace(/_/g, " ") ?? ""}
            </div>
          </div>
          <button
            onClick={() => supabase.auth.signOut()}
            title="Sign out"
            className="size-6 rounded flex items-center justify-center text-white/25 hover:text-white/60 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
          >
            <LogOut className="size-3.5" strokeWidth={1.5} />
          </button>
        </div>
      </div>
    </aside>
  );
}

function NavLink({
  to,
  icon: Icon,
  label,
  active,
  badge,
  badgeVariant = "accent",
}: {
  to: string;
  icon: React.ElementType;
  label: string;
  active: boolean;
  badge?: string | number;
  badgeVariant?: "accent" | "success";
}) {
  return (
    <Link
      to={to}
      className={[
        "flex items-center gap-[9px] px-[14px] py-[7px] rounded-[6px] mx-1.5 text-[12px] transition-colors",
        active
          ? "bg-primary text-white"
          : "text-white/50 hover:bg-white/10 hover:text-white/85",
      ].join(" ")}
    >
      <Icon
        className={`size-4 shrink-0 ${active ? "opacity-100" : "opacity-75"}`}
        strokeWidth={1.5}
      />
      <span className="flex-1 truncate">{label}</span>
      {badge !== undefined && (
        <span
          className={[
            "text-[9px] font-bold px-[5px] py-px rounded-full leading-[1.4] shrink-0",
            badgeVariant === "success"
              ? "bg-success text-white"
              : "bg-accent text-white",
          ].join(" ")}
        >
          {badge}
        </span>
      )}
    </Link>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-2 mb-1 px-3.5 text-[9px] uppercase tracking-[0.08em] text-white/30">
      {children}
    </div>
  );
}
