import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";

export type AppRole = "pre_sales" | "legal" | "finance" | "admin";

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setLoading(false);
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  return { session, user: session?.user ?? null, loading };
}

export function useCurrentUser() {
  const { user, loading: sessionLoading } = useSession();
  const profileQuery = useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("profiles")
        .select("id, full_name, email, avatar_url, status")
        .eq("id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data as { id: string; full_name: string | null; email: string; avatar_url: string | null; status: "pending" | "active" | "suspended" } | null;
    },
  });

  const rolesQuery = useQuery({
    queryKey: ["roles", user?.id],
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    retry: false,
    queryFn: async () => {
      // Double-check the session is live before hitting the DB,
      // guarding against the brief window where useSession's local
      // state has user but the Supabase client hasn't yet attached its JWT.
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return [] as AppRole[];
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id);
      if (error) throw error;
      return (data ?? []).map((r) => r.role as AppRole);
    },
  });

  const roles = rolesQuery.data ?? [];
  const primaryRole: AppRole =
    roles.includes("admin") ? "admin"
    : roles.includes("pre_sales") ? "pre_sales"
    : roles.includes("legal") ? "legal"
    : roles.includes("finance") ? "finance"
    : "pre_sales";

  return {
    user,
    profile: profileQuery.data,
    roles,
    primaryRole,
    isAdmin: roles.includes("admin"),
    isPreSales: roles.includes("pre_sales") || roles.includes("admin"),
    loading: sessionLoading || profileQuery.isLoading || rolesQuery.isLoading,
  };
}

export function defaultLandingFor(role: AppRole): string {
  if (role === "legal" || role === "finance") return "/queue";
  return "/dashboard";
}
