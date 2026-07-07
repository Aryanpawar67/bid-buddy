import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { StageKey } from "@/lib/bid-constants";

export type QualificationInsights = {
  strengths: string[];
  risks: string[];
  recommendation: string;
  generated_at: string;
};

export type AssessmentData = {
  scores: Record<string, number>;
  comments: Record<string, string>;
  insights?: QualificationInsights;
};

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
  gonogo_completed_at: string | null;
  gonogo_completed_by: string | null;
  assessment_data: AssessmentData;
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

// ── useBidActivity ────────────────────────────────────────────────────────────
export function useBidActivity(bidId: string | undefined) {
  return useQuery({
    queryKey: ["bid-activity", bidId],
    enabled: !!bidId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bid_activity_log")
        .select("*, profiles(full_name)")
        .eq("bid_id", bidId!)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as Array<ActivityEntry & { profiles: { full_name: string } | null }>;
    },
  });
}

// ── useBidTeam ────────────────────────────────────────────────────────────────
export type BidTeamMember = {
  assignment_id: string;
  user_id: string;
  full_name: string;
  email: string;
  role: string;
};

export function useBidTeam(bidId: string | undefined) {
  return useQuery({
    queryKey: ["bid-team", bidId],
    enabled: !!bidId,
    queryFn: async () => {
      const { data: assignments, error } = await (supabase as any)
        .from("bid_assignments")
        .select("id, user_id, profiles!bid_assignments_user_id_fkey(full_name, email)")
        .eq("bid_id", bidId!);
      if (error) throw error;

      const userIds = ((assignments ?? []) as any[]).map((a: any) => a.user_id as string);
      const roleMap: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: rolesData } = await (supabase as any)
          .from("user_roles")
          .select("user_id, role")
          .in("user_id", userIds);
        for (const r of (rolesData ?? []) as any[]) roleMap[r.user_id] = r.role;
      }

      return ((assignments ?? []) as any[]).map((row: any) => ({
        assignment_id: row.id as string,
        user_id: row.user_id as string,
        full_name: (row.profiles?.full_name as string) ?? "Unknown",
        email: (row.profiles?.email as string) ?? "",
        role: roleMap[row.user_id] ?? "—",
      })) as BidTeamMember[];
    },
  });
}

// ── useAssessmentData / useSaveAssessment ─────────────────────────────────────
export function useAssessmentData(bidId: string | undefined) {
  return useQuery({
    queryKey: ["assessment-data", bidId],
    enabled: !!bidId,
    // Keep cached data fresh for 10 minutes — prevents re-fetching on every tab switch
    // and avoids a brief undefined state that would re-trigger auto-insight generation.
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bids")
        .select("assessment_data")
        .eq("id", bidId!)
        .maybeSingle();
      if (error) throw error;
      return ((data as any)?.assessment_data ?? { scores: {}, comments: {} }) as AssessmentData;
    },
  });
}

export function useSaveAssessment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ bidId, data }: { bidId: string; data: AssessmentData }) => {
      const { error } = await supabase
        .from("bids")
        .update({ assessment_data: data as never } as never)
        .eq("id", bidId);
      if (error) throw error;
    },
    onSuccess: async (_d, v) => {
      qc.invalidateQueries({ queryKey: ["assessment-data", v.bidId] });
      qc.invalidateQueries({ queryKey: ["bid", v.bidId] });
      const hasAnyScore = Object.values(v.data.scores ?? {}).some((s) => (s as number) > 0);
      if (hasAnyScore) {
        const { generateQualificationInsightsFn } = await import("@/lib/api/generate-qualification-insights");
        const { data: { session } } = await supabase.auth.getSession();
        generateQualificationInsightsFn({
          data: { bidId: v.bidId },
          headers: { authorization: `Bearer ${session?.access_token ?? ""}` },
        }).catch(() => {});
      }
    },
  });
}

// ── useGenerateQualificationInsights ─────────────────────────────────────────
export function useGenerateQualificationInsights() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (bidId: string) => {
      const { generateQualificationInsightsFn } = await import("@/lib/api/generate-qualification-insights");
      const { data: { session } } = await supabase.auth.getSession();
      const result = await generateQualificationInsightsFn({
        data: { bidId },
        headers: { authorization: `Bearer ${session?.access_token ?? ""}` },
      });
      return result as { strengths: string[]; risks: string[]; recommendation: string };
    },
    onSuccess: (_d, bidId) => {
      qc.invalidateQueries({ queryKey: ["assessment-data", bidId] });
      qc.invalidateQueries({ queryKey: ["bid", bidId] });
    },
    onError: (e) => {
      console.error("[useGenerateQualificationInsights] error:", e);
    },
  });
}

