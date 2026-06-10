import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AppRole } from "@/lib/auth";
import { useCurrentUser } from "@/lib/auth";
import { rejectUserFn } from "@/lib/api/reject-user";
import {
  saveHubSpotTokenFn,
  saveStageMapFn,
  syncFromHubSpotFn,
} from "@/lib/api/hubspot-sync";
import {
  createUserFn,
  changePasswordFn,
  deleteUserFn,
} from "@/lib/api/admin-user";

export type RolePermission = {
  id: string;
  role: "pre_sales" | "legal" | "finance";
  resource_type: "page" | "feature";
  resource_key: string;
  allowed: boolean;
};

export type TeamMember = {
  id: string;
  full_name: string | null;
  email: string;
  avatar_url: string | null;
  status: "pending" | "active" | "suspended";
  primaryRole: AppRole;
};

export type BidAssignment = {
  id: string;
  bid_id: string;
  user_id: string;
  assigned_by: string | null;
  assigned_at: string;
};

// ── useRolePermissions ────────────────────────────────────────────────────────
export function useRolePermissions() {
  return useQuery({
    queryKey: ["role-permissions"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("role_permissions")
        .select("*")
        .order("role")
        .order("resource_key");
      if (error) throw error;
      return (data ?? []) as RolePermission[];
    },
  });
}

// ── useUpdateRolePermissions ──────────────────────────────────────────────────
export function useUpdateRolePermissions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (updates: { id: string; allowed: boolean }[]) => {
      for (const u of updates) {
        const { error } = await (supabase as any)
          .from("role_permissions")
          .update({ allowed: u.allowed, updated_at: new Date().toISOString() })
          .eq("id", u.id);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["role-permissions"] }),
  });
}

// ── useTeamMembers ────────────────────────────────────────────────────────────
export function useTeamMembers() {
  return useQuery({
    queryKey: ["team-members"],
    queryFn: async () => {
      const { data: profiles, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, avatar_url, status")
        .in("status" as never, ["active", "suspended"])
        .order("full_name");
      if (error) throw error;

      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id, role");

      return ((profiles as any[]) ?? []).map((p) => {
        const userRoles = (roles ?? []).filter((r) => r.user_id === p.id).map((r) => r.role as AppRole);
        const primaryRole: AppRole =
          userRoles.includes("admin") ? "admin"
          : userRoles.includes("pre_sales") ? "pre_sales"
          : userRoles.includes("legal") ? "legal"
          : userRoles.includes("finance") ? "finance"
          : "pre_sales";
        return { ...p, primaryRole } as TeamMember;
      });
    },
  });
}

// ── usePendingMembers ─────────────────────────────────────────────────────────
export function usePendingMembers() {
  return useQuery({
    queryKey: ["pending-members"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, avatar_url, status")
        .eq("status" as never, "pending")
        .order("full_name");
      if (error) throw error;
      return (data as any[]) ?? [];
    },
  });
}

// ── useUpdateMemberRole ───────────────────────────────────────────────────────
export function useUpdateMemberRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, newRole }: { userId: string; newRole: AppRole }) => {
      await supabase.from("user_roles").delete().eq("user_id", userId);
      const { error } = await supabase.from("user_roles").insert({ user_id: userId, role: newRole });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["team-members"] }),
  });
}

