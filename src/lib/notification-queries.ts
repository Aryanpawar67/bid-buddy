import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/lib/auth";
import { useBids } from "@/lib/bid-queries";

export type Notification = {
  id: string;
  user_id: string;
  bid_id: string | null;
  type: "stage_change" | "deadline" | "gonogo" | "bid_created" | "task_done";
  title: string;
  body: string;
  read: boolean;
  created_at: string;
  bids: { client_name: string; title: string } | null;
};

// ─── useNotifications ────────────────────────────────────────────────────────
export function useNotifications() {
  const { user } = useCurrentUser();
  const qc = useQueryClient();

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("notifications-feed")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        () => {
          qc.invalidateQueries({ queryKey: ["notifications"] });
          qc.invalidateQueries({ queryKey: ["notification-count"] });
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, qc]);

  return useQuery({
    queryKey: ["notifications"],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("*, bids(client_name, title)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Notification[];
    },
  });
}

// ─── useNotificationCount ────────────────────────────────────────────────────
export function useNotificationCount() {
  const { user } = useCurrentUser();
  const qc = useQueryClient();

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("notifications-count")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        () => { qc.invalidateQueries({ queryKey: ["notification-count"] }); },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, qc]);

  return useQuery({
    queryKey: ["notification-count"],
    enabled: !!user,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .eq("read", false);
      if (error) throw error;
      return count ?? 0;
    },
  });
}

// ─── useMarkRead ─────────────────────────────────────────────────────────────
export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("notifications")
        .update({ read: true })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      qc.invalidateQueries({ queryKey: ["notification-count"] });
    },
  });
}

// ─── useMarkAllRead ──────────────────────────────────────────────────────────
export function useMarkAllRead() {
  const { user } = useCurrentUser();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!user) return;
      const { error } = await supabase
        .from("notifications")
        .update({ read: true })
        .eq("user_id", user.id)
        .eq("read", false);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      qc.invalidateQueries({ queryKey: ["notification-count"] });
    },
  });
}

// ─── useDeadlineNotifier ─────────────────────────────────────────────────────
export function useDeadlineNotifier() {
  const { user } = useCurrentUser();
  const { data: bids = [] } = useBids();

  useEffect(() => {
    if (!user || bids.length === 0) return;

    async function checkDeadlines() {
      const now = new Date();
      const cutoff = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
      const urgentBids = bids.filter((b) => {
        if (b.status !== "active") return false;
        const d = new Date(b.deadline);
        return d >= now && d <= cutoff;
      });
      if (urgentBids.length === 0) return;

      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const { data: existing } = await supabase
        .from("notifications")
        .select("bid_id")
        .eq("user_id", user!.id)
        .eq("type", "deadline")
        .gte("created_at", oneDayAgo);

      const alreadyNotified = new Set((existing ?? []).map((r) => r.bid_id));

      for (const bid of urgentBids) {
        if (alreadyNotified.has(bid.id)) continue;
        const days = Math.ceil((new Date(bid.deadline).getTime() - now.getTime()) / 86400000);
        await supabase.from("notifications").insert({
          user_id: user!.id,
          bid_id: bid.id,
          type: "deadline",
          title: `Deadline in ${days}d — ${bid.client_name}`,
          body: `${bid.title} is due ${new Date(bid.deadline).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
          read: false,
        });
      }
    }

    checkDeadlines();
  }, [user?.id, bids.length]); // eslint-disable-line react-hooks/exhaustive-deps
}
