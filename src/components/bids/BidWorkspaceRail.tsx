import { ArrowRight } from "lucide-react";
import { STAGES, initials, fmtMoney, stageLabel } from "@/lib/bid-constants";
import type { Bid } from "@/lib/bid-queries";
import {
  useAssessmentData,
  useUpdateBid,
  useGenerateQualResult,
  useGenerateDealBrief,
  useBidActivity,
} from "@/lib/bid-queries";
import { DEFAULT_CRITERIA, computeScore } from "./DealQualificationWorkspace";
import { useCurrentUser } from "@/lib/auth";

type Props = {
  bid: Bid;
  isDealQual: boolean;
};

export function BidWorkspaceRail({ bid, isDealQual }: Props) {
  const updateBid = useUpdateBid();
  const { data: activity = [] } = useBidActivity(bid.id);
  const recentActivity = activity.slice(0, 3);

  return (
    <aside
      style={{
        width: 254,
        flexShrink: 0,
        background: "var(--color-card)",
        borderLeft: "1px solid var(--color-border)",
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        gap: 0,
      }}
    >
      {isDealQual ? (
        <DealQualRail bid={bid} updateBid={updateBid} recentActivity={recentActivity} />
      ) : (
        <SlimRail bid={bid} updateBid={updateBid} recentActivity={recentActivity} />
      )}
    </aside>
  );
}

