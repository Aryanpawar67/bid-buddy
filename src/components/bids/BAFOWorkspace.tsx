import {
  Check, Circle, AlertTriangle, CheckCircle2,
  Users, Activity, LayoutList, FileText, DollarSign, Handshake,
} from "lucide-react";
import type { Bid } from "@/lib/bid-queries";
import { useStageItems, useToggleDeliverable, useToggleQuestion, useBidTeam, useBidActivity } from "@/lib/bid-queries";
import { initials } from "@/lib/bid-constants";
import type { TabDef } from "./BidHeaderBar";

export const BAFO_TABS: TabDef[] = [
  { key: "overview",     label: "Overview",     icon: LayoutList },
  { key: "pricing",      label: "Pricing",       icon: DollarSign },
  { key: "negotiation",  label: "Negotiation",   icon: Handshake },
  { key: "team",         label: "Team",          icon: Users },
  { key: "activity_log", label: "Activity Log",  icon: Activity },
];

function daysLeft(deadline: string) {
  return Math.ceil((new Date(deadline).getTime() - Date.now()) / 86400000);
}

function avatarColor(name: string): string {
  const colors = ["#491AEB","#0891b2","#16a34a","#d97706","#dc2626","#7c3aed","#db2777"];
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  return colors[Math.abs(hash) % colors.length];
}

const STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  done:        { bg: "#dcfce7", color: "#15803d", label: "Completed" },
  in_progress: { bg: "#dbeafe", color: "#1d4ed8", label: "In Progress" },
  blocked:     { bg: "#fef9c3", color: "#854d0e", label: "Review" },
  pending:     { bg: "var(--color-muted)", color: "var(--color-muted-foreground)", label: "Not Started" },
};

