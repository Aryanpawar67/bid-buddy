import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Sidebar } from "@/components/app/Sidebar";
import { TopBar } from "@/components/app/TopBar";
import { useCurrentUser } from "@/lib/auth";
import { useDeadlineNotifier } from "@/lib/notification-queries";

function DeadlineNotifier() {
  useDeadlineNotifier();
  return null;
}

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

function AppLayout() {
  const { user, profile, loading } = useCurrentUser();
  const navigate = useNavigate();
  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth", replace: true });
    if (!loading && (profile?.status === "pending" || profile?.status === "suspended")) {
      navigate({ to: "/pending", replace: true });
    }
  }, [loading, user, profile, navigate]);

  if (loading || !user) {
    return (
      <div className="h-screen flex items-center justify-center text-muted-foreground text-sm">
        Loading…
      </div>
    );
  }

  return (
    <div className="h-screen w-screen flex bg-background overflow-hidden">
      <DeadlineNotifier />
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar />
        <main className="flex-1 min-h-0 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
