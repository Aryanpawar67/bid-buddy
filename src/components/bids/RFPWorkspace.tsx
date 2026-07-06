import {
  Check, Circle, AlertTriangle, MessageSquare, Users, Activity,
  LayoutList, CheckCircle2, Sparkles, BookOpen, FileText, ArrowRight,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { Bid } from "@/lib/bid-queries";
import { useStageItems, useToggleQuestion, useToggleDeliverable, useBidTeam, useBidActivity } from "@/lib/bid-queries";
import { initials } from "@/lib/bid-constants";
import type { TabDef } from "./BidHeaderBar";

export type RFPTab = "overview" | "clarifications" | "team" | "activity_log";

export const RFP_TABS: TabDef[] = [
  { key: "overview", label: "Overview", icon: LayoutList },
  { key: "clarifications", label: "Clarifications (Q&A)", icon: MessageSquare },
  { key: "team", label: "Team", icon: Users },
  { key: "activity_log", label: "Activity Log", icon: Activity },
];

function daysLeft(deadline: string) {
  return Math.ceil((new Date(deadline).getTime() - Date.now()) / 86400000);
}

function avatarColor(name: string): string {
  const colors = ["#491AEB", "#0891b2", "#16a34a", "#d97706", "#dc2626", "#7c3aed", "#db2777"];
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  return colors[Math.abs(hash) % colors.length];
}

const STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  done:        { bg: "#dcfce7", color: "#15803d", label: "Completed" },
  in_progress: { bg: "#dbeafe", color: "#1d4ed8", label: "In Progress" },
  blocked:     { bg: "#fef9c3", color: "#854d0e", label: "Review" },
  pending:     { bg: "var(--color-muted)", color: "var(--color-muted-foreground)", label: "Pending" },
};