// ── useApproveUser ────────────────────────────────────────────────────────────
export function useApproveUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: AppRole }) => {
      // Fetch email before approval so we can clear the signup notification
      const { data: profile } = await supabase
        .from("profiles")
        .select("email")
        .eq("id", userId)
        .single();

      const { error: statusErr } = await (supabase as any)
        .from("profiles")
        .update({ status: "active" })
        .eq("id", userId);
      if (statusErr) throw statusErr;

      // Delete the trigger-inserted default role before inserting the chosen one
      await supabase.from("user_roles").delete().eq("user_id", userId);
      const { error: roleErr } = await supabase
        .from("user_roles")
        .insert({ user_id: userId, role });
      if (roleErr) throw roleErr;

      // Dismiss the new_user_signup notification for this user (RLS: admin's own row)
      if (profile?.email) {
        await (supabase as any)
          .from("notifications")
          .delete()
          .eq("type", "new_user_signup")
          .ilike("body", `%${profile.email}%`);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team-members"] });
      qc.invalidateQueries({ queryKey: ["pending-members"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

// ── useSuspendUser ────────────────────────────────────────────────────────────
export function useSuspendUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      await supabase.from("user_roles").delete().eq("user_id", userId);
      const { error } = await (supabase as any)
        .from("profiles")
        .update({ status: "suspended" })
        .eq("id", userId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["team-members"] }),
  });
}

// ── useBidAssignments ─────────────────────────────────────────────────────────
export function useBidAssignments(userId?: string) {
  return useQuery({
    queryKey: ["bid-assignments", userId],
    enabled: true,
    queryFn: async () => {
      let q = (supabase as any).from("bid_assignments").select("*, bids(id, client_name, stage)");
      if (userId) q = q.eq("user_id", userId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Array<BidAssignment & { bids: { id: string; client_name: string; stage: string } }>;
    },
  });
}

// ── useAssignBid ──────────────────────────────────────────────────────────────
export function useAssignBid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ bidId, userId, assignedBy }: { bidId: string; userId: string; assignedBy: string }) => {
      const { error } = await (supabase as any)
        .from("bid_assignments")
        .insert({ bid_id: bidId, user_id: userId, assigned_by: assignedBy });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bid-assignments"] }),
  });
}

// ── useRemoveBidAssignment ────────────────────────────────────────────────────
export function useRemoveBidAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (assignmentId: string) => {
      const { error } = await (supabase as any).from("bid_assignments").delete().eq("id", assignmentId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bid-assignments"] }),
  });
}

// ── useHasPermission ──────────────────────────────────────────────────────────
export function useHasPermission(resourceKey: string): boolean {
  const { primaryRole, isAdmin } = useCurrentUser();
  const { data: perms = [] } = useRolePermissions();
  if (isAdmin) return true;
  const match = perms.find((p) => p.role === primaryRole && p.resource_key === resourceKey);
  return match?.allowed ?? false;
}

// ── useHubSpotStatus ──────────────────────────────────────────────────────────
export function useHubSpotStatus() {
  return useQuery({
    queryKey: ["hubspot-status"],
    queryFn: async () => {
      const [tokenRes, syncRes, mapRes] = await Promise.all([
        (supabase as any).from("org_settings").select("value").eq("key", "hubspot_token").maybeSingle(),
        (supabase as any).from("org_settings").select("value").eq("key", "hubspot_last_synced").maybeSingle(),
        (supabase as any).from("org_settings").select("value").eq("key", "hubspot_stage_map").maybeSingle(),
      ]);
      return {
        connected: !!((tokenRes.data?.value as any)?.token),
        lastSynced: (syncRes.data?.value as any) ?? { at: null, created: 0, updated: 0, errors: 0 },
        mappings: ((mapRes.data?.value as any)?.mappings ?? []) as { hubspot: string; bidcompass: string }[],
      };
    },
  });
}

// ── useSaveHubSpotToken ───────────────────────────────────────────────────────
export function useSaveHubSpotToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => saveHubSpotTokenFn({ data: { token } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hubspot-status"] }),
  });
}

// ── useSaveStageMap ───────────────────────────────────────────────────────────
export function useSaveStageMap() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mappings: { hubspot: string; bidcompass: string }[]) =>
      saveStageMapFn({ data: { mappings } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hubspot-status"] }),
  });
}

// ── useSyncFromHubSpot ────────────────────────────────────────────────────────
export function useSyncFromHubSpot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => syncFromHubSpotFn({ data: {} }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hubspot-status"] });
      qc.invalidateQueries({ queryKey: ["bids"] });
    },
  });
}

// ── useRejectUser ─────────────────────────────────────────────────────────────
export function useRejectUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      const res = await rejectUserFn({ data: { userId } });
      if (res instanceof Response && !res.ok) throw new Error("Reject failed");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pending-members"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

// ── useCreateUser ─────────────────────────────────────────────────────────────
export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      email: string;
      password: string;
      fullName: string;
      role: AppRole;
    }) => createUserFn({ data: payload }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team-members"] });
    },
  });
}

// ── useChangePassword ─────────────────────────────────────────────────────────
export function useChangePassword() {
  return useMutation({
    mutationFn: (payload: { userId: string; newPassword: string }) =>
      changePasswordFn({ data: payload }),
  });
}

// ── useDeleteUser ─────────────────────────────────────────────────────────────
export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => deleteUserFn({ data: { userId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team-members"] });
    },
  });
}