// ── useGenerateQualResult ─────────────────────────────────────────────────────
export function useGenerateQualResult() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ bidId, clientName, decision, totalScore }: {
      bidId: string;
      clientName: string;
      decision: string;
      totalScore: number;
    }) => {
      const { generateQualResultFn } = await import("@/lib/api/generate-qual-docs");
      const { data: { session } } = await supabase.auth.getSession();

      // Fetch team emails at click-time (not on render) to avoid CORS spam
      const { data: teamRows } = await (supabase as any)
        .from("bid_assignments")
        .select("profiles!bid_assignments_user_id_fkey(email)")
        .eq("bid_id", bidId);
      const teamEmails = ((teamRows ?? []) as any[])
        .map((r: any) => r.profiles?.email)
        .filter(Boolean)
        .join(",");

      const { url, filename } = await generateQualResultFn({
        data: { bidId },
        headers: { authorization: `Bearer ${session?.access_token ?? ""}` },
      }) as { url: string; filename: string };
      if (!url) throw new Error("Generation failed — no download URL");

      // Open mailto for team notification
      const decLabel = decision === "go" ? "GO" : decision === "conditional_go" ? "CONDITIONAL GO" : "NO GO";
      const subject = encodeURIComponent(`[Bid Compass] Qual Result — ${clientName} | ${decLabel}`);
      const body = encodeURIComponent(
        `Hi team,\n\nThe Bid Qualification Result for ${clientName} has been locked.\n\nDecision: ${decLabel}\nScore: ${totalScore} / 100\n\nPlease find the attached Qualification Result document.\n\n— iMocha Bid Compass`
      );
      if (teamEmails) window.open(`mailto:${teamEmails}?subject=${subject}&body=${body}`, "_self");

      return { url, filename };
    },
    onSuccess: (_d, { bidId }) => {
      qc.invalidateQueries({ queryKey: ["documents", { bidId }] });
    },
  });
}

// ── useCreateQuestion ────────────────────────────────────────────────────────
export function useCreateQuestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      bidId: string;
      stage: StageKey;
      questionText: string;
      assignedTeam: "pre_sales" | "legal" | "finance";
    }) => {
      const { error } = await supabase.from("bid_questions" as never).insert({
        bid_id: payload.bidId,
        stage: payload.stage,
        question_text: payload.questionText,
        assigned_team: payload.assignedTeam,
        status: "pending",
      } as never);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["stage-items"] }),
  });
}

// ── useCreateDeliverable ──────────────────────────────────────────────────────
export function useCreateDeliverable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      bidId: string;
      stage: StageKey;
      label: string;
      assignedTeam: "pre_sales" | "legal" | "finance";
      type?: string;
    }) => {
      const { error } = await supabase.from("bid_deliverables").insert({
        bid_id: payload.bidId,
        stage: payload.stage,
        label: payload.label,
        assigned_team: payload.assignedTeam,
        type: (payload.type ?? "document") as never,
        status: "pending",
      } as never);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["stage-items"] }),
  });
}

// ── useUpdateQuestionResponse ─────────────────────────────────────────────────
export function useUpdateQuestionResponse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      responseText,
      internalNotes,
      status,
    }: {
      id: string;
      responseText: string;
      internalNotes?: string;
      status?: "pending" | "in_progress" | "done";
    }) => {
      const patch: Record<string, unknown> = { response_text: responseText };
      if (internalNotes !== undefined) patch.internal_notes = internalNotes;
      if (status) patch.status = status;
      const { error } = await supabase.from("bid_questions" as never).update(patch as never).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["stage-items"] }),
  });
}

// ── useTeamMembers ────────────────────────────────────────────────────────────
export type TeamMember = {
  user_id: string;
  full_name: string;
  status: string;
  primary_role: string;
};

