import { Check, Circle, AlertTriangle, MessageSquare, Users, FileText, Activity, LayoutList, Clock, CheckCircle2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { Bid } from "@/lib/bid-queries";
import { useStageItems, useToggleQuestion, useToggleDeliverable, useBidTeam, useBidActivity } from "@/lib/bid-queries";
import { initials } from "@/lib/bid-constants";
import type { TabDef } from "./BidHeaderBar";

export type RFITab = "overview" | "questionnaire" | "team" | "activity_log";

export const RFI_TABS: TabDef[] = [
  { key: "overview", label: "Overview", icon: LayoutList },
  { key: "questionnaire", label: "Questionnaire", icon: MessageSquare },
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

export function RFIWorkspace({ bid, activeTab }: { bid: Bid; activeTab: string }) {
  const items = useStageItems(bid.id, "rfi");
  const { data: team = [] } = useBidTeam(bid.id);
  const { data: activity = [] } = useBidActivity(bid.id);

  const questions = items.data?.questions ?? [];
  const deliverables = items.data?.deliverables ?? [];
  const toggleQ = useToggleQuestion();
  const toggleD = useToggleDeliverable();

  const total = questions.length;
  const answered = questions.filter((q) => q.status === "done").length;
  const inProgress = questions.filter((q) => q.status === "in_progress").length;
  const pending = questions.filter((q) => q.status === "pending" || q.status === "blocked").length;
  const pct = total ? Math.round((answered / total) * 100) : 0;

  const dl = daysLeft(bid.deadline);
  const health = pct >= 70 ? "On Track" : pct >= 40 ? "Needs Attention" : "At Risk";
  const healthColor = pct >= 70 ? "#16a34a" : pct >= 40 ? "#d97706" : "#dc2626";
  const healthBg = pct >= 70 ? "#dcfce7" : pct >= 40 ? "#fef9c3" : "#fee2e2";

  if (activeTab === "questionnaire") {
    return (
      <div className="px-6 py-5 max-w-[900px]">
        <div className="bg-card hairline border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b hairline border-border">
            <h3 className="text-[13px] font-semibold">RFI Questions</h3>
            <span className="text-[11px] text-muted-foreground">{answered}/{total} answered</span>
          </div>
          {questions.length === 0 ? (
            <div className="py-10 text-center text-[12px] text-muted-foreground">No questions added for this stage yet.</div>
          ) : (
            <ul className="divide-y hairline divide-border">
              {questions.map((q, i) => (
                <QuestionRow key={q.id} num={i + 1} question={q} onToggle={(next) => toggleQ.mutate({ id: q.id, status: next })} />
              ))}
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
            <h3 className="text-[13px] font-semibold">Team Members</h3>
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
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {e.profiles?.full_name ?? "System"}
                    </div>
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
              stroke="var(--color-primary)" strokeWidth="7"
              strokeDasharray={`${(pct / 100) * 213.6} 213.6`}
              strokeLinecap="round"
              transform="rotate(-90 40 40)"
              style={{ transition: "stroke-dasharray .5s ease" }}
            />
            <text x="40" y="44" textAnchor="middle" fontSize="16" fontWeight="800" fill="currentColor">{pct}%</text>
          </svg>
          <div className="text-[10px] text-muted-foreground text-center leading-snug">
            <span className="text-foreground font-semibold">{answered}</span> of {total} answered
          </div>
        </div>

        {/* RFI Details */}
        <div className="col-span-2 bg-card hairline border rounded-xl p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">RFI Details</div>
          <div className="grid grid-cols-2 gap-y-2">
            <KV label="Due Date" value={bid.deadline ? new Date(bid.deadline).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" }) : "—"} />
            <KV label="Time Remaining" value={dl < 0 ? `${Math.abs(dl)}d over` : `${dl}d left`} urgent={dl <= 5} />
            <KV label="Total Questions" value={String(total)} />
            <KV label="Answered" value={String(answered)} />
            <KV label="In Progress" value={String(inProgress)} />
            <KV label="Pending" value={String(pending)} />
          </div>
        </div>

        {/* Health */}
        <div className="col-span-1 bg-card hairline border rounded-xl p-4 flex flex-col gap-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">RFI Health</div>
          <span
            className="self-start text-[11px] font-bold px-2.5 py-1 rounded-full"
            style={{ background: healthBg, color: healthColor }}
          >
            {health}
          </span>
          <div className="flex flex-col gap-1.5 mt-auto">
            <HealthCheck label="Questions assigned" ok={total > 0} />
            <HealthCheck label="Responses on schedule" ok={pct >= 40} />
            <HealthCheck label="Deadline not overdue" ok={dl >= 0} />
          </div>
        </div>
      </div>

      {/* Team strip */}
      {team.length > 0 && (
        <div className="bg-card hairline border rounded-xl p-4 mb-4 flex items-center gap-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold shrink-0">Team</div>
          <div className="flex items-center gap-2 flex-wrap">
            {team.slice(0, 6).map((m) => (
              <div
                key={m.user_id}
                title={`${m.full_name} · ${m.role.replace(/_/g, " ")}`}
                className="size-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 cursor-default"
                style={{ background: avatarColor(m.full_name) }}
              >
                {initials(m.full_name)}
              </div>
            ))}
            {team.length > 6 && (
              <div className="size-7 rounded-full bg-muted flex items-center justify-center text-[10px] text-muted-foreground font-semibold">
                +{team.length - 6}
              </div>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Link
              to="/ai"
              className="h-8 px-3.5 rounded-md bg-primary text-primary-foreground text-[11px] font-semibold hover:opacity-90 transition-opacity inline-flex items-center gap-1.5"
            >
              <MessageSquare className="size-3.5" />
              Open RFx Responder
            </Link>
          </div>
        </div>
      )}

      {/* Progress bars legend */}
      <div className="flex items-center gap-4 mb-3 px-1">
        <LegendDot color="#491AEB" label={`Answered (${answered})`} />
        <LegendDot color="#f59e0b" label={`In Progress (${inProgress})`} />
        <LegendDot color="var(--color-border-strong)" label={`Pending (${pending})`} />
      </div>

      {/* Questions list */}
      <div className="bg-card hairline border rounded-xl overflow-hidden mb-4">
        <div className="flex items-center justify-between px-4 py-3 border-b hairline border-border">
          <h3 className="text-[13px] font-semibold">Questions</h3>
          <span className="text-[11px] text-muted-foreground">{total} total</span>
        </div>
        {questions.length === 0 ? (
          <div className="py-8 text-center text-[12px] text-muted-foreground">No questions for this stage.</div>
        ) : (
          <ul className="divide-y hairline divide-border">
            {questions.slice(0, 8).map((q, i) => (
              <QuestionRow key={q.id} num={i + 1} question={q} onToggle={(next) => toggleQ.mutate({ id: q.id, status: next })} />
            ))}
          </ul>
        )}
        {questions.length > 8 && (
          <div className="px-4 py-2.5 border-t hairline border-border text-[11px] text-primary font-medium cursor-pointer hover:bg-muted/40">
            View all {questions.length} questions →
          </div>
        )}
      </div>

      {/* Deliverables */}
      {deliverables.length > 0 && (
        <div className="bg-card hairline border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b hairline border-border">
            <h3 className="text-[13px] font-semibold">Deliverables</h3>
            <span className="text-[11px] text-muted-foreground">
              {deliverables.filter((d) => d.status === "done").length}/{deliverables.length} done
            </span>
          </div>
          <ul className="divide-y hairline divide-border">
            {deliverables.map((d) => {
              const done = d.status === "done";
              return (
                <li key={d.id} className="flex items-start gap-3 px-4 py-3">
                  <button
                    onClick={() => toggleD.mutate({ id: d.id, status: done ? "pending" : "done" })}
                    className={[
                      "size-[18px] rounded-full flex items-center justify-center shrink-0 mt-0.5 hairline border",
                      done ? "bg-success-soft border-[#97C459]" : "border-dashed border-border-strong",
                    ].join(" ")}
                  >
                    {done ? <Check className="size-3 text-success-foreground" strokeWidth={2.5} /> : <Circle className="size-2 text-muted-foreground/40" />}
                  </button>
                  <div>
                    <div className={`text-[12.5px] ${done ? "line-through text-muted-foreground" : ""}`}>{d.label}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{d.type}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function QuestionRow({ num, question, onToggle }: {
  num: number;
  question: any;
  onToggle: (next: "pending" | "done") => void;
}) {
  const done = question.status === "done";
  const inProg = question.status === "in_progress";
  return (
    <li className="flex items-start gap-3 px-4 py-3 hover:bg-muted/20 transition-colors">
      <span className="text-[10px] text-muted-foreground w-5 shrink-0 mt-0.5">{num}</span>
      <button
        onClick={() => onToggle(done ? "pending" : "done")}
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
          {question.question_text}
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className={[
            "text-[9px] font-semibold px-1.5 py-0.5 rounded",
            done ? "bg-success-soft text-success-foreground" : inProg ? "bg-yellow-100 text-yellow-700" : "bg-muted text-muted-foreground"
          ].join(" ")}>
            {done ? "Answered" : inProg ? "In Progress" : "Pending"}
          </span>
          {question.assigned_team && (
            <span className="text-[10px] text-muted-foreground">{question.assigned_team.replace(/_/g, " ")}</span>
          )}
        </div>
      </div>
    </li>
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
    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <div className="size-2 rounded-full shrink-0" style={{ background: color }} />
      {label}
    </div>
  );
}
