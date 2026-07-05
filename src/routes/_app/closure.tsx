import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Trophy, XCircle, MinusCircle, TrendingUp, Clock, Search } from "lucide-react";
import { useBids } from "@/lib/bid-queries";
import { fmtMoney, initials } from "@/lib/bid-constants";
import type { Bid } from "@/lib/bid-queries";

export const Route = createFileRoute("/_app/closure")({
  component: ClosurePage,
});

type ClosureTab = "won" | "lost" | "dormant";

function ClosurePage() {
  const { data: bids = [], isLoading } = useBids();
  const [activeTab, setActiveTab] = useState<ClosureTab>("won");
  const [q, setQ] = useState("");

  const won     = useMemo(() => bids.filter((b) => b.status === "won"), [bids]);
  const lost    = useMemo(() => bids.filter((b) => b.status === "lost"), [bids]);
  const dormant = useMemo(() => bids.filter((b) => b.status === "on_hold" || b.status === "no_go"), [bids]);

  const wonValue     = won.reduce((s, b) => s + b.value, 0);
  const lostValue    = lost.reduce((s, b) => s + b.value, 0);
  const dormantValue = dormant.reduce((s, b) => s + b.value, 0);
  const totalValue   = wonValue + lostValue + dormantValue;
  const totalDeals   = won.length + lost.length + dormant.length;
  const winRate      = won.length + lost.length > 0
    ? Math.round((won.length / (won.length + lost.length)) * 100)
    : 0;

  const tabData: Record<ClosureTab, Bid[]> = { won, lost, dormant };
  const filtered = useMemo(() => {
    const list = tabData[activeTab];
    if (!q) return list;
    return list.filter((b) =>
      `${b.client_name} ${b.title}`.toLowerCase().includes(q.toLowerCase()),
    );
  }, [activeTab, won, lost, dormant, q]);

  const TABS: { key: ClosureTab; label: string; Icon: React.ElementType; color: string; count: number }[] = [
    { key: "won",     label: "Closed / Won",  Icon: Trophy,      color: "#22c55e", count: won.length },
    { key: "lost",    label: "Closed / Lost", Icon: XCircle,     color: "#ef4444", count: lost.length },
    { key: "dormant", label: "Dormant",        Icon: MinusCircle, color: "#f59e0b", count: dormant.length },
  ];

  return (
    <div className="h-full flex overflow-hidden">
      {/* Main */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="px-6 py-5 max-w-[1100px]">
          {/* Header */}
          <div className="mb-5">
            <h1 className="text-[22px] font-bold tracking-tight">Closure</h1>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              Track and analyse win, lost and dormant pursuits.
            </p>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-3 mb-5">
            <SummaryCard
              label="Won Deals"
              count={won.length}
              value={wonValue}
              color="#22c55e"
              Icon={Trophy}
            />
            <SummaryCard
              label="Lost Deals"
              count={lost.length}
              value={lostValue}
              color="#ef4444"
              Icon={XCircle}
            />
            <SummaryCard
              label="Dormant Deals"
              count={dormant.length}
              value={dormantValue}
              color="#f59e0b"
              Icon={MinusCircle}
            />
          </div>

          {/* Win rate + cycle row */}
          <div className="grid grid-cols-2 gap-3 mb-5">
            <section className="bg-card hairline border rounded-xl p-4">
              <h3 className="text-[13px] font-medium mb-3">Win Rate</h3>
              <div className="flex items-center gap-5">
                <WinRateDonut won={won.length} lost={lost.length} dormant={dormant.length} rate={winRate} />
                <div className="space-y-2 flex-1">
                  {[
                    { label: "Won",     count: won.length,     pct: totalDeals ? Math.round(won.length / totalDeals * 100) : 0,     color: "#22c55e" },
                    { label: "Lost",    count: lost.length,    pct: totalDeals ? Math.round(lost.length / totalDeals * 100) : 0,    color: "#ef4444" },
                    { label: "Dormant", count: dormant.length, pct: totalDeals ? Math.round(dormant.length / totalDeals * 100) : 0, color: "#f59e0b" },
                  ].map((r) => (
                    <div key={r.label} className="flex items-center gap-2 text-[12px]">
                      <span className="size-2 rounded-full shrink-0" style={{ background: r.color }} />
                      <span className="flex-1 text-muted-foreground">{r.label}</span>
                      <span className="font-medium">{r.count}</span>
                      <span className="text-muted-foreground">({r.pct}%)</span>
                    </div>
                  ))}
                  <div className="pt-2 border-t hairline border-border text-[11px] text-muted-foreground">
                    Total Deals: <strong className="text-foreground">{totalDeals}</strong>
                    &nbsp;·&nbsp;Total Value: <strong className="text-foreground">{fmtMoney(totalValue)}</strong>
                  </div>
                </div>
              </div>
            </section>

            <section className="bg-card hairline border rounded-xl p-4 flex flex-col gap-4">
              <h3 className="text-[13px] font-medium">Pipeline Health</h3>
              <div className="flex items-center gap-4">
                <div className="size-14 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <TrendingUp className="size-6 text-primary" strokeWidth={1.5} />
                </div>
                <div>
                  <div className="text-[28px] font-bold leading-none text-primary">{winRate}%</div>
                  <div className="text-[11px] text-muted-foreground mt-1">Overall win rate</div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-auto">
                {[
                  { label: "Won Value",  value: fmtMoney(wonValue),     color: "text-emerald-600" },
                  { label: "Lost Value", value: fmtMoney(lostValue),    color: "text-red-500" },
                  { label: "At Risk",    value: fmtMoney(dormantValue), color: "text-amber-500" },
                ].map((m) => (
                  <div key={m.label} className="bg-muted/40 rounded-lg p-2.5">
                    <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{m.label}</div>
                    <div className={`text-[13px] font-semibold mt-0.5 ${m.color}`}>{m.value}</div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* Tab + table */}
          <section className="bg-card hairline border rounded-xl overflow-hidden">
            {/* Tab bar */}
            <div className="flex border-b hairline border-border">
              {TABS.map((t) => {
                const active = activeTab === t.key;
                const Icon = t.Icon;
                return (
                  <button
                    key={t.key}
                    onClick={() => { setActiveTab(t.key); setQ(""); }}
                    className={[
                      "flex items-center gap-1.5 px-4 py-3 text-[12px] font-medium transition-colors border-b-2",
                      active
                        ? "border-primary text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground",
                    ].join(" ")}
                  >
                    <Icon className="size-3.5" style={{ color: t.color }} strokeWidth={2} />
                    {t.label}
                    <span className="ml-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                      {t.count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Search */}
            <div className="px-4 py-2.5 border-b hairline border-border">
              <div className="relative max-w-xs">
                <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search pursuits…"
                  className="w-full h-8 pl-8 pr-3 rounded-md hairline border bg-muted/30 text-[12px] outline-none focus:ring-1 focus:ring-primary/30"
                />
              </div>
            </div>

            {/* Table */}
            {isLoading ? (
              <div className="p-6 text-center text-[12px] text-muted-foreground">Loading…</div>
            ) : filtered.length === 0 ? (
              <div className="p-10 text-center text-[12px] text-muted-foreground">
                No {activeTab === "won" ? "won" : activeTab === "lost" ? "lost" : "dormant"} deals yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                      <th className="text-left px-4 py-2.5 font-medium">#</th>
                      <th className="text-left px-4 py-2.5 font-medium">Client</th>
                      <th className="text-left px-4 py-2.5 font-medium">Pursuit</th>
                      <th className="text-left px-4 py-2.5 font-medium">Type</th>
                      <th className="text-right px-4 py-2.5 font-medium">Value</th>
                      <th className="text-left px-4 py-2.5 font-medium">Deadline</th>
                      <th className="text-left px-4 py-2.5 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y hairline divide-border">
                    {filtered.map((bid, i) => (
                      <BidRow key={bid.id} bid={bid} index={i + 1} tab={activeTab} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Insights rail */}
      <InsightsRail won={won} lost={lost} dormant={dormant} />
    </div>
  );
}

function BidRow({ bid, index, tab }: { bid: Bid; index: number; tab: ClosureTab }) {
  const av = initials(bid.client_name);
  const statusStyles: Record<ClosureTab, { bg: string; color: string; label: string }> = {
    won:     { bg: "#dcfce7", color: "#15803d", label: "Won" },
    lost:    { bg: "#fee2e2", color: "#b91c1c", label: "Lost" },
    dormant: { bg: "#fef9c3", color: "#854d0e", label: bid.status === "on_hold" ? "On Hold" : "No Go" },
  };
  const st = statusStyles[tab];

  return (
    <tr className="hover:bg-muted/20 transition-colors">
      <td className="px-4 py-3 text-muted-foreground">{index}</td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="size-7 rounded-full bg-primary/10 text-primary text-[10px] font-semibold flex items-center justify-center shrink-0">
            {av}
          </div>
          <span className="font-medium">{bid.client_name}</span>
        </div>
      </td>
      <td className="px-4 py-3 text-muted-foreground max-w-[200px]">
        <span className="truncate block">{bid.title}</span>
      </td>
      <td className="px-4 py-3 text-muted-foreground uppercase">{bid.type}</td>
      <td className="px-4 py-3 text-right font-medium">{fmtMoney(bid.value)}</td>
      <td className="px-4 py-3 text-muted-foreground">
        {new Date(bid.deadline).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
      </td>
      <td className="px-4 py-3">
        <span
          className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
          style={{ background: st.bg, color: st.color }}
        >
          {st.label}
        </span>
      </td>
    </tr>
  );
}

function SummaryCard({
  label, count, value, color, Icon,
}: {
  label: string; count: number; value: number; color: string; Icon: React.ElementType;
}) {
  return (
    <section className="bg-card hairline border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[12px] text-muted-foreground">{label}</span>
        <Icon className="size-4" style={{ color }} strokeWidth={1.5} />
      </div>
      <div className="text-[32px] font-bold leading-none" style={{ color }}>{count}</div>
      <div className="text-[11px] text-muted-foreground mt-2">Total Value</div>
      <div className="text-[15px] font-semibold mt-0.5">{fmtMoney(value)}</div>
    </section>
  );
}

function WinRateDonut({ won, lost, dormant, rate }: { won: number; lost: number; dormant: number; rate: number }) {
  const total = won + lost + dormant || 1;
  const r = 44;
  const circ = 2 * Math.PI * r;
  const wonArc     = (won / total) * circ;
  const lostArc    = (lost / total) * circ;
  const dormantArc = (dormant / total) * circ;
  let offset = 0;

  const segments = [
    { arc: wonArc,     color: "#22c55e" },
    { arc: lostArc,    color: "#ef4444" },
    { arc: dormantArc, color: "#f59e0b" },
  ];

  return (
    <svg viewBox="0 0 100 100" className="size-[100px] shrink-0">
      <circle cx="50" cy="50" r={r} fill="none" stroke="var(--color-muted)" strokeWidth="10" />
      {segments.map((seg, i) => {
        const el = (
          <circle
            key={i}
            cx="50" cy="50" r={r}
            fill="none"
            stroke={seg.color}
            strokeWidth="10"
            strokeDasharray={`${seg.arc} ${circ - seg.arc}`}
            strokeDashoffset={-offset}
            transform="rotate(-90 50 50)"
          />
        );
        offset += seg.arc;
        return el;
      })}
      <text x="50" y="46" textAnchor="middle" dominantBaseline="middle" style={{ fontSize: 18, fontWeight: 800, fill: "var(--color-foreground)" }}>
        {rate}%
      </text>
      <text x="50" y="60" textAnchor="middle" dominantBaseline="middle" style={{ fontSize: 8, fill: "var(--color-muted-foreground)" }}>
        Win Rate
      </text>
    </svg>
  );
}

function InsightsRail({ won, lost, dormant }: { won: Bid[]; lost: Bid[]; dormant: Bid[] }) {
  const WIN_REASONS  = ["Solution Fit", "Value Proposition", "Relationship", "Competitive Edge", "Trust / Brand"];
  const LOSS_REASONS = ["Budget Constraints", "Lost to Competitor", "No Decision", "Scope Mismatch", "Timing"];
  const DORM_REASONS = ["No Response", "Internal Priority Shift", "Budget On Hold", "Stakeholder Change"];

  function mockBars(items: string[], total: number, color: string) {
    const n = Math.max(total, 1);
    return items.slice(0, 4).map((label, i) => {
      const count = Math.max(1, Math.round(n * [0.43, 0.29, 0.14, 0.14][i]));
      const pct   = Math.round((count / n) * 100);
      return { label, count, pct, color };
    });
  }

  const winBars  = mockBars(WIN_REASONS,  won.length,     "#22c55e");
  const lossBars = mockBars(LOSS_REASONS, lost.length,    "#ef4444");
  const dormBars = mockBars(DORM_REASONS, dormant.length, "#f59e0b");

  return (
    <aside className="w-[260px] shrink-0 bg-card hairline border-l border-border overflow-y-auto">
      <div className="p-4 border-b hairline border-border">
        <h3 className="text-[13px] font-semibold">Closure Insights</h3>
        <p className="text-[10px] text-muted-foreground mt-0.5">Placeholder — logic coming soon</p>
      </div>

      <InsightSection title="Top Win Reasons" bars={winBars} empty={won.length === 0} />
      <InsightSection title="Top Loss Reasons" bars={lossBars} empty={lost.length === 0} />
      <InsightSection title="Dormant Reasons" bars={dormBars} empty={dormant.length === 0} />

      {/* Quick actions */}
      <div className="p-4 border-t hairline border-border">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-3">Quick Actions</div>
        <div className="space-y-2">
          {[
            "Create Closure Report",
            "View Win / Loss Trends",
            "Lessons Learned",
            "Re-engage Dormant Deals",
          ].map((label) => (
            <button
              key={label}
              className="w-full text-left px-3 py-2 rounded-lg hairline border bg-muted/30 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}

function InsightSection({
  title, bars, empty,
}: {
  title: string;
  bars: { label: string; count: number; pct: number; color: string }[];
  empty: boolean;
}) {
  return (
    <div className="p-4 border-b hairline border-border">
      <div className="text-[11px] font-semibold mb-3">{title}</div>
      {empty ? (
        <p className="text-[10px] text-muted-foreground">No data yet.</p>
      ) : (
        <div className="space-y-2.5">
          {bars.map((b) => (
            <div key={b.label}>
              <div className="flex justify-between text-[10px] mb-1">
                <span className="text-muted-foreground truncate">{b.label}</span>
                <span className="font-medium ml-2 shrink-0">{b.count} ({b.pct}%)</span>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${b.pct}%`, background: b.color }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