export function BAFOWorkspace({ bid, activeTab }: { bid: Bid; activeTab: string }) {
  const items     = useStageItems(bid.id, "bafo");
  const { data: team = [] }     = useBidTeam(bid.id);
  const { data: activity = [] } = useBidActivity(bid.id);
  const toggleD = useToggleDeliverable();
  const toggleQ = useToggleQuestion();

  const deliverables = items.data?.deliverables ?? [];
  const questions    = items.data?.questions    ?? [];

  const total     = deliverables.length;
  const completed = deliverables.filter(d => d.status === "done").length;
  const inProg    = deliverables.filter(d => d.status === "in_progress").length;
  const notStarted = deliverables.filter(d => d.status === "pending").length;
  const pct = total ? Math.round((completed / total) * 100) : 0;

  const dl = daysLeft(bid.deadline);
  const health = pct >= 70 ? "On Track" : pct >= 40 ? "Needs Attention" : "At Risk";
  const healthColor = pct >= 70 ? "#16a34a" : pct >= 40 ? "#d97706" : "#dc2626";
  const healthBg    = pct >= 70 ? "#dcfce7"  : pct >= 40 ? "#fef9c3"  : "#fee2e2";

  // Pricing questions = questions mentioning price/cost/commercial or all questions for the pricing tab
  const pricingItems = questions.filter(q =>
    /pric|cost|commerc|rate|discount|fee/i.test(q.question_text)
  );
  const negotiationItems = questions.filter(q =>
    /negotiat|term|clause|redline|condition/i.test(q.question_text)
  );

  if (activeTab === "pricing") {
    return (
      <div className="px-6 py-5 max-w-[900px]">
        <div className="bg-card hairline border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b hairline border-border">
            <h3 className="text-[13px] font-semibold">Pricing & Commercial Terms</h3>
            <span className="text-[11px] text-muted-foreground">
              {pricingItems.filter(q => q.status === "done").length}/{pricingItems.length || questions.length} addressed
            </span>
          </div>
          {(pricingItems.length > 0 ? pricingItems : questions).length === 0 ? (
            <div className="py-10 text-center text-[12px] text-muted-foreground">No pricing items added yet.</div>
          ) : (
            <ul className="divide-y hairline divide-border">
              {(pricingItems.length > 0 ? pricingItems : questions).map((q, i) => (
                <ItemRow key={q.id} num={i+1} label={q.question_text} status={q.status}
                  onToggle={() => toggleQ.mutate({ id: q.id, status: q.status === "done" ? "pending" : "done" })}
                  team={q.assigned_team} />
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  if (activeTab === "negotiation") {
    return (
      <div className="px-6 py-5 max-w-[900px]">
        <div className="bg-card hairline border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b hairline border-border">
            <h3 className="text-[13px] font-semibold">Negotiation Items</h3>
            <span className="text-[11px] text-muted-foreground">
              {(negotiationItems.length > 0 ? negotiationItems : questions).filter(q => q.status === "done").length} resolved
            </span>
          </div>
          {(negotiationItems.length > 0 ? negotiationItems : questions).length === 0 ? (
            <div className="py-10 text-center text-[12px] text-muted-foreground">No negotiation items added yet.</div>
          ) : (
            <ul className="divide-y hairline divide-border">
              {(negotiationItems.length > 0 ? negotiationItems : questions).map((q, i) => (
                <ItemRow key={q.id} num={i+1} label={q.question_text} status={q.status}
                  onToggle={() => toggleQ.mutate({ id: q.id, status: q.status === "done" ? "pending" : "done" })}
                  team={q.assigned_team} />
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
            <h3 className="text-[13px] font-semibold">Team</h3>
          </div>
          {team.length === 0 ? (
            <div className="py-10 text-center text-[12px] text-muted-foreground">No team members assigned yet.</div>
          ) : (
            <ul className="divide-y hairline divide-border">
              {team.map(m => (
                <li key={m.user_id} className="flex items-center gap-3 px-4 py-3">
                  <div className="size-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0"
                    style={{ background: avatarColor(m.full_name) }}>
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

  // ── Overview ────────────────────────────────────────────────────────────────
  return (
    <div className="px-6 py-5 max-w-[1100px]">
      {/* Top stats row */}
      <div className="grid grid-cols-4 gap-3 mb-5">

        {/* Progress donut */}
        <div className="bg-card hairline border rounded-xl p-4 flex flex-col items-center justify-center gap-2">
          <svg width="80" height="80" viewBox="0 0 80 80">
            <circle cx="40" cy="40" r="34" fill="none" stroke="var(--color-muted)" strokeWidth="7" />
            {/* In-progress arc */}
            <circle cx="40" cy="40" r="34" fill="none" stroke="#93c5fd" strokeWidth="7"
              strokeDasharray={`${((inProg) / (total || 1)) * 213.6} 213.6`}
              strokeDashoffset={`${-((completed) / (total || 1)) * 213.6}`}
              strokeLinecap="butt" transform="rotate(-90 40 40)" />
            {/* Completed arc */}
            <circle cx="40" cy="40" r="34" fill="none" stroke="#16a34a" strokeWidth="7"
              strokeDasharray={`${(pct / 100) * 213.6} 213.6`}
              strokeLinecap="round" transform="rotate(-90 40 40)"
              style={{ transition: "stroke-dasharray .5s ease" }} />
            <text x="40" y="40" textAnchor="middle" fontSize="15" fontWeight="800" fill="currentColor">{pct}%</text>
            <text x="40" y="53" textAnchor="middle" fontSize="8" fill="var(--color-muted-foreground)">Complete</text>
          </svg>
          <div className="flex flex-col gap-1 w-full">
            <LegendRow color="#16a34a" label="Completed" value={`${completed ? Math.round(completed/total*100) : 0}%`} />
            <LegendRow color="#93c5fd" label="In Progress" value={`${inProg ? Math.round(inProg/total*100) : 0}%`} />
            <LegendRow color="var(--color-muted-foreground)" label="Not Started" value={`${notStarted ? Math.round(notStarted/total*100) : 0}%`} />
          </div>
          <div className="text-[10px] text-warning-foreground font-medium">
            Due: {dl < 0 ? `${Math.abs(dl)}d over` : `${dl}d left`}
          </div>
        </div>

        {/* BAFO Details */}
        <div className="col-span-2 bg-card hairline border rounded-xl p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">BAFO Details</div>
          <div className="grid grid-cols-2 gap-y-2.5">
            <KV label="BAFO Due Date" value={bid.deadline ? new Date(bid.deadline).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" }) : "—"} />
            <KV label="Time Remaining" value={dl < 0 ? `${Math.abs(dl)}d over` : `${dl}d left`} urgent={dl <= 5} />
            <KV label="Sections to Update" value={String(total)} />
            <KV label="Pricing Scenarios" value={String(pricingItems.length || questions.length)} />
            <KV label="Reviews Completed" value={`${completed} / ${total}`} />
            <KV label="Value" value={`$${(bid.value / 1_000_000).toFixed(1)}M`} />
          </div>
        </div>

        {/* BAFO Health */}
        <div className="bg-card hairline border rounded-xl p-4 flex flex-col gap-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">BAFO Health</div>
          <span className="self-start text-[11px] font-bold px-2.5 py-1 rounded-full"
            style={{ background: healthBg, color: healthColor }}>{health}</span>
          <div className="flex flex-col gap-2 mt-auto">
            <HealthCheck label="Pricing updates in progress" ok={inProg > 0 || completed > 0} />
            <HealthCheck label="Internal reviews on schedule" ok={pct >= 30} />
            <HealthCheck label="Commercial negotiation active" ok={questions.length > 0} />
            <HealthCheck label="Deadline not overdue" ok={dl >= 0} />
          </div>
        </div>
      </div>

      {/* Team strip */}
      {team.length > 0 && (
        <div className="bg-card hairline border rounded-xl p-3.5 mb-5 flex items-center gap-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold shrink-0">Team</div>
          <div className="flex items-center gap-2">
            {team.slice(0, 6).map(m => (
              <div key={m.user_id} title={`${m.full_name} · ${m.role.replace(/_/g, " ")}`}
                className="size-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 cursor-default"
                style={{ background: avatarColor(m.full_name) }}>
                {initials(m.full_name)}
              </div>
            ))}
            {team.length > 6 && (
              <div className="size-7 rounded-full bg-muted flex items-center justify-center text-[10px] text-muted-foreground font-semibold">
                +{team.length - 6}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Task list */}
      <div className="bg-card hairline border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b hairline border-border bg-muted/20">
          <div>
            <h3 className="text-[13px] font-semibold">BAFO Task List</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Track BAFO tasks, pricing updates and approvals to ensure on-time submission.
            </p>
          </div>
        </div>

        {deliverables.length === 0 ? (
          <div className="py-10 text-center text-[12px] text-muted-foreground">No tasks added for this stage yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="text-left px-4 py-2.5 font-medium w-8">#</th>
                  <th className="text-left px-4 py-2.5 font-medium">Task / Activity</th>
                  <th className="text-left px-4 py-2.5 font-medium w-24">Type</th>
                  <th className="text-center px-4 py-2.5 font-medium w-28">Status</th>
                  <th className="text-left px-4 py-2.5 font-medium w-44">Progress</th>
                </tr>
              </thead>
              <tbody className="divide-y hairline divide-border">
                {deliverables.map((d, i) => {
                  const s = STATUS_STYLE[d.status] ?? STATUS_STYLE.pending;
                  const progW = d.status === "done" ? 100 : d.status === "in_progress" ? 50 : 0;
                  return (
                    <tr key={d.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3 text-muted-foreground">{i + 1}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => toggleD.mutate({ id: d.id, status: d.status === "done" ? "pending" : "done" })}
                          className="flex items-center gap-2.5 text-left group w-full"
                        >
                          <div className={[
                            "size-[16px] rounded-full flex items-center justify-center shrink-0 hairline border transition-colors",
                            d.status === "done" ? "bg-success-soft border-[#97C459]" : "border-dashed border-border-strong group-hover:border-primary/50",
                          ].join(" ")}>
                            {d.status === "done" && <Check className="size-2.5 text-success-foreground" strokeWidth={3} />}
                          </div>
                          <span className={d.status === "done" ? "line-through text-muted-foreground" : ""}>{d.label}</span>
                        </button>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground capitalize">{d.type}</td>
                      <td className="px-4 py-3 text-center">
                        <span className="text-[9px] font-semibold px-2 py-1 rounded-full"
                          style={{ background: s.bg, color: s.color }}>{s.label}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div className="h-full rounded-full transition-all"
                              style={{ width: `${progW}%`, background: s.color }} />
                          </div>
                          <span className="text-[10px] text-muted-foreground w-8 text-right">{progW}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function ItemRow({ num, label, status, onToggle, team }: {
  num: number; label: string; status: string;
  onToggle: () => void; team?: string | null;
}) {
  const done = status === "done";
  return (
    <li className="flex items-start gap-3 px-4 py-3 hover:bg-muted/20 transition-colors">
      <span className="text-[10px] text-muted-foreground w-5 shrink-0 mt-0.5">{num}</span>
      <button onClick={onToggle}
        className={["size-[18px] rounded-full flex items-center justify-center shrink-0 mt-0.5 hairline border transition-colors",
          done ? "bg-success-soft border-[#97C459]" : "border-dashed border-border-strong"].join(" ")}>
        {done ? <Check className="size-3 text-success-foreground" strokeWidth={2.5} />
               : <Circle className="size-2 text-muted-foreground/40" />}
      </button>
      <div className="flex-1 min-w-0">
        <div className={`text-[12.5px] leading-snug ${done ? "line-through text-muted-foreground" : ""}`}>{label}</div>
        {team && <div className="text-[10px] text-muted-foreground mt-0.5">{team.replace(/_/g, " ")}</div>}
      </div>
      <span className={["text-[9px] font-semibold px-1.5 py-0.5 rounded shrink-0",
        done ? "bg-success-soft text-success-foreground" : "bg-muted text-muted-foreground"].join(" ")}>
        {done ? "Done" : "Pending"}
      </span>
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
      {ok ? <CheckCircle2 className="size-3.5 text-success-foreground shrink-0" />
          : <AlertTriangle className="size-3.5 text-warning-foreground shrink-0" />}
      <span className={ok ? "text-foreground" : "text-warning-foreground"}>{label}</span>
    </div>
  );
}

function LegendRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
      <div className="size-2 rounded-full shrink-0" style={{ background: color }} />
      <span className="flex-1">{label}</span>
      <span className="font-semibold text-foreground">{value}</span>
    </div>
  );
}
