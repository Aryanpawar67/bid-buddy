import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import {
  LayoutGrid,
  DollarSign,
  TrendingUp,
  CalendarCheck,
  AlertCircle,
} from "lucide-react";
import { useBids, useMyQueue, useRecentActivity, type Bid, type ActivityEntry } from "@/lib/bid-queries";
import { useCurrentUser } from "@/lib/auth";
import {
  fmtMoney,
  stageLabel,
  urgencyClass,
  STAGES,
  type StageKey,
} from "@/lib/bid-constants";

export const Route = createFileRoute("/_app/dashboard")({
  component: DashboardPage,
});

const C = {
  primary:  "#491AEB",
  accent:   "#FD5B0E",
  success:  "#27C084",
  warning:  "#F59E0B",
  danger:   "#EF4444",
  muted:    "#A09DB8",
};

const STAGE_COLORS = [
  "#491AEB", "#7c5af0", "#FD5B0E", "#F59E0B",
  "#27C084", "#EF4444", "#0891b2", "#A09DB8",
];

type KpiStats = {
  activeCount: number;
  pipelineValue: number;
  pendingReviews: number;
  approvalsAwaiting: number;
};

function computeKpi(bids: Bid[]): KpiStats {
  const active = bids.filter((b) => b.status === "active");
  const now = new Date().getTime();
  const pendingReviews = active.filter((b) => {
    const days = Math.ceil((new Date(b.deadline).getTime() - now) / 86400000);
    return days <= 7 && days >= 0;
  }).length;
  const approvalsAwaiting = active.filter(
    (b) => b.gonogo_decision === null && b.stage !== "deal_qualification",
  ).length;
  return {
    activeCount: active.length,
    pipelineValue: active.reduce((s, b) => s + (b.value ?? 0), 0),
    pendingReviews,
    approvalsAwaiting,
  };
}

type FunnelStage = {
  key: string;
  label: string;
  num: number;
  count: number;
  value: number;
  pct: number;
};

function computeFunnel(bids: Bid[]): FunnelStage[] {
  const active = bids.filter((b) => b.status === "active");
  const total = active.length || 1;
  return STAGES.map((s, i) => {
    const here = active.filter((b) => b.stage === s.key);
    return {
      key: s.key,
      label: s.short,
      num: i + 1,
      count: here.length,
      value: here.reduce((sum, b) => sum + (b.value ?? 0), 0),
      pct: Math.round((here.length / total) * 100),
    };
  });
}

function healthOf(deadline: string): { label: string; color: string } {
  const days = Math.ceil((new Date(deadline).getTime() - new Date().getTime()) / 86400000);
  if (days < 3)  return { label: "Critical", color: C.danger };
  if (days <= 7) return { label: "At Risk",  color: C.warning };
  return          { label: "Healthy",  color: C.success };
}

const NEXT_ACTION: Record<StageKey, string> = {
  deal_qualification: "Go/No-Go Review",
  rfi:                "RFI Response",
  rfp:                "RFP Review",
  orals:              "CXO Presentation",
  due_diligence:      "Due Diligence",
  bafo:               "BAFO Submission",
  contract_closure:   "Legal Review",
  post_closure:       "Contract Signed",
};

