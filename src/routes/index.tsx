import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect } from "react";
import { useSession, useCurrentUser, defaultLandingFor } from "@/lib/auth";
import { useNavigate } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: IndexRedirect,
});

function IndexRedirect() {
  const { session, loading } = useSession();
  const { primaryRole, loading: pLoading } = useCurrentUser();
  const navigate = useNavigate();
  useEffect(() => {
    if (loading) return;
    if (!session) {
      navigate({ to: "/auth", replace: true });
      return;
    }
    if (!pLoading) {
      navigate({ to: defaultLandingFor(primaryRole), replace: true });
    }
  }, [loading, pLoading, session, primaryRole, navigate]);
  return (
    <div className="h-screen flex items-center justify-center text-muted-foreground text-sm">
      Loading…
    </div>
  );
}
