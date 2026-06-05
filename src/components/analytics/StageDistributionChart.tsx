import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import type { StageDistributionRow } from "@/lib/analytics-queries";
import { stageLabel } from "@/lib/bid-constants";

const STAGE_COLORS: Record<string, string> = {
  deal_qualification: "#491AEB",
  rfi:               "#7c5af0",
  rfp:               "#FD5B0E",
  orals:             "#F59E0B",
  due_diligence:     "#27C084",
  bafo:              "#0891b2",
  contract_closure:  "#A09DB8",
  post_closure:      "#6b6785",
};

interface Props {
  data: StageDistributionRow[];
}

export function StageDistributionChart({ data }: Props) {
  if (data.length === 0) {
    return (
      <div className="h-[140px] flex items-center justify-center text-[11px] text-muted-foreground">
        No active bids
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4">
      <ResponsiveContainer width={140} height={140}>
        <PieChart>
          <Pie
            data={data}
            dataKey="bid_count"
            cx="50%"
            cy="50%"
            innerRadius={38}
            outerRadius={58}
            strokeWidth={0}
          >
            {data.map((entry) => (
              <Cell
                key={entry.stage}
                fill={STAGE_COLORS[entry.stage] ?? "#a09db8"}
              />
            ))}
          </Pie>
          <Tooltip
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            formatter={(v: any, _n: any, props: any) => [v, stageLabel(props.payload.stage)]}
            contentStyle={{ fontSize: 11, borderRadius: 6, border: "0.5px solid #e2dff0" }}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="flex-1 flex flex-col gap-1.5 text-[10px]">
        {data.map((d) => (
          <div key={d.stage} className="flex items-center gap-1.5">
            <div
              className="w-2 h-2 rounded-[2px] flex-shrink-0"
              style={{ background: STAGE_COLORS[d.stage] ?? "#a09db8" }}
            />
            <span className="flex-1 text-[#6b6785]">{stageLabel(d.stage)}</span>
            <span className="font-semibold">{d.bid_count}</span>
            <span className="text-muted-foreground ml-0.5">{d.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
