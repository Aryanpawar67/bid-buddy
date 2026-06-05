import { format } from "date-fns";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Cell, LabelList, ResponsiveContainer,
} from "recharts";
import type { MonthlyIntakeRow } from "@/lib/analytics-queries";

interface Props {
  data: MonthlyIntakeRow[];
}

export function MonthlyIntakeChart({ data }: Props) {
  const total = data.length;
  const formatted = data.map((d, i) => ({
    month: format(new Date(d.month), "MMM"),
    new_bids: Number(d.new_bids),
    recent: i >= total - 3,
  }));

  if (data.length === 0) {
    return (
      <div className="h-[160px] flex items-center justify-center text-[11px] text-muted-foreground">
        No bids created in this period
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={formatted} margin={{ top: 20, right: 10, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e8e6f0" vertical={false} />
        <XAxis
          dataKey="month"
          tick={{ fontSize: 10, fill: "#a09db8" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 9, fill: "#a09db8" }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
          width={24}
        />
        <Tooltip
          formatter={(v: number) => [v, "New Bids"]}
          contentStyle={{ fontSize: 11, borderRadius: 6, border: "0.5px solid #e2dff0" }}
        />
        <Bar dataKey="new_bids" radius={[3, 3, 0, 0]} maxBarSize={40}>
          {formatted.map((entry, i) => (
            <Cell key={i} fill={entry.recent ? "#491AEB" : "#ede9fd"} />
          ))}
          <LabelList
            dataKey="new_bids"
            position="top"
            style={{ fontSize: 9, fontWeight: 600 }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
