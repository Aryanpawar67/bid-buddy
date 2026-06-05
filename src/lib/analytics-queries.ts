import { useQuery } from "@tanstack/react-query";
import { subDays, subMonths, startOfDay, endOfDay } from "date-fns";
import { supabase } from "@/integrations/supabase/client";

// ── Types ─────────────────────────────────────────────────────────────────────

export type DateRange = { from: Date; to: Date };

export type KpiSummary = {
  active_bids: number;
  pipeline_value: number;
  win_rate: number;
  avg_cycle_days: number | null;
  closed_count: number;
  won_count: number;
  lost_count: number;
};

export type WinRateTrendRow = {
  month: string;
  won_count: number;
  closed_count: number;
  win_rate: number;
};

export type StageDistributionRow = {
  stage: string;
  bid_count: number;
  pct: number;
};

export type PipelineValueRow = {
  stage: string;
  total_value: number;
};

export type CycleTimeRow = {
  stage: string;
  avg_days: number;
};

export type WonLostRow = {
  month: string;
  won_value: number;
  lost_value: number;
};

export type MonthlyIntakeRow = {
  month: string;
  new_bids: number;
};

export type TeamPerformanceRow = {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  active_bids: number;
  closed_count: number;
  won_count: number;
  win_rate: number;
  pipeline_value: number;
  avg_cycle_days: number | null;
};

// ── Date preset helpers ───────────────────────────────────────────────────────

export function presetToRange(preset: "30d" | "90d" | "12m"): DateRange {
  const now = new Date();
  if (preset === "30d") return { from: startOfDay(subDays(now, 30)), to: endOfDay(now) };
  if (preset === "12m") return { from: startOfDay(subMonths(now, 12)), to: endOfDay(now) };
  return { from: startOfDay(subDays(now, 90)), to: endOfDay(now) };
}

function rangeKey(range: DateRange): [string, string] {
  return [range.from.toISOString(), range.to.toISOString()];
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = supabase.rpc.bind(supabase) as (fn: string, params?: Record<string, unknown>) => any;

export function useKpiSummary(range: DateRange) {
  return useQuery({
    queryKey: ["analytics-kpi", ...rangeKey(range)],
    queryFn: async () => {
      const { data, error } = await rpc("analytics_kpi_summary", {
        p_from: range.from.toISOString(),
        p_to: range.to.toISOString(),
      });
      if (error) throw error;
      return ((data as KpiSummary[])?.[0]) ?? null;
    },
  });
}

export function useWinRateTrend(range: DateRange) {
  return useQuery({
    queryKey: ["analytics-win-trend", ...rangeKey(range)],
    queryFn: async () => {
      const { data, error } = await rpc("analytics_win_rate_trend", {
        p_from: range.from.toISOString(),
        p_to: range.to.toISOString(),
      });
      if (error) throw error;
      return (data as WinRateTrendRow[]) ?? [];
    },
  });
}

export function useStageDistribution() {
  return useQuery({
    queryKey: ["analytics-stage-dist"],
    queryFn: async () => {
      const { data, error } = await rpc("analytics_stage_distribution");
      if (error) throw error;
      return (data as StageDistributionRow[]) ?? [];
    },
  });
}

export function usePipelineValueByStage() {
  return useQuery({
    queryKey: ["analytics-pipeline-value"],
    queryFn: async () => {
      const { data, error } = await rpc("analytics_pipeline_value_by_stage");
      if (error) throw error;
      return (data as PipelineValueRow[]) ?? [];
    },
  });
}

export function useCycleTimeByStage(range: DateRange) {
  return useQuery({
    queryKey: ["analytics-cycle-time", ...rangeKey(range)],
    queryFn: async () => {
      const { data, error } = await rpc("analytics_cycle_time_by_stage", {
        p_from: range.from.toISOString(),
        p_to: range.to.toISOString(),
      });
      if (error) throw error;
      return (data as CycleTimeRow[]) ?? [];
    },
  });
}

export function useWonLostByMonth(range: DateRange) {
  return useQuery({
    queryKey: ["analytics-won-lost", ...rangeKey(range)],
    queryFn: async () => {
      const { data, error } = await rpc("analytics_won_lost_by_month", {
        p_from: range.from.toISOString(),
        p_to: range.to.toISOString(),
      });
      if (error) throw error;
      return (data as WonLostRow[]) ?? [];
    },
  });
}

export function useMonthlyIntake(range: DateRange) {
  return useQuery({
    queryKey: ["analytics-intake", ...rangeKey(range)],
    queryFn: async () => {
      const { data, error } = await rpc("analytics_monthly_intake", {
        p_from: range.from.toISOString(),
        p_to: range.to.toISOString(),
      });
      if (error) throw error;
      return (data as MonthlyIntakeRow[]) ?? [];
    },
  });
}

export function useTeamPerformance(range: DateRange) {
  return useQuery({
    queryKey: ["analytics-team", ...rangeKey(range)],
    queryFn: async () => {
      const { data, error } = await rpc("analytics_team_performance", {
        p_from: range.from.toISOString(),
        p_to: range.to.toISOString(),
      });
      if (error) throw error;
      return (data as TeamPerformanceRow[]) ?? [];
    },
  });
}
