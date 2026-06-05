import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Cell,
  LabelList, ResponsiveContainer,
} from "recharts";
import type { CycleTimeRow } from "@/lib/analytics-queries";
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
  data: CycleTimeRow[];
}

export function CycleTimeChart({ data }: Props) {
  const formatted = data.map((d) => ({
    stage: d.stage,
    label: stageLabel(d.stage),
    avg_days: Number(d.avg_days),
  }));

  if (data.length === 0) {
    return (
      <div className="h-[160px] flex items-center justify-center text-[11px] text-muted-foreground">
        No stage transitions in this period
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart
        layout="vertical"
        data={formatted}
        margin={{ top: 0, right: 50, left: 0, bottom: 0 }}
      >
        <XAxis
          type="number"
          tick={{ fontSize: 9, fill: "#a09db8" }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `${v}d`}
        />
        <YAxis
          type="category"
          dataKey="label"
          tick={{ fontSize: 9, fill: "#6b6785" }}
          axisLine={false}
          tickLine={false}
          width={72}
        />
        <Tooltip
          formatter={(v: number) => [`${v} days`, "Avg time in stage"]}
          contentStyle={{ fontSize: 11, borderRadius: 6, border: "0.5px solid #e2dff0" }}
        />
        <Bar dataKey="avg_days" radius={[0, 3, 3, 0]} maxBarSize={12}>
          {formatted.map((entry) => (
            <Cell key={entry.stage} fill={STAGE_COLORS[entry.stage] ?? "#a09db8"} />
          ))}
          <LabelList
            dataKey="avg_days"
            position="right"
            style={{ fontSize: 9, fontWeight: 700 }}
            formatter={(v: number) => `${v}d`}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
