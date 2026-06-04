import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  CheckSquare,
  BarChart3,
  FileText,
  RefreshCcw,
  Settings,
  Trophy,
  LogOut,
} from "lucide-react";
import { useCurrentUser } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { initials } from "@/lib/bid-constants";

const NAV = [
  { to: "/dashboard", icon: Trophy, label: "Pipeline", roles: ["pre_sales", "legal", "finance", "admin"] },
  { to: "/queue", icon: CheckSquare, label: "My queue", roles: ["pre_sales", "legal", "finance", "admin"] },
  { to: "/analytics", icon: BarChart3, label: "Analytics", roles: ["pre_sales", "admin"] },
  { to: "/docs", icon: FileText, label: "Documents", roles: ["pre_sales", "legal", "finance", "admin"] },
  { to: "/hubspot", icon: RefreshCcw, label: "HubSpot", roles: ["pre_sales", "admin"] },
  { to: "/settings", icon: Settings, label: "Settings", roles: ["admin"] },
] as const;

export function Sidebar() {
  const { primaryRole, profile } = useCurrentUser();
  const path = useRouterState({ select: (s) => s.location.pathname });

  return (
    <aside className="w-[52px] shrink-0 bg-sidebar flex flex-col items-center py-3 gap-1.5">
      <Link to="/dashboard" className="size-9 rounded-lg bg-primary flex items-center justify-center mb-2">
        <LayoutDashboard className="size-4 text-primary-foreground" />
      </Link>
      <nav className="flex flex-col gap-1 flex-1">
        {NAV.filter((n) => n.roles.includes(primaryRole)).map((n) => {
          const active = path.startsWith(n.to);
          const Icon = n.icon;
          return (
            <Link
              key={n.to}
              to={n.to}
              title={n.label}
              className={[
                "size-9 rounded-lg flex items-center justify-center transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-white/45 hover:text-white hover:bg-white/5",
              ].join(" ")}
            >
              <Icon className="size-[18px]" strokeWidth={1.75} />
            </Link>
          );
        })}
      </nav>
      <button
        onClick={() => supabase.auth.signOut()}
        title="Sign out"
        className="size-9 rounded-lg flex items-center justify-center text-white/45 hover:text-white hover:bg-white/5"
      >
        <LogOut className="size-[18px]" strokeWidth={1.75} />
      </button>
      <div
        title={profile?.full_name ?? ""}
        className="size-8 rounded-full bg-accent text-accent-foreground flex items-center justify-center text-[11px] font-medium mt-1"
      >
        {initials(profile?.full_name ?? profile?.email ?? "?")}
      </div>
    </aside>
  );
}
