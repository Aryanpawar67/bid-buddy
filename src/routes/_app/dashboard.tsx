import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import {
  LayoutGrid,
  DollarSign,
  CalendarCheck,
  AlertCircle,
  Flame,
  ChevronRight,
  Clock,
} from "lucide-react";
import {
  useBids,
  useMyQueue,
  useRecentActivity,
  type Bid,
  type ActivityEntry,
} from "@/lib/bid-queries";
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

// ── Constants ─────────────────────────────────────────────────────────────────

const C = {
  primary: "#491AEB",
  accent:  "#FD5B0E",
  success: "#27C084",
  warning: "#F59E0B",
  danger:  "#EF4444",
};

const STAGE_COLORS: Partial<Record<string, string>> = {
  deal_qualification: "#491AEB",
  rfi:               "#7c5af0",
  rfp:               "#9d77f5",
  orals:             "#FD5B0E",
  due_diligence:     "#F59E0B",
  bafo:              "#fb923c",
  contract_closure:  "#27C084",
  post_closure:      "#059669",
};

const NEXT_ACTION: Record<StageKey, string> = {
  deal_qualification: "Go/No-Go Review",
  rfi:               "RFI Response",
  rfp:               "RFP Review",
  orals:             "CXO Presentation",
  due_diligence:     "Due Diligence",
  bafo:              "BAFO Submission",
  contract_closure:  "Legal Review",
  post_closure:      "Contract Signed",
};

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

// ── Utilities ─────────────────────────────────────────────────────────────────

function daysUntil(deadline: string): number {
  return Math.ceil((new Date(deadline).getTime() - Date.now()) / 86400000);
}