function relativeTime(dateStr: string): string {
  const diff = new Date().getTime() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function fmtAction(entry: ActivityEntry): string {
  const client = entry.bids?.client_name ?? "A bid";
  const a = entry.action;
  if (a === "created") return `${client} — new bid created`;
  if (a === "stage_changed") return `${client} — stage updated`;
  if (a === "gonogo_scored") return `${client} — Go/No-Go scored`;
  if (a === "submitted") return `${client} — submitted`;
  if (a === "won") return `${client} — marked won`;
  if (a === "lost") return `${client} — marked lost`;
  return `${client} — ${a.replace(/_/g, " ")}`;
}

function notifStyle(action: string): { emoji: string; bg: string } {
  if (action === "created") return { emoji: "📄", bg: "#ede9fd" };
  if (action === "won") return { emoji: "✅", bg: "#edfaf4" };
  if (action === "lost") return { emoji: "⚠️", bg: "#fff1f1" };
  return { emoji: "🔔", bg: "#fff0e8" };
}

function DashboardPage() {
  const { data: bids = [], isLoading } = useBids();
  const { user } = useCurrentUser();
  const { data: activity = [] } = useRecentActivity(4);
  const { data: queueData } = useMyQueue(user?.id);

  const kpi    = useMemo(() => computeKpi(bids), [bids]);
  const funnel = useMemo(() => computeFunnel(bids), [bids]);

  const topBids = useMemo(
    () =>
      bids
        .filter((b) => b.status === "active")
        .sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime())
        .slice(0, 5),
    [bids],
  );

  const myTasks = useMemo(() => {
    const questions = (queueData?.questions ?? []).map((q) => ({
      id: q.id,
      label: q.question_text ?? "Question",
      due_date: q.due_date,
      status: q.status,
    }));
    const deliverables = (queueData?.deliverables ?? []).map((d) => ({
      id: d.id,
      label: d.label ?? "Deliverable",
      due_date: d.due_date,
      status: d.status,
    }));
    return [...questions, ...deliverables]
      .filter((i) => i.status !== "done")
      .slice(0, 4);
  }, [queueData]);

  const donutData = useMemo(
    () =>
      funnel
        .filter((f) => f.count > 0)
        .map((f) => ({ name: f.label, value: f.count, color: STAGE_COLORS[f.num - 1] ?? STAGE_COLORS[0] })),
    [funnel],
  );

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center text-[12px] text-muted-foreground">
        Loading…
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="px-5 py-5 flex flex-col gap-[18px]">

        <div className="grid grid-cols-5 gap-3">
          <KpiCard
            icon={LayoutGrid}
            iconBg="#ede9fd"
            iconColor={C.primary}
            label="Total Active Pursuits"
            value={kpi.activeCount}
            delta="vs last month"
            deltaUp
          />
          <KpiCard
            icon={DollarSign}
            iconBg="#fff0e8"
            iconColor={C.accent}
            label="Pipeline Value"
            value={fmtMoney(kpi.pipelineValue)}
            delta="vs last month"
            deltaUp
          />
          <KpiCard
            icon={TrendingUp}
            iconBg="#edfaf4"
            iconColor={C.success}
            label="Win Rate"
            value="—"
            delta="no closed deals yet"
            deltaUp={false}
          />
          <KpiCard
            icon={CalendarCheck}
            iconBg="#fffbeb"
            iconColor={C.warning}
            label="Pending Reviews"
            value={kpi.pendingReviews}
            delta="due within 7 days"
            deltaUp={false}
          />
          <KpiCard
            icon={AlertCircle}
            iconBg="#fff1f1"
            iconColor={C.danger}
            label="Approvals Awaiting"
            value={kpi.approvalsAwaiting}
            delta="go/no-go pending"
            deltaUp={false}
          />
        </div>

        <div className="bg-card hairline border border-border-strong rounded-xl p-3.5">
          <div className="text-[13px] font-semibold mb-3">Pursuit Pipeline</div>
          <div className="grid grid-cols-8 rounded-[8px] border hairline border-border-strong overflow-hidden">
            {funnel.map((f) => (
              <Link
                key={f.key}
                to="/pipeline"
                className="border-r hairline border-border-strong last:border-r-0 p-2.5 text-center hover:bg-background transition-colors"
              >
                <div className="text-[9px] text-muted-foreground mb-0.5">{f.num}</div>
                <div className="text-[10px] font-semibold text-muted-foreground mb-1.5 truncate">{f.label}</div>
                <div className="text-[20px] font-bold text-foreground leading-none mb-1.5">{f.count}</div>
                <div className="text-[11px] font-semibold text-primary mb-px">{fmtMoney(f.value)}</div>
                <div className="text-[10px] text-muted-foreground">{f.pct}%</div>
              </Link>
            ))}
          </div>
        </div>

        <div className="flex gap-3.5 items-start">

          <div className="flex-1 min-w-0 bg-card hairline border border-border-strong rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b hairline border-border">
              <span className="text-[13px] font-semibold">Top Active Pursuits</span>
              <Link to="/pipeline" className="text-[11px] text-primary hover:underline">
                View All →
              </Link>
            </div>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {["Opportunity", "Stage", "Value", "Win Prob.", "Health", "Owner", "Next Action"].map((h) => (
                    <th
                      key={h}
                      className="px-3 py-2 text-left text-[10px] uppercase tracking-[0.06em] text-muted-foreground border-b hairline border-border font-medium whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {topBids.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-[12px] text-muted-foreground text-center">
                      No active bids yet.
                    </td>
                  </tr>
                ) : (
                  topBids.map((b) => <PursuitRow key={b.id} bid={b} />)
                )}
              </tbody>
            </table>
          </div>

          <div className="w-[300px] shrink-0 flex flex-col gap-3">

            <div className="bg-card hairline border border-border-strong rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-3.5 py-3 border-b hairline border-border">
                <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Notifications</span>
                <Link to="/notifications" className="text-[10px] text-primary font-medium hover:underline">View All</Link>
              </div>
              {activity.length === 0 ? (
                <div className="px-3.5 py-4 text-[11px] text-muted-foreground">No recent activity.</div>
              ) : (
                activity.map((entry) => {
                  const s = notifStyle(entry.action);
                  return (
                    <div key={entry.id} className="flex gap-2.5 px-3.5 py-2.5 border-b hairline border-border last:border-b-0 items-start">
                      <div className="size-7 rounded-[8px] flex items-center justify-center text-[13px] shrink-0 mt-px" style={{ background: s.bg }}>
                        {s.emoji}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] text-foreground leading-[1.4]">{fmtAction(entry)}</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">{relativeTime(entry.created_at)}</div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="bg-card hairline border border-border-strong rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-3.5 py-3 border-b hairline border-border">
                <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">My Tasks</span>
                <Link to="/queue" className="text-[10px] text-primary font-medium hover:underline">View All</Link>
              </div>
              {myTasks.length === 0 ? (
                <div className="px-3.5 py-4 text-[11px] text-muted-foreground">All caught up!</div>
              ) : (
                myTasks.map((t) => (
                  <div key={t.id} className="flex items-start gap-2 px-3.5 py-2 border-b hairline border-border last:border-b-0">
                    <div className="size-3.5 rounded-[3px] border-[1.5px] border-border-strong shrink-0 mt-[2px]" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] text-foreground leading-[1.4] truncate">{t.label}</div>
                      {t.due_date && (
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          Due {new Date(t.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

          </div>
        </div>

        <div className="grid grid-cols-2 gap-3.5">

          <div className="bg-card hairline border border-border-strong rounded-xl p-3.5">
            <div className="flex items-start justify-between mb-2">
              <div>
                <div className="text-[13px] font-semibold">Win Rate Trend</div>
                <div className="text-[10px] text-muted-foreground">Sample data — real trend after first closed deals</div>
              </div>
              <Link to="/analytics" className="text-[11px] text-primary hover:underline shrink-0">View Report →</Link>
            </div>
            <WinRateChart />
          </div>

          <div className="bg-card hairline border border-border-strong rounded-xl p-3.5">
            <div className="flex items-start justify-between mb-2">
              <div>
                <div className="text-[13px] font-semibold">Stage Distribution</div>
                <div className="text-[10px] text-muted-foreground">Active pursuits by pipeline stage</div>
              </div>
              <Link to="/analytics" className="text-[11px] text-primary hover:underline shrink-0">View Report →</Link>
            </div>
            <StageDonut data={donutData} total={bids.filter((b) => b.status === "active").length} />
          </div>

        </div>

        <div className="h-16" />
      </div>
    </div>
  );
}

function KpiCard({
  icon: Icon,
  iconBg,
  iconColor,
  label,
  value,
  delta,
  deltaUp,
}: {
  icon: React.ElementType;
  iconBg: string;
  iconColor: string;
  label: string;
  value: string | number;
  delta: string;
  deltaUp: boolean;
}) {
  return (
    <div className="bg-card hairline border border-border-strong rounded-xl p-3.5 flex items-start gap-3">
      <div className="size-10 rounded-full flex items-center justify-center shrink-0" style={{ background: iconBg }}>
        <Icon className="size-5" style={{ color: iconColor }} strokeWidth={1.5} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground mb-0.5">{label}</div>
        <div className="text-[26px] font-bold leading-none text-foreground">{value}</div>
        <div className={`text-[10px] mt-1 ${deltaUp ? "text-success" : "text-muted-foreground"}`}>{delta}</div>
      </div>
    </div>
  );
}

function PursuitRow({ bid: b }: { bid: Bid }) {
  const u = urgencyClass(b.deadline);
  const health = healthOf(b.deadline);
  const winProb = b.gonogo_score !== null ? `${b.gonogo_score}%` : "—";
  const winProbColor =
    b.gonogo_score === null ? "text-muted-foreground"
    : b.gonogo_score >= 70 ? "text-success font-semibold"
    : b.gonogo_score >= 50 ? "text-warning font-semibold"
    : "text-danger font-semibold";

  return (
    <tr className="border-b hairline border-border last:border-b-0 hover:bg-background">
      <td className="px-3 py-2.5 align-middle">
        <div className="text-[12px] font-medium">{b.title}</div>
        <div className="text-[10px] text-muted-foreground mt-0.5">{b.client_name}</div>
      </td>
      <td className="px-3 py-2.5 align-middle whitespace-nowrap">
        <StagePill stage={b.stage} />
      </td>
      <td className="px-3 py-2.5 align-middle text-[12px] font-semibold whitespace-nowrap">
        {fmtMoney(b.value ?? 0)}
      </td>
      <td className={`px-3 py-2.5 align-middle text-[12px] whitespace-nowrap ${winProbColor}`}>
        {winProb}
      </td>
      <td className="px-3 py-2.5 align-middle whitespace-nowrap">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full shrink-0" style={{ background: health.color }} />
          <span className="text-[11px]" style={{ color: health.color }}>{health.label}</span>
        </span>
      </td>
      <td className="px-3 py-2.5 align-middle">
        <div
          className="size-6 rounded-full flex items-center justify-center text-[9px] font-semibold text-white"
          style={{ background: C.muted }}
        >
          —
        </div>
      </td>
      <td className="px-3 py-2.5 align-middle">
        <div className="text-[11px] text-muted-foreground max-w-[110px] leading-[1.3]">
          {NEXT_ACTION[b.stage as StageKey] ?? "—"}
        </div>
        <div className={`text-[10px] mt-0.5 ${u.className}`}>{u.label}</div>
      </td>
    </tr>
  );
}

const STAGE_PILL_STYLE: Partial<Record<StageKey, string>> = {
  deal_qualification: "bg-primary-soft text-primary",
  rfi:               "bg-primary-soft text-primary",
  rfp:               "bg-primary-soft text-primary",
  orals:             "bg-[rgba(73,26,235,0.08)] text-primary",
  due_diligence:     "bg-accent-soft text-accent",
  bafo:              "bg-accent-soft text-accent",
  contract_closure:  "bg-success-soft text-success",
  post_closure:      "bg-success-soft text-success",
};

function StagePill({ stage }: { stage: string }) {
  const style = STAGE_PILL_STYLE[stage as StageKey] ?? "bg-muted text-muted-foreground";
  return (
    <span className={`inline-flex items-center px-2 py-[3px] rounded-full text-[10px] font-semibold whitespace-nowrap ${style}`}>
      {stageLabel(stage)}
    </span>
  );
}

function WinRateChart() {
  return (
    <div className="h-[160px] relative overflow-hidden">
      <svg viewBox="0 0 460 160" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
        <line x1="0" y1="120" x2="460" y2="120" stroke="#eee" strokeWidth="0.5" />
        <line x1="0" y1="90"  x2="460" y2="90"  stroke="#eee" strokeWidth="0.5" />
        <line x1="0" y1="60"  x2="460" y2="60"  stroke="#eee" strokeWidth="0.5" />
        <line x1="0" y1="30"  x2="460" y2="30"  stroke="#eee" strokeWidth="0.5" />
        <text x="0" y="124" fill="#a09db8" fontSize="9">0</text>
        <text x="0" y="94"  fill="#a09db8" fontSize="9">20</text>
        <text x="0" y="64"  fill="#a09db8" fontSize="9">40</text>
        <text x="0" y="34"  fill="#a09db8" fontSize="9">60</text>
        <text x="32"  y="148" fill="#a09db8" fontSize="9" textAnchor="middle">Dec</text>
        <text x="112" y="148" fill="#a09db8" fontSize="9" textAnchor="middle">Jan</text>
        <text x="192" y="148" fill="#a09db8" fontSize="9" textAnchor="middle">Feb</text>
        <text x="272" y="148" fill="#a09db8" fontSize="9" textAnchor="middle">Mar</text>
        <text x="352" y="148" fill="#a09db8" fontSize="9" textAnchor="middle">Apr</text>
        <text x="428" y="148" fill="#a09db8" fontSize="9" textAnchor="middle">May</text>
        <defs>
          <linearGradient id="winGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#491AEB" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#491AEB" stopOpacity="0.01" />
          </linearGradient>
        </defs>
        <path d="M32,96 L112,84 L192,102 L272,78 L352,66 L428,52 L428,120 L32,120 Z" fill="url(#winGrad)" />
        <polyline points="32,96 112,84 192,102 272,78 352,66 428,52" fill="none" stroke="#491AEB" strokeWidth="2" strokeLinejoin="round" />
        <circle cx="32"  cy="96"  r="3.5" fill="#491AEB" />
        <circle cx="112" cy="84"  r="3.5" fill="#491AEB" />
        <circle cx="192" cy="102" r="3.5" fill="#491AEB" />
        <circle cx="272" cy="78"  r="3.5" fill="#491AEB" />
        <circle cx="352" cy="66"  r="3.5" fill="#491AEB" />
        <circle cx="428" cy="52"  r="5"   fill="#491AEB" />
        <rect x="390" y="34" width="38" height="16" rx="4" fill="#491AEB" />
        <text x="409" y="45" fill="white" fontSize="9.5" fontWeight="700" textAnchor="middle">37%</text>
      </svg>
    </div>
  );
}

type DonutSlice = { name: string; value: number; color: string };

function StageDonut({ data, total }: { data: DonutSlice[]; total: number }) {
  if (data.length === 0) {
    return (
      <div className="h-[160px] flex items-center justify-center text-[11px] text-muted-foreground">
        No active bids
      </div>
    );
  }
  return (
    <div className="flex items-center gap-5 h-[160px]">
      <ResponsiveContainer width={140} height={140}>
        <PieChart>
          <Pie data={data} cx="50%" cy="50%" innerRadius={46} outerRadius={68} dataKey="value" strokeWidth={0}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.color} />
            ))}
          </Pie>
          <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} formatter={(v: number) => [v, "bids"]} />
        </PieChart>
      </ResponsiveContainer>
      <div className="flex flex-col gap-1.5 text-[11px] flex-1 min-w-0">
        {data.map((d) => (
          <div key={d.name} className="flex items-center gap-1.5">
            <div className="size-2 rounded-full shrink-0" style={{ background: d.color }} />
            <span className="text-muted-foreground truncate flex-1">{d.name}</span>
            <span className="font-semibold text-foreground shrink-0">{d.value}</span>
            <span className="text-muted-foreground text-[10px] shrink-0">({Math.round((d.value / (total || 1)) * 100)}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}
