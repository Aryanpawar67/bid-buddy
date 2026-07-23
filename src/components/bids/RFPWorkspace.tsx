import { useState } from "react";
import {
  Users, Activity,
  LayoutList, ArrowRight, UserPlus, X, Loader2, ChevronRight, FileDown,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { Bid } from "@/lib/bid-queries";
import { useStageItems, useBidTeam, useBidActivity, useTeamMembers } from "@/lib/bid-queries";
import { useDocuments } from "@/lib/doc-queries";
import { supabase } from "@/integrations/supabase/client";
import { initials } from "@/lib/bid-constants";
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
    refetchProposals();
  }

  // Fetch generated proposal docs for this bid
  const { data: proposalDocs = [], refetch: refetchProposals } = useDocuments({ bidId: bid.id, type: "proposal" });
  const generatedProposal = proposalDocs.find((d: any) => d.source === "generated") ?? null;

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
            {creatingSession
              ? <><Loader2 className="size-3.5 animate-spin" /> Creating session…</>
              : generatedProposal
                ? <>✦ Regenerate Proposal</>
                : <>✦ Generate Proposal</>}
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
        <div className="grid grid-cols-4 gap-y-2 gap-x-6">
          <KV label="Due Date" value={bid.deadline ? new Date(bid.deadline).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" }) : "—"} />
          <KV label="Time Remaining" value={dl < 0 ? `${Math.abs(dl)}d over` : `${dl}d left`} urgent={dl <= 5} />
          <KV label="Client" value={bid.client_name} />
          <KV label="Value" value={bid.value ? `$${(bid.value / 1_000_000).toFixed(1)}M` : "—"} />
        </div>
      </div>

      {/* Generated proposal document */}
      {generatedProposal && (
        <GeneratedProposalCard doc={generatedProposal} />
      )}

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

// ── GeneratedProposalCard ─────────────────────────────────────────────────────

function GeneratedProposalCard({ doc }: { doc: any }) {
  const [downloading, setDownloading] = useState(false);

  async function handleDownload() {
    setDownloading(true);
    try {
      const { data, error } = await (supabase.storage as any)
        .from("bid-documents")
        .createSignedUrl(doc.storage_path, 300);
      if (error || !data?.signedUrl) throw new Error("Could not create download link");
      const res = await fetch(data.signedUrl);
      if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("[GeneratedProposalCard] download failed:", e);
    } finally {
      setDownloading(false);
    }
  }

  const ext = doc.name.split(".").pop()?.toUpperCase() ?? "DOCX";
  const sizeKb = Math.round((doc.size_bytes ?? 0) / 1024);
  const createdAt = new Date(doc.created_at).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });

  return (
    <div className="bg-card hairline border rounded-xl overflow-hidden mb-4">
      <div className="flex items-center justify-between px-4 py-3 border-b hairline border-border"
        style={{ background: "rgba(253,91,14,.05)" }}>
        <span className="text-[10px] font-bold text-orange-600 dark:text-orange-400 uppercase tracking-wider">
          ✦ Generated Proposal
        </span>
        <span className="text-[10px] text-muted-foreground">{createdAt}</span>
      </div>
      <div className="flex items-center gap-4 px-4 py-3">
        <div className="size-9 rounded-lg bg-orange-500/10 flex items-center justify-center shrink-0">
          <FileDown className="size-4 text-orange-500" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-medium text-foreground truncate">{doc.name}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">{ext} · {sizeKb} KB</div>
        </div>
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="h-8 px-3.5 rounded-lg bg-orange-500 text-white text-[11px] font-semibold hover:bg-orange-600 disabled:opacity-50 transition-colors inline-flex items-center gap-1.5 shrink-0"
        >
          {downloading
            ? <><Loader2 className="size-3 animate-spin" /> Downloading…</>
            : <><FileDown className="size-3" /> Download</>}
        </button>
      </div>
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


