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
  const { user } = useSession();
  const profileQuery = useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, avatar_url")
        .eq("id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const rolesQuery = useQuery({
    queryKey: ["roles", user?.id],
    enabled: !!user,
    queryFn: async () => {
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
    loading: profileQuery.isLoading || rolesQuery.isLoading,
  };
}

export function defaultLandingFor(role: AppRole): string {
  if (role === "legal" || role === "finance") return "/queue";
  return "/dashboard";
}