function urgencyDot(days: number): { color: string; label: string } {
  if (days < 0)  return { color: C.danger,  label: "Overdue" };
  if (days <= 2) return { color: C.danger,  label: `${days}d left` };
  if (days <= 7) return { color: C.warning, label: `${days}d left` };
  return               { color: C.success, label: `${days}d left` };
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function fmtAction(entry: ActivityEntry): string {
  const client = entry.bids?.client_name ?? "A bid";
  const a = entry.action;
  if (a === "created")       return `${client} — new bid created`;
  if (a === "stage_changed") return `${client} — stage updated`;
  if (a === "gonogo_scored") return `${client} — Go/No-Go scored`;
  if (a === "submitted")     return `${client} — submitted`;
  if (a === "won")           return `${client} — marked won`;
  if (a === "lost")          return `${client} — marked lost`;
  return `${client} — ${a.replace(/_/g, " ")}`;
}

function notifStyle(action: string): { emoji: string; bg: string } {
  if (action === "created") return { emoji: "📄", bg: "#ede9fd" };
  if (action === "won")     return { emoji: "✅", bg: "#edfaf4" };
  if (action === "lost")    return { emoji: "⚠️", bg: "#fff1f1" };
  return                          { emoji: "🔔", bg: "#fff0e8" };
}

// ── Page ──────────────────────────────────────────────────────────────────────

function DashboardPage() {
  const { data: bids = [], isLoading } = useBids();
  const { user, profile } = useCurrentUser();
  const { data: activity = [] } = useRecentActivity(5);
  const { data: queueData } = useMyQueue(user?.id);

  const activeBids   = useMemo(() => bids.filter(b => b.status === "active"), [bids]);
  const pipelineValue = useMemo(() => activeBids.reduce((s, b) => s + (b.value ?? 0), 0), [activeBids]);
  const dueThisWeek  = useMemo(() => activeBids.filter(b => { const d = daysUntil(b.deadline); return d >= 0 && d <= 7; }).length, [activeBids]);
  const needsAttention = useMemo(() => activeBids.filter(b => b.gonogo_decision === null && b.stage !== "deal_qualification").length, [activeBids]);

  // Today's Focus — deadline-urgency sorted
  const focusBids = useMemo(
    () => [...activeBids].sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime()).slice(0, 6),
    [activeBids],
  );

  // Top Pursuits — highest value
  const topValueBids = useMemo(
    () => [...activeBids].sort((a, b) => (b.value ?? 0) - (a.value ?? 0)).slice(0, 5),
    [activeBids],
  );

  // Revenue at risk — deadline ≤ 7 days
  const atRiskBids = useMemo(
    () => [...activeBids].filter(b => { const d = daysUntil(b.deadline); return d >= 0 && d <= 7; })
      .sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime())
      .slice(0, 4),
    [activeBids],
  );

  // Funnel
  const funnel = useMemo(() => STAGES.map(s => {
    const here = activeBids.filter(b => b.stage === s.key);
    return { key: s.key, short: s.short, count: here.length, value: here.reduce((sum, b) => sum + (b.value ?? 0), 0) };
  }), [activeBids]);

  const myTasks = useMemo(() => {
    const qs = (queueData?.questions ?? []).map(q => ({ id: q.id, label: q.question_text ?? "Question", due_date: q.due_date, status: q.status }));
    const ds = (queueData?.deliverables ?? []).map(d => ({ id: d.id, label: d.label ?? "Deliverable", due_date: d.due_date, status: d.status }));
    return [...qs, ...ds].filter(i => i.status !== "done").slice(0, 5);
  }, [queueData]);

  const firstName  = profile?.full_name?.split(" ")[0] ?? "there";
  const todayLabel = new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center text-[12px] text-muted-foreground">
        Loading…
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="px-5 py-5 flex flex-col gap-4 max-w-[1440px]">

        {/* ── Welcome ── */}
        <div className="bg-card hairline border rounded-xl px-5 py-4 flex items-center justify-between gap-6">
          <div>
            <div className="text-[15px] font-medium">Good to see you, {firstName}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">{todayLabel}</div>
          </div>
          <div className="flex items-center gap-5 shrink-0">
            <WelcomeStat label="Active bids" value={activeBids.length} />
            <div className="h-6 w-px bg-border" />
            <WelcomeStat label="Pipeline" value={fmtMoney(pipelineValue)} />
            <div className="h-6 w-px bg-border" />
            <WelcomeStat label="Due this week" value={dueThisWeek} warn={dueThisWeek > 0} />
            {needsAttention > 0 && (
              <>
                <div className="h-6 w-px bg-border" />
                <WelcomeStat label="Needs attention" value={needsAttention} danger />
              </>
            )}
          </div>
        </div>

        {/* ── KPI strip ── */}
        <div className="grid grid-cols-4 gap-3">
          <KpiCard icon={LayoutGrid}     iconBg="#ede9fd" iconColor={C.primary}  label="Active Pursuits"  value={activeBids.length}        sub="in pipeline" />
          <KpiCard icon={DollarSign}     iconBg="#fff0e8" iconColor={C.accent}   label="Pipeline Value"   value={fmtMoney(pipelineValue)}  sub="total active" />
          <KpiCard icon={CalendarCheck}  iconBg="#fffbeb" iconColor={C.warning}  label="Due This Week"    value={dueThisWeek}              sub="within 7 days"  warn={dueThisWeek > 0} />
          <KpiCard icon={AlertCircle}    iconBg="#fff1f1" iconColor={C.danger}   label="Needs Attention"  value={needsAttention}           sub="go/no-go pending" warn={needsAttention > 0} />
        </div>

        {/* ── Today's Focus + Funnel ── */}
        <div className="grid grid-cols-[1fr_300px] gap-3.5 items-start">
          <TodaysFocus bids={focusBids} />
          <PipelineFunnel funnel={funnel} />
        </div>

        {/* ── Top Pursuits by value ── */}
        <div className="bg-card hairline border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b hairline border-border">
            <span className="text-[13px] font-medium">Top Pursuits by Value</span>
            <Link to="/pipeline" className="text-[11px] text-primary hover:underline inline-flex items-center gap-0.5">
              View all <ChevronRight className="size-3" />
            </Link>
          </div>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {["Opportunity", "Stage", "Value", "Win Prob.", "Health", "Next Action"].map(h => (
                  <th key={h} className="px-3 py-2 text-left text-[10px] uppercase tracking-[0.06em] text-muted-foreground border-b hairline border-border font-medium whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {topValueBids.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-[12px] text-muted-foreground text-center">No active bids yet.</td>
                </tr>
              ) : (
                topValueBids.map(b => <PursuitRow key={b.id} bid={b} />)
              )}
            </tbody>
          </table>
        </div>

        {/* ── Bottom row ── */}
        <div className="grid grid-cols-3 gap-3.5">
          <RevenueAtRisk bids={atRiskBids} />
          <RecentActivityCard activity={activity} />
          <MyTasksCard tasks={myTasks} />
        </div>

        <div className="h-8" />
      </div>
    </div>
  );
}

// ── Welcome stat ──────────────────────────────────────────────────────────────

