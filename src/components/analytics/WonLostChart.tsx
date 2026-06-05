import { format } from "date-fns";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from "recharts";
import type { WonLostRow } from "@/lib/analytics-queries";
import { fmtMoney } from "@/lib/bid-constants";

interface Props {
  data: WonLostRow[];
}

export function WonLostChart({ data }: Props) {
  const formatted = data.map((d) => ({
    month: format(new Date(d.month), "MMM"),
    Won: Number(d.won_value),
    Lost: Number(d.lost_value),
  }));

  if (data.length === 0) {
    return (
      <div className="h-[160px] flex items-center justify-center text-[11px] text-muted-foreground">
        No closed bids in this period
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={formatted} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
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
          tickFormatter={(v) => fmtMoney(v)}
          width={38}
        />
        <Tooltip
          formatter={(v: number, name) => [fmtMoney(v), name]}
          contentStyle={{ fontSize: 11, borderRadius: 6, border: "0.5px solid #e2dff0" }}
        />
        <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4 }} iconSize={8} iconType="rect" />
        <Bar dataKey="Won" fill="#491AEB" radius={[2, 2, 0, 0]} maxBarSize={20} />
        <Bar dataKey="Lost" fill="#EF4444" fillOpacity={0.7} radius={[2, 2, 0, 0]} maxBarSize={20} />
      </BarChart>
    </ResponsiveContainer>
  );
}