export function useTeamMembers() {
  return useQuery({
    queryKey: ["team-members"],
    queryFn: async () => {
      const { data: profilesData, error } = await (supabase as any)
        .from("profiles")
        .select("id, full_name, status")
        .eq("status", "active")
        .order("full_name");
      if (error) throw error;

      const userIds = ((profilesData ?? []) as any[]).map((p: any) => p.id as string);
      const roleMap: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: rolesData } = await (supabase as any)
          .from("user_roles")
          .select("user_id, role")
          .in("user_id", userIds);
        for (const r of (rolesData ?? []) as any[]) roleMap[r.user_id] = r.role;
      }

      return ((profilesData ?? []) as any[]).map((p: any) => ({
        user_id: p.id as string,
        full_name: (p.full_name as string) ?? "Unknown",
        status: p.status as string,
        primary_role: roleMap[p.id] ?? "pre_sales",
      })) as TeamMember[];
    },
  });
}

// ── useGenerateDealBrief ──────────────────────────────────────────────────────
export function useGenerateDealBrief() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (bidId: string) => {
      const { generateDealBriefFn } = await import("@/lib/api/generate-qual-docs");
      const { data: { session } } = await supabase.auth.getSession();
      const { url, filename } = await generateDealBriefFn({
        data: { bidId },
        headers: { authorization: `Bearer ${session?.access_token ?? ""}` },
      }) as { url: string; filename: string };
      if (!url) throw new Error("Generation failed — no download URL");
      return { url, filename };
    },
    onSuccess: (_d, bidId) => {
      qc.invalidateQueries({ queryKey: ["documents", { bidId }] });
    },
    onError: (e) => {
      console.error("[useGenerateDealBrief] error:", e);
    },
  });
}

// ── Contract Approvals ────────────────────────────────────────────────────────

export type ContractApproval = {
  id: string;
  bid_id: string;
  stage: "legal" | "commercial" | "finance" | "executive";
  status: "pending" | "approved" | "rejected";
  approved_by: string | null;
  approved_at: string | null;
  notes: string | null;
  approver_name: string | null;
};

const APPROVAL_STAGE_ORDER: ContractApproval["stage"][] = [
  "legal",
  "commercial",
  "finance",
  "executive",
];

export function useContractApprovals(bidId: string | undefined) {
  return useQuery({
    queryKey: ["contract-approvals", bidId],
    enabled: !!bidId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contract_approvals")
        .select("*")
        .eq("bid_id", bidId!);
      if (error) throw error;
      const rows = (data ?? []) as ContractApproval[];

      // Fetch approver names separately (user_roles FK path issue)
      const approverIds = rows.map(r => r.approved_by).filter(Boolean) as string[];
      const nameMap: Record<string, string> = {};
      if (approverIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", approverIds);
        for (const p of (profiles ?? []) as any[]) nameMap[p.id] = p.full_name;
      }

      // Build a complete ordered list, filling gaps with pending stubs
      const byStage = Object.fromEntries(rows.map(r => [r.stage, r]));
      return APPROVAL_STAGE_ORDER.map(stage => ({
        ...(byStage[stage] ?? {
          id: "",
          bid_id: bidId!,
          stage,
          status: "pending" as const,
          approved_by: null,
          approved_at: null,
          notes: null,
        }),
        approver_name: byStage[stage]?.approved_by ? (nameMap[byStage[stage].approved_by!] ?? null) : null,
      })) as ContractApproval[];
    },
  });
}

export function useEnsureApprovals() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (bidId: string) => {
      // Insert pending rows for any stages that don't exist yet (upsert-safe)
      const upserts = APPROVAL_STAGE_ORDER.map(stage => ({
        bid_id: bidId,
        stage,
        status: "pending" as const,
      }));
      const { error } = await supabase
        .from("contract_approvals")
        .upsert(upserts, { onConflict: "bid_id,stage", ignoreDuplicates: true });
      if (error) throw error;
    },
    onSuccess: (_d, bidId) => {
      qc.invalidateQueries({ queryKey: ["contract-approvals", bidId] });
    },
  });
}

export function useActionApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      bidId,
      stage,
      status,
      userId,
      notes,
    }: {
      bidId: string;
      stage: ContractApproval["stage"];
      status: "approved" | "rejected";
      userId: string;
      notes?: string;
    }) => {
      const { error } = await supabase
        .from("contract_approvals")
        .upsert(
          {
            bid_id: bidId,
            stage,
            status,
            approved_by: userId,
            approved_at: new Date().toISOString(),
            notes: notes ?? null,
          },
          { onConflict: "bid_id,stage" }
        );
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["contract-approvals", v.bidId] });
    },
  });
}
