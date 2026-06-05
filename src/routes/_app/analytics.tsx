import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { parseISO } from "date-fns";
import { useCurrentUser } from "@/lib/auth";
import {
  presetToRange,
  useKpiSummary,
  useWinRateTrend,
  useStageDistribution,
  usePipelineValueByStage,
  useCycleTimeByStage,
  useWonLostByMonth,
  useMonthlyIntake,
  useTeamPerformance,
  type DateRange,
} from "@/lib/analytics-queries";
import { DateRangePicker } from "@/components/analytics/DateRangePicker";
import { KpiStrip } from "@/components/analytics/KpiStrip";
import { WinRateTrendChart } from "@/components/analytics/WinRateTrendChart";
import { StageDistributionChart } from "@/components/analytics/StageDistributionChart";
import { PipelineValueChart } from "@/components/analytics/PipelineValueChart";
import { CycleTimeChart } from "@/components/analytics/CycleTimeChart";
import { WonLostChart } from "@/components/analytics/WonLostChart";
import { MonthlyIntakeChart } from "@/components/analytics/MonthlyIntakeChart";
import { TeamPerformanceTable } from "@/components/analytics/TeamPerformanceTable";

// ── Search params ─────────────────────────────────────────────────────────────

type AnalyticsSearch = {
  preset: "30d" | "90d" | "12m";
  from?: string;
  to?: string;
};

export const Route = createFileRoute("/_app/analytics")({
  validateSearch: (search: Record<string, unknown>): AnalyticsSearch => ({
    preset: ["30d", "90d", "12m"].includes(search.preset as string)
      ? (search.preset as "30d" | "90d" | "12m")
      : "90d",
    from: typeof search.from === "string" ? search.from : undefined,
    to:   typeof search.to   === "string" ? search.to   : undefined,
  }),
  component: AnalyticsPage,
});

// ── Chart card wrapper ────────────────────────────────────────────────────────

function ChartCard({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="bg-white hairline border rounded-lg overflow-hidden">
      <div className="px-3 pt-2.5 pb-2 border-b border-[#f0eef8]">
        <div className="text-[12px] font-semibold">{title}</div>
        <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>
      </div>
      <div className="px-3 py-2.5">{children}</div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

function AnalyticsPage() {
  const { preset, from, to } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { isAdmin } = useCurrentUser();

  const range: DateRange = useMemo(() => {
    if (from && to) return { from: parseISO(from), to: parseISO(to) };
    return presetToRange(preset);
  }, [preset, from, to]);

  function handlePresetChange(p: "30d" | "90d" | "12m") {
    navigate({ search: { preset: p } });
  }

  const kpi         = useKpiSummary(range);
  const winTrend    = useWinRateTrend(range);
  const stageDist   = useStageDistribution();
  const pipelineVal = usePipelineValueByStage();
  const cycleTime   = useCycleTimeByStage(range);
  const wonLost     = useWonLostByMonth(range);
  const intake      = useMonthlyIntake(range);
  const teamPerf    = useTeamPerformance(range);

  return (
    <div className="flex flex-col h-full overflow-auto bg-[#f8f7fc]">
      {/* Topbar */}
      <div className="flex items-center gap-3 px-4 h-11 bg-white hairline border-b flex-shrink-0">
        <span className="text-[13px] font-semibold flex-1">Reports & Analytics</span>
        <DateRangePicker
          preset={preset}
          range={range}
          onPresetChange={handlePresetChange}
          onRangeChange={() => {}}
        />
      </div>

      <div className="flex-1 p-3 space-y-2.5">
        {/* KPI Strip */}
        <KpiStrip data={kpi.data} loading={kpi.isLoading} />

        {/* Row 1: Win Rate + Stage Distribution */}
        <div className="grid grid-cols-2 gap-2.5">
          <ChartCard title="Win Rate Trend" sub="Monthly win % over period">
            <WinRateTrendChart data={winTrend.data ?? []} />
          </ChartCard>
          <ChartCard title="Stage Distribution" sub="Active bids by pipeline stage">
            <StageDistributionChart data={stageDist.data ?? []} />
          </ChartCard>
        </div>

        {/* Row 2: Pipeline Value + Cycle Time */}
        <div className="grid grid-cols-2 gap-2.5">
          <ChartCard title="Pipeline Value by Stage" sub="Total value of active bids per stage">
            <PipelineValueChart data={pipelineVal.data ?? []} />
          </ChartCard>
          <ChartCard title="Cycle Time by Stage" sub="Avg. days a bid spends in each stage">
            <CycleTimeChart data={cycleTime.data ?? []} />
          </ChartCard>
        </div>

        {/* Row 3: Won vs Lost + Monthly Intake */}
        <div className="grid grid-cols-2 gap-2.5">
          <ChartCard title="Won vs Lost Value" sub="Monthly closed deal value">
            <WonLostChart data={wonLost.data ?? []} />
          </ChartCard>
          <ChartCard title="Monthly Intake" sub="New bids created per month">
            <MonthlyIntakeChart data={intake.data ?? []} />
          </ChartCard>
        </div>

        {/* Row 4: Team Performance (admin only) */}
        {isAdmin && (
          <div className="bg-white hairline border rounded-lg overflow-hidden">
            <div className="flex items-start justify-between px-3 pt-2.5 pb-2 border-b border-[#f0eef8]">
              <div>
                <div className="text-[12px] font-semibold">Team Performance</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  Win rate and pipeline value by team member
                </div>
              </div>
              <span className="h-5 px-2 rounded bg-[#ede9fd] text-[#491AEB] text-[9px] font-bold flex items-center tracking-wider uppercase">
                Admin Only
              </span>
            </div>
            <TeamPerformanceTable data={teamPerf.data ?? []} loading={teamPerf.isLoading} />
          </div>
        )}
      </div>
    </div>
  );
}
