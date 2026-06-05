import { BarChart2, DollarSign, Trophy, Clock, FileCheck } from "lucide-react";
import type { KpiSummary } from "@/lib/analytics-queries";
import { fmtMoney } from "@/lib/bid-constants";

interface Props {
  data: KpiSummary | null | undefined;
  loading?: boolean;
}

type KpiDef = {
  icon: React.ReactNode;
  iconBg: string;
  label: string;
  value: string;
  delta: string;
  deltaUp?: boolean;
  deltaDown?: boolean;
};

function KpiCard({ icon, iconBg, label, value, delta, deltaUp, deltaDown }: KpiDef) {
  return (
    <div className="bg-white hairline border rounded-lg px-3 py-2.5 flex items-center gap-2.5">
      <div
        className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
        style={{ background: iconBg }}
      >
        {icon}
      </div>
      <div>
        <div className="text-[9px] uppercase tracking-[0.06em] text-muted-foreground">{label}</div>
        <div className="text-[22px] font-bold leading-tight">{value}</div>
        <div
          className={[
            "text-[10px] mt-0.5",
            deltaUp ? "text-[#27C084]" : deltaDown ? "text-[#EF4444]" : "text-muted-foreground",
          ].join(" ")}
        >
          {delta}
        </div>
      </div>
    </div>
  );
}

export function KpiStrip({ data, loading }: Props) {
  if (loading || !data) {
    return (
      <div className="grid grid-cols-5 gap-2.5 p-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="bg-white hairline border rounded-lg h-[72px] animate-pulse" />
        ))}
      </div>
    );
  }

  const cards: KpiDef[] = [
    {
      icon: <BarChart2 size={16} className="text-[#491AEB]" />,
      iconBg: "#ede9fd",
      label: "Active Bids",
      value: String(data.active_bids),
      delta: "current open pipeline",
    },
    {
      icon: <DollarSign size={16} className="text-[#FD5B0E]" />,
      iconBg: "#fff0e8",
      label: "Pipeline Value",
      value: fmtMoney(data.pipeline_value),
      delta: "active bids total",
    },
    {
      icon: <Trophy size={16} className="text-[#27C084]" />,
      iconBg: "#edfaf4",
      label: "Win Rate",
      value: `${data.win_rate}%`,
      delta: "of closed in period",
      deltaUp: data.win_rate >= 40,
      deltaDown: data.win_rate < 25,
    },
    {
      icon: <Clock size={16} className="text-[#EF4444]" />,
      iconBg: "#fff1f1",
      label: "Avg Cycle Time",
      value: data.avg_cycle_days != null ? `${data.avg_cycle_days}d` : "—",
      delta: "avg days to close",
    },
    {
      icon: <FileCheck size={16} className="text-[#F59E0B]" />,
      iconBg: "#fffbeb",
      label: "Closed (Period)",
      value: String(data.closed_count),
      delta: `${data.won_count} won · ${data.lost_count} lost`,
      deltaUp: data.won_count > data.lost_count,
    },
  ];

  return (
    <div className="grid grid-cols-5 gap-2.5 p-3">
      {cards.map((c) => (
        <KpiCard key={c.label} {...c} />
      ))}
    </div>
  );
}
