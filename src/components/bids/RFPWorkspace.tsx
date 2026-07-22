import { useState } from "react";
import {
  Circle, Users, Activity,
  LayoutList, CheckCircle2, ArrowRight, UserPlus, X, Loader2, ChevronRight,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { Bid } from "@/lib/bid-queries";
import { useStageItems, useToggleDeliverable, useBidTeam, useBidActivity, useTeamMembers } from "@/lib/bid-queries";
import { initials } from "@/lib/bid-constants";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AdvanceStageFooter } from "./AdvanceStageFooter";
import type { TabDef } from "./BidHeaderBar";
import { ProposalModal } from "@/components/ai/ProposalModal";
import { useAiSessions, useCreateAiSession } from "@/lib/ai-queries";
import { useCurrentUser } from "@/lib/auth";
import type { ProposalPreview } from "@/lib/api/generate-proposal";

export type RFPTab = "overview" | "team" | "activity_log";

export const RFP_TABS: TabDef[] = [
  { key: "overview", label: "Overview", icon: LayoutList },
  { key: "team", label: "Team", icon: Users },
  { key: "activity_log", label: "Activity Log", icon: Activity },
];

function daysLeft(deadline: string) {
  return Math.ceil((new Date(deadline).getTime() - Date.now()) / 86400000);
}

const STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  done:        { bg: "#dcfce7", color: "#15803d", label: "Completed" },
  in_progress: { bg: "#dbeafe", color: "#1d4ed8", label: "In Progress" },
  blocked:     { bg: "#fef9c3", color: "#854d0e", label: "Review" },
  pending:     { bg: "var(--color-muted)", color: "var(--color-muted-foreground)", label: "Pending" },
};