function DealQualRail({
  bid,
  updateBid,
  recentActivity,
}: {
  bid: Bid;
  updateBid: ReturnType<typeof useUpdateBid>;
  recentActivity: any[];
}) {
  const { data: assessmentData } = useAssessmentData(bid.id);
  const generateQualResult = useGenerateQualResult();
  const generateDealBrief = useGenerateDealBrief();
  const { user } = useCurrentUser();

  const score = computeScore(assessmentData ?? null);
  const scoreColor =
    score >= 65
      ? "var(--color-success-foreground)"
      : score >= 45
        ? "var(--color-warning-foreground)"
        : "var(--color-danger-foreground)";
  const scoreBg =
    score >= 65
      ? "var(--color-success-soft)"
      : score >= 45
        ? "var(--color-warning-soft)"
        : "var(--color-danger-soft)";

  const totalScore = score;
  const decision: "go" | "conditional_go" | "no_go" =
    totalScore >= 65 ? "go" : totalScore >= 45 ? "conditional_go" : "no_go";

  async function lockAs(d: "go" | "conditional_go" | "no_go") {
    await updateBid.mutateAsync({
      id: bid.id,
      patch: {
        gonogo_score: totalScore,
        gonogo_decision: d,
        gonogo_completed_at: new Date().toISOString(),
        gonogo_completed_by: user?.id ?? null,
      } as never,
    });
  }

  const hasScores = DEFAULT_CRITERIA.some(
    (c) => ((assessmentData?.scores as Record<string, number> | undefined)?.[c.id] ?? 0) > 0,
  );
  const canGenerate = hasScores;

  return (
    <>
      {/* Score gauge */}
      <RailSection title="Qualification Score">
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 6,
            padding: "4px 0 8px",
          }}
        >
          <span style={{ fontSize: 36, fontWeight: 900, color: scoreColor, lineHeight: 1 }}>
            {score > 0 ? score : "—"}
          </span>
          <span style={{ fontSize: 10, color: "var(--color-muted-foreground)" }}>out of 100</span>
          {/* Progress bar */}
          <div
            style={{
              width: "100%",
              height: 5,
              borderRadius: 3,
              background: "var(--color-muted)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${Math.min(score, 100)}%`,
                height: "100%",
                background: scoreColor,
                borderRadius: 3,
                transition: "width .4s ease",
              }}
            />
          </div>
          <div style={{ display: "flex", gap: 6, fontSize: 9, color: "var(--color-muted-foreground)" }}>
            <span style={{ color: "var(--color-danger-foreground)" }}>No Go &lt;45</span>
            <span>·</span>
            <span style={{ color: "var(--color-warning-foreground)" }}>Cond 45–65</span>
            <span>·</span>
            <span style={{ color: "var(--color-success-foreground)" }}>&gt;65 Go</span>
          </div>
        </div>
      </RailSection>

      {/* Lock Decision */}
      <RailSection title="Lock Go / No-Go Decision">
        <p style={{ fontSize: 10, color: "var(--color-muted-foreground)", marginBottom: 8, lineHeight: 1.4 }}>
          Required before advancing to RFI. Current assessment: {score}/100.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {([
            { key: "go" as const, label: "Go", bg: "var(--color-success-soft)", color: "var(--color-success-foreground)", border: "#97C459" },
            { key: "conditional_go" as const, label: "Conditional Go", bg: "var(--color-warning-soft)", color: "var(--color-warning-foreground)", border: "#FB794B" },
            { key: "no_go" as const, label: "No Go", bg: "var(--color-danger-soft)", color: "var(--color-danger-foreground)", border: "#A32D2D" },
          ] as const).map((opt) => (
            <button
              key={opt.key}
              onClick={() => lockAs(opt.key)}
              disabled={updateBid.isPending || !hasScores}
              style={{
                height: 32,
                borderRadius: 8,
                border: `1px solid ${opt.border}`,
                background: bid.gonogo_decision === opt.key ? opt.bg : "transparent",
                color: opt.color,
                fontSize: 11,
                fontWeight: bid.gonogo_decision === opt.key ? 700 : 500,
                cursor: "pointer",
                opacity: updateBid.isPending || !hasScores ? 0.4 : 1,
                transition: "all .15s",
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </RailSection>

      {/* Generate Documents */}
      <RailSection title="Generate Documents">
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <button
            onClick={() =>
              generateQualResult.mutate({
                bidId: bid.id,
                clientName: bid.client_name,
                decision: bid.gonogo_decision ?? "no_go",
                totalScore,
              })
            }
            disabled={generateQualResult.isPending || !canGenerate}
            className="h-8 rounded-md bg-primary text-primary-foreground text-[11px] font-medium disabled:opacity-40 hover:opacity-90 transition-opacity"
          >
            {generateQualResult.isPending ? "Generating…" : "Qual Result Doc"}
          </button>
          <button
            onClick={() => generateDealBrief.mutate(bid.id)}
            disabled={generateDealBrief.isPending || !canGenerate}
            className="h-8 rounded-md hairline border bg-card text-[11px] font-medium disabled:opacity-40 hover:bg-muted transition-colors"
          >
            {generateDealBrief.isPending ? "Generating…" : "C-Suite Deal Brief"}
          </button>
        </div>
      </RailSection>

      {/* Bid Details */}
      <BidDetailsKV bid={bid} />

      {/* Recent Activity */}
      <RecentActivity events={recentActivity} />
    </>
  );
}

function SlimRail({
  bid,
  updateBid,
  recentActivity,
}: {
  bid: Bid;
  updateBid: ReturnType<typeof useUpdateBid>;
  recentActivity: any[];
}) {
  const currentIdx = STAGES.findIndex((s) => s.key === bid.stage);

  async function advance() {
    const next = STAGES[currentIdx + 1];
    if (!next) return;
    if (next.key === "rfi" && bid.gonogo_decision !== "go" && bid.gonogo_decision !== "conditional_go") {
      alert("Lock a Go or Conditional Go decision before advancing to RFI.");
      return;
    }
    await updateBid.mutateAsync({ id: bid.id, patch: { stage: next.key } });
  }

  return (
    <>
      <BidDetailsKV bid={bid} />

      {currentIdx < STAGES.length - 1 && (
        <RailSection title="">
          <button
            onClick={advance}
            disabled={updateBid.isPending}
            className="w-full h-8 rounded-md bg-accent text-accent-foreground text-[11px] font-medium hover:opacity-90 inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
          >
            Advance to {STAGES[currentIdx + 1].short} <ArrowRight className="size-3" />
          </button>
        </RailSection>
      )}

      <RecentActivity events={recentActivity} />
    </>
  );
}

function BidDetailsKV({ bid }: { bid: Bid }) {
  return (
    <RailSection title="Bid Details">
      <KV label="Type" value={bid.type.toUpperCase()} />
      <KV label="Portal" value={bid.procurement_portal ?? "—"} />
      <KV label="Priority" value={bid.priority} />
      <KV label="Value" value={fmtMoney(bid.value)} />
    </RailSection>
  );
}

function RecentActivity({ events }: { events: any[] }) {
  if (events.length === 0) return null;
  return (
    <RailSection title="Recent Activity">
      <ul style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {events.map((e) => {
          const actor = e.profiles?.full_name ?? "System";
          return (
            <li key={e.id} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <div
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "var(--color-primary)",
                  flexShrink: 0,
                  marginTop: 4,
                }}
              />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11, lineHeight: 1.3, color: "var(--color-foreground)" }}>
                  {e.action}
                </div>
                <div style={{ fontSize: 9, color: "var(--color-muted-foreground)", marginTop: 2 }}>
                  {actor}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </RailSection>
  );
}

function RailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: "12px 14px",
        borderBottom: "1px solid var(--color-border)",
      }}
    >
      {title && (
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--color-muted-foreground)",
            marginBottom: 8,
          }}
        >
          {title}
        </div>
      )}
      {children}
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "4px 0",
        fontSize: 11,
        borderBottom: "0.5px solid var(--color-border)",
      }}
      className="last:border-b-0"
    >
      <span style={{ color: "var(--color-muted-foreground)" }}>{label}</span>
      <span style={{ fontWeight: 500, textTransform: "capitalize" }}>{value}</span>
    </div>
  );
}
