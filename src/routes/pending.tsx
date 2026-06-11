import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser, defaultLandingFor } from "@/lib/auth";

export const Route = createFileRoute("/pending")({
  component: PendingPage,
});

function PendingPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user, profile, primaryRole } = useCurrentUser();

  // Redirect as soon as profile becomes active
  useEffect(() => {
    if (profile?.status === "active") {
      navigate({ to: defaultLandingFor(primaryRole), replace: true });
    }
  }, [profile?.status, primaryRole, navigate]);

  // Realtime: watch for admin approval writing status=active
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`pending-approval-${user.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${user.id}` },
        (payload) => {
          if ((payload.new as { status: string }).status === "active") {
            qc.invalidateQueries({ queryKey: ["profile", user.id] });
            qc.invalidateQueries({ queryKey: ["roles", user.id] });
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id, qc]);

  // Polling fallback every 8s in case realtime isn't available
  useEffect(() => {
    if (!user) return;
    const interval = setInterval(() => {
      qc.invalidateQueries({ queryKey: ["profile", user.id] });
    }, 8000);
    return () => clearInterval(interval);
  }, [user?.id, qc]);

  return (
    <div className="h-screen flex items-center justify-center bg-background">
      <div className="max-w-sm text-center flex flex-col items-center gap-4 px-6">
        <div className="w-12 h-12 rounded-full bg-[#ede9fd] flex items-center justify-center text-2xl">⏳</div>
        <h1 className="text-[16px] font-semibold">Awaiting Approval</h1>
        <p className="text-[12px] text-muted-foreground leading-relaxed">
          Your account has been created and is pending admin approval. You'll be able to access BidCompass once an admin reviews and activates your account.
        </p>
        <p className="text-[11px] text-muted-foreground">If you believe this is an error, contact your administrator.</p>
      </div>
    </div>
  );
}