export function RFPWorkspace({ bid, activeTab }: { bid: Bid; activeTab: string }) {
  const items = useStageItems(bid.id, "rfp");
  const { data: team = [] } = useBidTeam(bid.id);
  const { data: activity = [] } = useBidActivity(bid.id);

  const deliverables = items.data?.deliverables ?? [];
  const questions = items.data?.questions ?? [];
  const toggleQ = useToggleQuestion();
  const toggleD = useToggleDeliverable();

  const totalSections = deliverables.length;
  const completedSections = deliverables.filter((d) => d.status === "done").length;
  const inProgressSections = deliverables.filter((d) => d.status === "in_progress").length;
  const pendingSections = deliverables.filter((d) => d.status === "pending").length;
  const pct = totalSections ? Math.round((completedSections / totalSections) * 100) : 0;

  const dl = daysLeft(bid.deadline);
  const health = pct >= 70 ? "On Track" : pct >= 40 ? "Needs Attention" : "At Risk";
  const healthColor = pct >= 70 ? "#16a34a" : pct >= 40 ? "#d97706" : "#dc2626";
  const healthBg = pct >= 70 ? "#dcfce7" : pct >= 40 ? "#fef9c3" : "#fee2e2";

  if (activeTab === "clarifications") {
    return (
      <div className="px-6 py-5 max-w-[900px]">
        <div className="mb-4 p-3.5 rounded-xl bg-primary/5 border hairline border-primary/20 flex items-start gap-3">
          <Sparkles className="size-4 text-primary shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="text-[12.5px] font-semibold text-primary">Use RFx Responder to answer these questions</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              The AI agent can search your Knowledge Hub and draft precise answers to customer clarifications.
            </div>
          </div>
          <Link
            to="/ai"
            className="h-8 px-3.5 rounded-md bg-primary text-primary-foreground text-[11px] font-semibold hover:opacity-90 transition-opacity shrink-0 inline-flex items-center gap-1.5"
          >
            Open RFx Responder <ArrowRight className="size-3" />
          </Link>
        </div>

        <div className="bg-card hairline border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b hairline border-border">
            <h3 className="text-[13px] font-semibold">Customer Clarifications</h3>
            <span className="text-[11px] text-muted-foreground">
              {questions.filter(q => q.status === "done").length}/{questions.length} answered
            </span>
          </div>
          {questions.length === 0 ? (
            <div className="py-10 text-center text-[12px] text-muted-foreground">No clarification questions added yet.</div>
          ) : (
            <ul className="divide-y hairline divide-border">
              {questions.map((q, i) => {
                const done = q.status === "done";
                const inProg = q.status === "in_progress";
                return (
                  <li key={q.id} className="flex items-start gap-3 px-4 py-3 hover:bg-muted/20 transition-colors">
                    <span className="text-[10px] text-muted-foreground w-5 shrink-0 mt-0.5">{i + 1}</span>
                    <button
                      onClick={() => toggleQ.mutate({ id: q.id, status: done ? "pending" : "done" })}
                      className={[
                        "size-[18px] rounded-full flex items-center justify-center shrink-0 mt-0.5 hairline border transition-colors",
                        done ? "bg-success-soft border-[#97C459]" : inProg ? "border-[#f59e0b] bg-yellow-50" : "border-dashed border-border-strong",
                      ].join(" ")}
                    >
                      {done && <Check className="size-3 text-success-foreground" strokeWidth={2.5} />}
                      {inProg && <div className="size-2 rounded-full bg-yellow-400" />}
                      {!done && !inProg && <Circle className="size-2 text-muted-foreground/40" />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className={`text-[12.5px] leading-snug ${done ? "line-through text-muted-foreground" : ""}`}>
                        {q.question_text}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={[
                          "text-[9px] font-semibold px-1.5 py-0.5 rounded",
                          done ? "bg-success-soft text-success-foreground" : inProg ? "bg-blue-100 text-blue-700" : "bg-muted text-muted-foreground"
                        ].join(" ")}>
                          {done ? "Answered" : inProg ? "Drafting" : "Pending"}
                        </span>
                        {q.assigned_team && (
                          <span className="text-[10px] text-muted-foreground">{q.assigned_team.replace(/_/g, " ")}</span>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    );
  }

  if (activeTab === "team") {
    return (
      <div className="px-6 py-5 max-w-[700px]">
        <div className="bg-card hairline border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b hairline border-border">
            <h3 className="text-[13px] font-semibold">Proposal Team</h3>
          </div>
          {team.length === 0 ? (
            <div className="py-10 text-center text-[12px] text-muted-foreground">No team members assigned yet.</div>
          ) : (
            <ul className="divide-y hairline divide-border">
              {team.map((m) => (
                <li key={m.user_id} className="flex items-center gap-3 px-4 py-3">
                  <div
                    className="size-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0"
                    style={{ background: avatarColor(m.full_name) }}
                  >
                    {initials(m.full_name)}
                  </div>
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium leading-tight">{m.full_name}</div>
                    <div className="text-[11px] text-muted-foreground">{m.email}</div>
                  </div>
                  <span className="ml-auto text-[10px] font-semibold px-2 py-0.5 rounded bg-primary/10 text-primary capitalize">
                    {m.role.replace(/_/g, " ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  if (activeTab === "activity_log") {
    return (
      <div className="px-6 py-5 max-w-[700px]">
        <div className="bg-card hairline border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b hairline border-border">
            <h3 className="text-[13px] font-semibold">Activity Log</h3>
          </div>
          {activity.length === 0 ? (
            <div className="py-10 text-center text-[12px] text-muted-foreground">No activity recorded yet.</div>
          ) : (
            <ul className="divide-y hairline divide-border">
              {activity.map((e: any) => (
                <li key={e.id} className="flex gap-3 px-4 py-3">
                  <div className="size-1.5 rounded-full bg-primary mt-2 shrink-0" />
                  <div>
                    <div className="text-[12px]">{e.action}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{e.profiles?.full_name ?? "System"}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  // Overview tab
  return (
    <div className="px-6 py-5 max-w-[1100px]">
      {/* Stats row */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        {/* Progress donut */}
        <div className="col-span-1 bg-card hairline border rounded-xl p-4 flex flex-col items-center justify-center gap-2">
          <svg width="80" height="80" viewBox="0 0 80 80">
            <circle cx="40" cy="40" r="34" fill="none" stroke="var(--color-muted)" strokeWidth="7" />
            <circle
              cx="40" cy="40" r="34" fill="none"
              stroke="#fd5b0e" strokeWidth="7"
              strokeDasharray={`${(pct / 100) * 213.6} 213.6`}
              strokeLinecap="round"
              transform="rotate(-90 40 40)"
              style={{ transition: "stroke-dasharray .5s ease" }}
            />
            <text x="40" y="44" textAnchor="middle" fontSize="16" fontWeight="800" fill="currentColor">{pct}%</text>
          </svg>
          <div className="text-[10px] text-muted-foreground text-center">
            <span className="text-foreground font-semibold">{completedSections}</span> of {totalSections} done
          </div>
        </div>

        {/* Proposal Details */}
        <div className="col-span-2 bg-card hairline border rounded-xl p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">Proposal Details</div>
          <div className="grid grid-cols-2 gap-y-2">
            <KV label="Due Date" value={bid.deadline ? new Date(bid.deadline).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" }) : "—"} />
            <KV label="Time Remaining" value={dl < 0 ? `${Math.abs(dl)}d over` : `${dl}d left`} urgent={dl <= 5} />
            <KV label="Total Sections" value={String(totalSections)} />
            <KV label="Clarifications" value={String(questions.length)} />
            <KV label="In Progress" value={String(inProgressSections)} />
            <KV label="Pending" value={String(pendingSections)} />
          </div>
        </div>

        {/* Proposal Health */}
        <div className="col-span-1 bg-card hairline border rounded-xl p-4 flex flex-col gap-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Proposal Health</div>
          <span
            className="self-start text-[11px] font-bold px-2.5 py-1 rounded-full"
            style={{ background: healthBg, color: healthColor }}
          >
            {health}
          </span>
          <div className="flex flex-col gap-1.5 mt-auto">
            <HealthCheck label="Sections assigned" ok={totalSections > 0} />
            <HealthCheck label="On submission schedule" ok={pct >= 40} />
            <HealthCheck label="Deadline not overdue" ok={dl >= 0} />
            <HealthCheck label="Clarifications addressed" ok={questions.length === 0 || questions.filter(q => q.status === "done").length / questions.length >= 0.5} />
          </div>
        </div>
      </div>

      {/* AI Command Center strip — RFP is tightly linked to the AI */}
      <div
        className="mb-5 rounded-xl p-4 border hairline"
        style={{ background: "linear-gradient(135deg, rgba(73,26,235,.07) 0%, rgba(253,91,14,.06) 100%)", borderColor: "rgba(73,26,235,.2)" }}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="size-9 rounded-lg bg-primary flex items-center justify-center shrink-0">
              <Sparkles className="size-4 text-white" />
            </div>
            <div>
              <div className="text-[13px] font-bold">RFx Responder</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                Generate proposals, answer clarifications, and search your Knowledge Hub with AI.
              </div>
            </div>
          </div>
          <Link
            to="/ai"
            className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-[12px] font-semibold hover:opacity-90 transition-opacity shrink-0 inline-flex items-center gap-2"
          >
            Open RFx Responder <ArrowRight className="size-3.5" />
          </Link>
        </div>

        <div className="grid grid-cols-3 gap-2 mt-3">
          {[
            { icon: FileText, label: "Generate Proposal Draft", desc: "AI-authored from your template" },
            { icon: MessageSquare, label: "Answer Clarifications", desc: `${questions.filter(q => q.status !== "done").length} pending questions` },
            { icon: BookOpen, label: "Search Knowledge Hub", desc: "Find relevant past proposals" },
          ].map((action) => (
            <Link
              key={action.label}
              to="/ai"
              className="flex items-center gap-2.5 p-2.5 rounded-lg bg-card/80 hairline border border-border hover:bg-card transition-colors"
            >
              <div className="size-7 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                <action.icon className="size-3.5 text-primary" />
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-semibold leading-tight">{action.label}</div>
                <div className="text-[10px] text-muted-foreground">{action.desc}</div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Proposal Sections (deliverables) */}
      <div className="bg-card hairline border rounded-xl overflow-hidden mb-4">
        <div className="flex items-center justify-between px-4 py-3 border-b hairline border-border">
          <h3 className="text-[13px] font-semibold">Proposal Sections</h3>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <LegendDot color="#16a34a" label={`${completedSections} completed`} />
              <LegendDot color="#1d4ed8" label={`${inProgressSections} in progress`} />
              <LegendDot color="var(--color-border-strong)" label={`${pendingSections} pending`} />
            </div>
          </div>
        </div>

        {deliverables.length === 0 ? (
          <div className="py-10 text-center text-[12px] text-muted-foreground">No proposal sections added yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="text-left px-4 py-2.5 font-medium w-8">#</th>
                  <th className="text-left px-4 py-2.5 font-medium">Section</th>
                  <th className="text-left px-4 py-2.5 font-medium">Type</th>
                  <th className="text-center px-4 py-2.5 font-medium w-28">Status</th>
                  <th className="text-left px-4 py-2.5 font-medium w-40">Progress</th>
                  <th className="text-left px-4 py-2.5 font-medium w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y hairline divide-border">
                {deliverables.map((d, i) => {
                  const done = d.status === "done";
                  const s = STATUS_STYLE[d.status] ?? STATUS_STYLE.pending;
                  const progWidth = done ? 100 : d.status === "in_progress" ? 50 : 0;
                  return (
                    <tr key={d.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3 text-muted-foreground">{i + 1}</td>
                      <td className="px-4 py-3 font-medium">{d.label}</td>
                      <td className="px-4 py-3 text-muted-foreground capitalize">{d.type}</td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className="text-[9px] font-semibold px-2 py-1 rounded-full"
                          style={{ background: s.bg, color: s.color }}
                        >
                          {s.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{ width: `${progWidth}%`, background: s.color }}
                            />
                          </div>
                          <span className="text-[10px] text-muted-foreground w-8 text-right">{progWidth}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => toggleD.mutate({ id: d.id, status: done ? "pending" : "done" })}
                          className="size-6 rounded flex items-center justify-center hover:bg-muted transition-colors"
                          title={done ? "Mark pending" : "Mark done"}
                        >
                          {done
                            ? <CheckCircle2 className="size-3.5 text-success-foreground" />
                            : <Circle className="size-3.5 text-muted-foreground" />}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Proposal Metrics row */}
      {totalSections > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <MetricCard
            title="Completion"
            items={[
              { label: "Total Sections", value: String(totalSections) },
              { label: "Completed", value: String(completedSections), color: "#16a34a" },
              { label: "In Progress", value: String(inProgressSections), color: "#1d4ed8" },
              { label: "Pending", value: String(pendingSections), color: "var(--color-muted-foreground)" },
            ]}
          />
          <MetricCard
            title="Clarifications"
            items={[
              { label: "Total Questions", value: String(questions.length) },
              { label: "Answered", value: String(questions.filter(q => q.status === "done").length), color: "#16a34a" },
              { label: "Pending", value: String(questions.filter(q => q.status !== "done").length), color: "#d97706" },
            ]}
          />
          <div className="bg-card hairline border rounded-xl p-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">Review Timeline</div>
            {[
              { label: "SME Review", done: completedSections >= totalSections * 0.3 },
              { label: "Internal Review", done: completedSections >= totalSections * 0.6 },
              { label: "Executive Review", done: completedSections >= totalSections * 0.8 },
              { label: "Final Submission", done: completedSections === totalSections },
            ].map((step) => (
              <div key={step.label} className="flex items-center gap-2 py-1.5">
                {step.done
                  ? <CheckCircle2 className="size-3.5 text-success-foreground shrink-0" />
                  : <Circle className="size-3.5 text-muted-foreground/40 shrink-0" />}
                <span className={`text-[11px] ${step.done ? "text-foreground" : "text-muted-foreground"}`}>{step.label}</span>
                <span className="ml-auto text-[9px] font-medium" style={{ color: step.done ? "#16a34a" : "var(--color-muted-foreground)" }}>
                  {step.done ? "Done" : "Pending"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function KV({ label, value, urgent }: { label: string; value: string; urgent?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className={`text-[12px] font-semibold ${urgent ? "text-[oklch(0.5_0.22_25)]" : ""}`}>{value}</span>
    </div>
  );
}

function HealthCheck({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px]">
      {ok
        ? <CheckCircle2 className="size-3.5 text-success-foreground shrink-0" />
        : <AlertTriangle className="size-3.5 text-warning-foreground shrink-0" />}
      <span className={ok ? "text-foreground" : "text-warning-foreground"}>{label}</span>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="size-2 rounded-full shrink-0" style={{ background: color }} />
      <span>{label}</span>
    </div>
  );
}

function MetricCard({ title, items }: { title: string; items: { label: string; value: string; color?: string }[] }) {
  return (
    <div className="bg-card hairline border rounded-xl p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">{title}</div>
      <div className="flex flex-col gap-2">
        {items.map((item) => (
          <div key={item.label} className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">{item.label}</span>
            <span className="text-[13px] font-bold" style={{ color: item.color ?? "var(--color-foreground)" }}>
              {item.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
