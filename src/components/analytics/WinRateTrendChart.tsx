import { format } from "date-fns";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { WinRateTrendRow } from "@/lib/analytics-queries";

interface Props {
  data: WinRateTrendRow[];
}

export function WinRateTrendChart({ data }: Props) {
  const formatted = data.map((d) => ({
    month: format(new Date(d.month), "MMM"),
    win_rate: Number(d.win_rate),
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
      <AreaChart data={formatted} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
        <defs>
          <linearGradient id="winGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#491AEB" stopOpacity={0.15} />
            <stop offset="100%" stopColor="#491AEB" stopOpacity={0.01} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#e8e6f0" vertical={false} />
        <XAxis
          dataKey="month"
          tick={{ fontSize: 10, fill: "#a09db8" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 10, fill: "#a09db8" }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `${v}%`}
          domain={[0, 100]}
          width={32}
        />
        <Tooltip
          formatter={(v: number) => [`${v}%`, "Win Rate"]}
          contentStyle={{ fontSize: 11, borderRadius: 6, border: "0.5px solid #e2dff0" }}
        />
        <Area
          type="monotone"
          dataKey="win_rate"
          stroke="#491AEB"
          strokeWidth={2}
          fill="url(#winGradient)"
          dot={{ r: 3, fill: "#491AEB", strokeWidth: 0 }}
          activeDot={{ r: 5, fill: "#491AEB" }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
