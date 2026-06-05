import type { TeamPerformanceRow } from "@/lib/analytics-queries";
import { fmtMoney, initials } from "@/lib/bid-constants";

interface Props {
  data: TeamPerformanceRow[];
  loading?: boolean;
}

function WinRateBar({ pct }: { pct: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-[80px] h-[5px] rounded-full bg-[#f0eef8]">
        <div
          className="h-[5px] rounded-full bg-[#491AEB]"
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <span className="text-[10px] font-semibold text-[#491AEB]">{pct}%</span>
    </div>
  );
}

export function TeamPerformanceTable({ data, loading }: Props) {
  if (loading) {
    return (
      <div className="animate-pulse">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-10 border-b border-[#f0eef8] bg-white" />
        ))}
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="py-6 text-center text-[11px] text-muted-foreground">
        No team data for this period
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr>
            {["Member", "Active Bids", "Closed", "Won", "Win Rate", "Pipeline Value", "Avg Cycle"].map((h) => (
              <th
                key={h}
                className="px-2.5 py-1.5 text-left text-[9px] uppercase tracking-[0.06em] text-muted-foreground border-b border-[#f0eef8] font-medium whitespace-nowrap"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.user_id} className="border-b border-[#f0eef8] last:border-b-0 hover:bg-[#faf9fd]">
              <td className="px-2.5 py-2">
                <div className="flex items-center gap-2">
                  <div className="w-[22px] h-[22px] rounded-full bg-[#491AEB] text-white text-[8px] font-bold flex items-center justify-center flex-shrink-0">
                    {initials(row.display_name ?? "")}
                  </div>
                  <span className="font-medium">{row.display_name}</span>
                </div>
              </td>
              <td className="px-2.5 py-2">{row.active_bids}</td>
              <td className="px-2.5 py-2">{row.closed_count}</td>
              <td className="px-2.5 py-2 font-semibold text-[#27C084]">{row.won_count}</td>
              <td className="px-2.5 py-2">
                <WinRateBar pct={Number(row.win_rate)} />
              </td>
              <td className="px-2.5 py-2 font-semibold">{fmtMoney(Number(row.pipeline_value))}</td>
              <td className="px-2.5 py-2 text-muted-foreground">
                {row.avg_cycle_days != null ? `${row.avg_cycle_days}d` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