export function RFPWorkspace({ bid, activeTab, onTabChange }: { bid: Bid; activeTab: string; onTabChange: (t: string) => void }) {
  const items = useStageItems(bid.id, "rfp");
  const { data: team = [] } = useBidTeam(bid.id);
  const { data: activity = [] } = useBidActivity(bid.id);

  // Generate Proposal
  const { data: sessions = [] } = useAiSessions(bid.id);
  const createSession = useCreateAiSession();
  const { user, primaryRole } = useCurrentUser();
  const canGenerateProposal = primaryRole === "pre_sales" || primaryRole === "admin";
  const [proposalOpen, setProposalOpen] = useState(false);
  const [proposalSessionId, setProposalSessionId] = useState<string | null>(null);
  const [creatingSession, setCreatingSession] = useState(false);

  // Proposal preview — persisted in sessionStorage keyed by bidId
  const [proposalPreview, setProposalPreview] = useState<ProposalPreview | null>(() => {
    try {
      const s = sessionStorage.getItem(`rfp_preview_${bid.id}`);
      return s ? JSON.parse(s) : null;
    } catch { return null; }
  });

  async function openProposalModal() {
    let sessionId = sessions[0]?.id ?? null;
    if (!sessionId) {
      setCreatingSession(true);
      try {
        const s = await createSession.mutateAsync({ bidId: bid.id, userId: user!.id, model: "claude-sonnet-4-6" });
        sessionId = s.id;
      } finally {
        setCreatingSession(false);
      }
    }
    setProposalSessionId(sessionId);
    setProposalOpen(true);
  }

  function handleProposalGenerated(preview: ProposalPreview) {
    setProposalPreview(preview);
    try { sessionStorage.setItem(`rfp_preview_${bid.id}`, JSON.stringify(preview)); } catch {}
  }

  const deliverables = items.data?.deliverables ?? [];
  const toggleD = useToggleDeliverable();

  const totalSections = deliverables.length;
  const completedSections = deliverables.filter((d) => d.status === "done").length;
  const inProgressSections = deliverables.filter((d) => d.status === "in_progress").length;
  const pendingSections = deliverables.filter((d) => d.status === "pending").length;

  const dl = daysLeft(bid.deadline);

  if (activeTab === "team") {
    return (
      <div className="px-6 py-5 max-w-[700px]">
        <div className="bg-card hairline border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b hairline border-border">
            <h3 className="text-[13px] font-semibold">Proposal Team</h3>
            <RFPAssignMemberPopover bidId={bid.id} assignedUserIds={team.map((m) => m.user_id)} />
          </div>
          {team.length === 0 ? (
            <div className="py-10 text-center text-[12px] text-muted-foreground">No team members assigned yet.</div>
          ) : (
            <ul className="divide-y hairline divide-border">
              {team.map((m) => (
                <RFPTeamMemberRow key={m.user_id} member={m} bidId={bid.id} />
              ))}
            </ul>
          )}
        </div>
        <AdvanceStageFooter bid={bid} stage="rfp" />
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
        <AdvanceStageFooter bid={bid} stage="rfp" />
      </div>
    );
  }

  // Overview tab
  return (
    <div className="px-6 py-5 max-w-[1100px]">
      {/* Action buttons */}
      <div className="flex items-center gap-3 mb-5">
        {canGenerateProposal && (
          <button
            onClick={openProposalModal}
            disabled={creatingSession}
            className="h-9 px-4 rounded-lg text-white text-[12px] font-semibold hover:opacity-90 transition-opacity inline-flex items-center gap-2 disabled:opacity-50"
            style={{ background: "#fd5b0e" }}
          >
            {creatingSession && <Loader2 className="size-3.5 animate-spin" />}
            ✦ Generate Proposal
          </button>
        )}
        <Link
          to="/ai"
          search={{ bidId: bid.id }}
          className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-[12px] font-semibold hover:opacity-90 transition-opacity inline-flex items-center gap-2"
        >
          Open RFx Responder <ArrowRight className="size-3.5" />
        </Link>
      </div>

      {/* Proposal Details */}
      <div className="bg-card hairline border rounded-xl p-4 mb-5">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">Proposal Details</div>
        <div className="grid grid-cols-6 gap-y-2 gap-x-6">
          <KV label="Due Date" value={bid.deadline ? new Date(bid.deadline).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" }) : "—"} />
          <KV label="Time Remaining" value={dl < 0 ? `${Math.abs(dl)}d over` : `${dl}d left`} urgent={dl <= 5} />
          <KV label="Sections Tracked" value={String(totalSections)} />
          <KV label="Completed" value={String(completedSections)} />
          <KV label="In Progress" value={String(inProgressSections)} />
          <KV label="Pending" value={String(pendingSections)} />
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

      {/* Proposal Preview Panel — shown after Generate Proposal runs */}
      {proposalPreview && (
        <ProposalPreviewPanel
          preview={proposalPreview}
          onDismiss={() => {
            setProposalPreview(null);
            try { sessionStorage.removeItem(`rfp_preview_${bid.id}`); } catch {}
          }}
        />
      )}

      <AdvanceStageFooter bid={bid} stage="rfp" />

      {proposalOpen && proposalSessionId && (
        <ProposalModal
          open={proposalOpen}
          onClose={() => { setProposalOpen(false); setProposalSessionId(null); }}
          bidId={bid.id}
          sessionId={proposalSessionId}
          clientName={bid.client_name}
          onGenerated={handleProposalGenerated}
        />
      )}
    </div>
  );
}

// ── ProposalPreviewPanel ──────────────────────────────────────────────────────

function ProposalPreviewPanel({ preview, onDismiss }: { preview: ProposalPreview; onDismiss: () => void }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const textSections = [
    { key: "pleased", title: "Executive Summary — We Are Pleased to Present", content: preview.exec_summary.pleased },
    { key: "aligned", title: "Executive Summary — Strategic Alignment", content: preview.exec_summary.aligned },
    { key: "confident", title: "Executive Summary — Our Confidence", content: preview.exec_summary.confident },
    { key: "scope", title: "Scope Introduction", content: preview.scope_intro },
  ];

  return (
    <div className="bg-card hairline border rounded-xl overflow-hidden mb-4">
      <div
        className="flex items-center justify-between px-4 py-3 border-b hairline border-border"
        style={{ background: "rgba(253,91,14,.06)" }}
      >
        <div className="flex items-center gap-2.5">
          <span className="text-[10px] font-bold text-orange-600 dark:text-orange-400 uppercase tracking-wider">
            ✦ Proposal Preview
          </span>
          <span className="text-[10px] text-muted-foreground">
            · {preview.product} · {preview.customer_display_name}
          </span>
        </div>
        <button onClick={onDismiss} className="text-muted-foreground hover:text-foreground transition-colors">
          <X className="size-3.5" />
        </button>
      </div>

      <div className="divide-y hairline divide-border">
        {textSections.map(({ key, title, content }) => (
          <div key={key}>
            <button
              onClick={() => setExpanded(e => e === key ? null : key)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/20 transition-colors text-left"
            >
              <span className="text-[12px] font-medium">{title}</span>
              <ChevronRight className={`size-3.5 text-muted-foreground transition-transform shrink-0 ${expanded === key ? "rotate-90" : ""}`} />
            </button>
            {expanded === key && (
              <div className="px-4 pb-4">
                <p className="text-[12px] text-foreground leading-relaxed">{content}</p>
              </div>
            )}
          </div>
        ))}

        <div>
          <button
            onClick={() => setExpanded(e => e === "deliverables" ? null : "deliverables")}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/20 transition-colors text-left"
          >
            <span className="text-[12px] font-medium">Deliverables ({preview.deliverables.length})</span>
            <ChevronRight className={`size-3.5 text-muted-foreground transition-transform shrink-0 ${expanded === "deliverables" ? "rotate-90" : ""}`} />
          </button>
          {expanded === "deliverables" && (
            <div className="px-4 pb-4">
              <ul className="flex flex-col gap-1">
                {preview.deliverables.map((d, i) => (
                  <li key={i} className="text-[12px] text-foreground flex gap-2">
                    <span className="text-muted-foreground shrink-0">·</span>
                    <span>{d}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── RFPAssignMemberPopover ────────────────────────────────────────────────────

function RFPAssignMemberPopover({ bidId, assignedUserIds }: { bidId: string; assignedUserIds: string[] }) {
  const { data: members = [] } = useTeamMembers();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const unassigned = members.filter((m) => !assignedUserIds.includes(m.user_id));

  async function assign(userId: string) {
    await (supabase as any).from("bid_assignments").insert({ bid_id: bidId, user_id: userId });
    qc.invalidateQueries({ queryKey: ["bid-team", bidId] });
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="h-7 px-3 rounded-md hairline border text-[11px] font-medium hover:bg-muted inline-flex items-center gap-1.5">
          <UserPlus className="size-3.5" /> Assign member
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-1">
        {unassigned.length === 0 ? (
          <div className="py-4 text-center text-[11px] text-muted-foreground">All members already assigned.</div>
        ) : (
          <ul>
            {unassigned.map((m) => (
              <li key={m.user_id}>
                <button onClick={() => assign(m.user_id)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-muted/50 rounded-md text-left">
                  <div className="size-6 rounded-full bg-primary/20 text-primary text-[10px] font-bold flex items-center justify-center shrink-0">
                    {initials(m.full_name)}
                  </div>
                  <div className="min-w-0">
                    <div className="text-[12px] font-medium truncate">{m.full_name}</div>
                    <div className="text-[10px] text-muted-foreground capitalize">{m.primary_role.replace(/_/g, " ")}</div>
                  </div>
                  <UserPlus className="size-3 text-muted-foreground ml-auto shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ── RFPTeamMemberRow ──────────────────────────────────────────────────────────

function RFPTeamMemberRow({ member, bidId }: { member: any; bidId: string }) {
  const qc = useQueryClient();

  function avatarColor(name: string): string {
    const colors = ["#491AEB", "#0891b2", "#16a34a", "#d97706", "#dc2626", "#7c3aed", "#db2777"];
    let hash = 0;
    for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
    return colors[Math.abs(hash) % colors.length];
  }

  async function remove() {
    await (supabase as any).from("bid_assignments").delete().eq("id", member.assignment_id);
    qc.invalidateQueries({ queryKey: ["bid-team", bidId] });
  }

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <div className="size-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0"
        style={{ background: avatarColor(member.full_name) }}>
        {initials(member.full_name)}
      </div>
      <div className="min-w-0">
        <div className="text-[13px] font-medium leading-tight">{member.full_name}</div>
        <div className="text-[11px] text-muted-foreground">{member.email}</div>
      </div>
      <span className="ml-auto text-[10px] font-semibold px-2 py-0.5 rounded bg-primary/10 text-primary capitalize">
        {member.role.replace(/_/g, " ")}
      </span>
      <button onClick={remove} className="text-muted-foreground hover:text-destructive transition-colors ml-1">
        <X className="size-3.5" />
      </button>
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

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="size-2 rounded-full shrink-0" style={{ background: color }} />
      <span>{label}</span>
    </div>
  );
}