function WelcomeStat({ label, value, warn, danger }: { label: string; value: string | number; warn?: boolean; danger?: boolean }) {
  return (
    <div className="text-center">
      <div className={`text-[20px] font-semibold leading-none tabular-nums ${danger ? "text-danger" : warn ? "text-warning-foreground" : "text-foreground"}`}>
        {value}
      </div>
      <div className="text-[10px] text-muted-foreground mt-0.5">{label}</div>
    </div>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────────

function KpiCard({ icon: Icon, iconBg, iconColor, label, value, sub, warn }: {
  icon: React.ElementType;
  iconBg: string;
  iconColor: string;
  label: string;
  value: string | number;
  sub: string;
  warn?: boolean;
}) {
  return (
    <div className="bg-card hairline border rounded-xl p-3.5 flex items-start gap-3">
      <div className="size-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: iconBg }}>
        <Icon className="size-[18px]" style={{ color: iconColor }} strokeWidth={1.5} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground">{label}</div>
        <div className="text-[24px] font-bold leading-tight text-foreground mt-0.5">{value}</div>
        <div className={`text-[10px] ${warn ? "text-warning-foreground" : "text-muted-foreground"}`}>{sub}</div>
      </div>
    </div>
  );
}

// ── Today's Focus ─────────────────────────────────────────────────────────────

function TodaysFocus({ bids }: { bids: Bid[] }) {
  return (
    <div className="bg-card hairline border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b hairline border-border">
        <span className="text-[13px] font-medium">Today's Focus</span>
        <span className="text-[10px] text-muted-foreground">Sorted by deadline urgency</span>
      </div>
      {bids.length === 0 ? (
        <div className="px-4 py-8 text-[12px] text-muted-foreground text-center">No active bids.</div>
      ) : (
        <ul className="divide-y hairline divide-border">
          {bids.map(b => {
            const days = daysUntil(b.deadline);
            const dot  = urgencyDot(days);
            return (
              <li key={b.id}>
                <Link to="/pipeline" className="flex items-center gap-3 px-4 py-2.5 hover:bg-background transition-colors">
                  <div className="size-2 rounded-full shrink-0" style={{ background: dot.color }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-medium truncate">{b.title}</div>
                    <div className="text-[10px] text-muted-foreground">{b.client_name}</div>
                  </div>
                  <StagePill stage={b.stage} />
                  <div className="text-right shrink-0 w-[84px]">
                    <div className="text-[12px] font-semibold">{fmtMoney(b.value)}</div>
                    <div className="text-[10px] font-medium mt-0.5" style={{ color: dot.color }}>{dot.label}</div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ── Pipeline Funnel ───────────────────────────────────────────────────────────

function PipelineFunnel({ funnel }: { funnel: { key: string; short: string; count: number; value: number }[] }) {
  const maxCount = Math.max(...funnel.map(f => f.count), 1);
  const total    = funnel.reduce((s, f) => s + f.count, 0);
  return (
    <div className="bg-card hairline border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3.5">
        <span className="text-[13px] font-medium">Pipeline Funnel</span>
        <span className="text-[11px] text-muted-foreground">{total} active</span>
      </div>
      <div className="space-y-2.5">
        {funnel.map(f => (
          <Link key={f.key} to="/pipeline" className="flex items-center gap-2.5 group">
            <div className="text-[11px] text-muted-foreground group-hover:text-foreground transition-colors w-[72px] shrink-0 truncate">
              {f.short}
            </div>
            <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${(f.count / maxCount) * 100}%`,
                  background: STAGE_COLORS[f.key] ?? C.primary,
                  opacity: f.count === 0 ? 0.25 : 1,
                }}
              />
            </div>
            <div className="text-[11px] font-semibold text-foreground w-4 text-right shrink-0">{f.count}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ── Revenue at Risk ───────────────────────────────────────────────────────────

function RevenueAtRisk({ bids }: { bids: Bid[] }) {
  return (
    <div className="bg-card hairline border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-3.5 py-3 border-b hairline border-border">
        <div className="flex items-center gap-1.5">
          <Flame className="size-3.5 text-danger" />
          <span className="text-[13px] font-medium">Revenue at Risk</span>
        </div>
        <Link to="/pipeline" className="text-[11px] text-primary hover:underline">View all</Link>
      </div>
      {bids.length === 0 ? (
        <div className="px-3.5 py-6 text-[12px] text-muted-foreground text-center">No bids at risk this week.</div>
      ) : (
        <ul className="divide-y hairline divide-border">
          {bids.map(b => {
            const days = daysUntil(b.deadline);
            const isCritical = days <= 2;
            return (
              <li key={b.id} className="px-3.5 py-2.5">
                <div className="flex items-start justify-between gap-3 mb-1.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-medium truncate">{b.title}</div>
                    <div className="text-[10px] text-muted-foreground">{b.client_name}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[12px] font-semibold">{fmtMoney(b.value)}</div>
                    <div className={`text-[10px] font-medium mt-0.5 ${isCritical ? "text-danger" : "text-warning-foreground"}`}>
                      {days <= 0 ? "Overdue" : `${days}d left`}
                    </div>
                  </div>
                </div>
                <StagePill stage={b.stage} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ── Recent Activity ───────────────────────────────────────────────────────────

function RecentActivityCard({ activity }: { activity: ActivityEntry[] }) {
  return (
    <div className="bg-card hairline border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-3.5 py-3 border-b hairline border-border">
        <span className="text-[13px] font-medium">Recent Activity</span>
        <Link to="/notifications" className="text-[11px] text-primary hover:underline">View all</Link>
      </div>
      {activity.length === 0 ? (
        <div className="px-3.5 py-6 text-[12px] text-muted-foreground">No recent activity.</div>
      ) : (
        <ul className="divide-y hairline divide-border">
          {activity.map(entry => {
            const s = notifStyle(entry.action);
            return (
              <li key={entry.id} className="flex gap-2.5 px-3.5 py-2.5 items-start">
                <div className="size-6 rounded-[6px] flex items-center justify-center text-[11px] shrink-0 mt-px" style={{ background: s.bg }}>
                  {s.emoji}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] text-foreground leading-snug">{fmtAction(entry)}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{relativeTime(entry.created_at)}</div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ── My Tasks ──────────────────────────────────────────────────────────────────

function MyTasksCard({ tasks }: { tasks: { id: string; label: string; due_date: string | null; status: string }[] }) {
  return (
    <div className="bg-card hairline border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-3.5 py-3 border-b hairline border-border">
        <span className="text-[13px] font-medium">My Tasks</span>
        <Link to="/queue" className="text-[11px] text-primary hover:underline">View all</Link>
      </div>
      {tasks.length === 0 ? (
        <div className="px-3.5 py-6 text-[12px] text-muted-foreground text-center">All caught up!</div>
      ) : (
        <ul className="divide-y hairline divide-border">
          {tasks.map(t => (
            <li key={t.id} className="flex items-start gap-2.5 px-3.5 py-2.5">
              <div className="size-3.5 rounded-[3px] border-[1.5px] border-border-strong shrink-0 mt-[2px]" />
              <div className="min-w-0 flex-1">
                <div className="text-[11px] text-foreground leading-snug truncate">{t.label}</div>
                {t.due_date && (
                  <div className="flex items-center gap-1 mt-0.5 text-[10px] text-muted-foreground">
                    <Clock className="size-2.5" />
                    {new Date(t.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Pursuit Row ───────────────────────────────────────────────────────────────

function PursuitRow({ bid: b }: { bid: Bid }) {
  const u    = urgencyClass(b.deadline);
  const days = daysUntil(b.deadline);
  const health =
    days < 3   ? { label: "Critical", color: C.danger  }
    : days <= 7 ? { label: "At Risk",  color: C.warning }
    :             { label: "Healthy",  color: C.success };
  const winProbColor =
    b.gonogo_score === null ? "text-muted-foreground"
    : b.gonogo_score >= 70  ? "text-success font-semibold"
    : b.gonogo_score >= 50  ? "text-warning-foreground font-semibold"
    :                         "text-danger font-semibold";

  return (
    <tr className="border-b hairline border-border last:border-b-0 hover:bg-background transition-colors">
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
        {b.gonogo_score !== null ? `${b.gonogo_score}%` : "—"}
      </td>
      <td className="px-3 py-2.5 align-middle whitespace-nowrap">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full shrink-0" style={{ background: health.color }} />
          <span className="text-[11px]" style={{ color: health.color }}>{health.label}</span>
        </span>
      </td>
      <td className="px-3 py-2.5 align-middle">
        <div className="text-[11px] text-muted-foreground max-w-[120px] leading-snug">
          {NEXT_ACTION[b.stage as StageKey] ?? "—"}
        </div>
        <div className={`text-[10px] mt-0.5 ${u.className}`}>{u.label}</div>
      </td>
    </tr>
  );
}

// ── Stage Pill ────────────────────────────────────────────────────────────────

function StagePill({ stage }: { stage: string }) {
  const style = STAGE_PILL_STYLE[stage as StageKey] ?? "bg-muted text-muted-foreground";
  return (
    <span className={`inline-flex items-center px-2 py-[3px] rounded-full text-[10px] font-semibold whitespace-nowrap ${style}`}>
      {stageLabel(stage)}
    </span>
  );
}
