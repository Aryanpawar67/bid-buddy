import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { StageKey } from "@/lib/bid-constants";

export type Bid = {
  id: string;
  client_name: string;
  title: string;
  type: "rfp" | "rfi" | "rfq" | "direct";
  value: number;
  status: "active" | "submitted" | "won" | "lost" | "no_go" | "on_hold";
  stage: StageKey;
  deadline: string;
  clarification_deadline: string | null;
  orals_date: string | null;
  priority: "high" | "medium" | "low";
  procurement_portal: string | null;
  owner_id: string | null;
  hubspot_deal_id: string | null;
  gonogo_score: number | null;
  gonogo_decision: "go" | "conditional_go" | "no_go" | null;
  created_at: string;
  updated_at: string;
};

export function useBids() {
  return useQuery({
    queryKey: ["bids"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bids")
        .select("*")
        .order("deadline", { ascending: true });
      if (error) throw error;
      return data as Bid[];
    },
  });
}

export function useBid(id: string | undefined) {
  return useQuery({
    queryKey: ["bid", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bids")
        .select("*")
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return data as Bid | null;
    },
  });
}

export function useStageItems(bidId: string | undefined, stage: StageKey | undefined) {
  return useQuery({
    queryKey: ["stage-items", bidId, stage],
    enabled: !!bidId && !!stage,
    queryFn: async () => {
      const [q, d] = await Promise.all([
        supabase.from("bid_questions").select("*").eq("bid_id", bidId!).eq("stage", stage!).order("order_index"),
        supabase.from("bid_deliverables").select("*").eq("bid_id", bidId!).eq("stage", stage!).order("order_index"),
      ]);
      if (q.error) throw q.error;
      if (d.error) throw d.error;
      return { questions: q.data ?? [], deliverables: d.data ?? [] };
    },
  });
}

export function useUpdateBid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch, currentStage }: { id: string; patch: Partial<Bid>; currentStage?: string }) => {
      const { error } = await supabase.from("bids").update(patch).eq("id", id);
      if (error) throw error;

      if (patch.stage && currentStage && patch.stage !== currentStage) {
        // Belt-and-suspenders: trigger handles this too, but write client-side for resilience
        await supabase.from("bid_stage_transitions" as never).insert({
          bid_id: id,
          from_stage: currentStage,
          to_stage: patch.stage,
        });
        import("@/lib/api/hubspot-sync").then(({ pushBidStageToHubSpotFn }) => {
          pushBidStageToHubSpotFn({ data: { bidId: id, newStage: patch.stage! } }).catch(console.error);
        });
      }
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["bids"] });
      qc.invalidateQueries({ queryKey: ["bid", v.id] });
    },
  });
}

export function useToggleDeliverable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "pending" | "done" | "in_progress" | "blocked" }) => {
      const { error } = await supabase.from("bid_deliverables").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stage-items"] });
      qc.invalidateQueries({ queryKey: ["my-queue"] });
    },
  });
}

export function useToggleQuestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "pending" | "done" | "in_progress" | "blocked" }) => {
      const { error } = await supabase.from("bid_questions").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stage-items"] });
      qc.invalidateQueries({ queryKey: ["my-queue"] });
    },
  });
}

export function useMyQueue(userId: string | undefined) {
  return useQuery({
    queryKey: ["my-queue", userId],
    enabled: !!userId,
    queryFn: async () => {
      const [q, d] = await Promise.all([
        supabase.from("bid_questions").select("*, bids!inner(id,client_name,title,stage,deadline,priority)").eq("assigned_to", userId!),
        supabase.from("bid_deliverables").select("*, bids!inner(id,client_name,title,stage,deadline,priority)").eq("assigned_to", userId!),
      ]);
      if (q.error) throw q.error;
      if (d.error) throw d.error;
      return {
        questions: q.data ?? [],
        deliverables: d.data ?? [],
      };
    },
  });
}

export type ActivityEntry = {
  id: string;
  bid_id: string;
  action: string;
  created_at: string;
  metadata: Record<string, unknown> | null;
  user_id: string | null;
  bids: { client_name: string; title: string } | null;
};

export function useRecentActivity(limit = 4) {
  return useQuery({
    queryKey: ["recent-activity", limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bid_activity_log")
        .select("*, bids(client_name, title)")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as ActivityEntry[];
    },
  });
}
