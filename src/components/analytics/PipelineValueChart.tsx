import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Cell, LabelList, ResponsiveContainer,
} from "recharts";
import type { PipelineValueRow } from "@/lib/analytics-queries";
import { stageLabel, fmtMoney } from "@/lib/bid-constants";

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
  data: PipelineValueRow[];
}

export function PipelineValueChart({ data }: Props) {
  const formatted = data.map((d) => ({
    stage: d.stage,
    label: stageLabel(d.stage).split(" ")[0],
    total_value: Number(d.total_value),
    displayValue: fmtMoney(Number(d.total_value)),
  }));

  if (data.length === 0) {
    return (
      <div className="h-[160px] flex items-center justify-center text-[11px] text-muted-foreground">
        No active bids
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={formatted} margin={{ top: 20, right: 10, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e8e6f0" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 9, fill: "#a09db8" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 9, fill: "#a09db8" }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => fmtMoney(v)}
          width={38}
        />
        <Tooltip
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          formatter={(v: number, _n: any, props: any) => [fmtMoney(v), stageLabel(props.payload.stage)]}
          contentStyle={{ fontSize: 11, borderRadius: 6, border: "0.5px solid #e2dff0" }}
        />
        <Bar dataKey="total_value" radius={[3, 3, 0, 0]}>
          {formatted.map((entry) => (
            <Cell key={entry.stage} fill={STAGE_COLORS[entry.stage] ?? "#a09db8"} />
          ))}
          <LabelList
            dataKey="displayValue"
            position="top"
            style={{ fontSize: 8, fontWeight: 700 }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
