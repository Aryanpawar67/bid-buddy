import { Bot, Activity } from "lucide-react";
import { initials, fmtMoney, urgencyClass, stageLabel, type StageKey } from "@/lib/bid-constants";
import type { Bid } from "@/lib/bid-queries";
import { StageJourney } from "./StageJourney";
import { TABS, type Tab } from "./DealQualificationWorkspace";

type Props = {
  bid: Bid;
  viewStage: StageKey;
  onViewStage: (s: StageKey) => void;
  activeTab: Tab;
  onTabChange: (t: Tab) => void;
};

const DECISION_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  go:             { bg: "#dcfce7", color: "#15803d", label: "Go" },
  conditional_go: { bg: "#fef9c3", color: "#854d0e", label: "Cond. Go" },
  no_go:          { bg: "#fee2e2", color: "#b91c1c", label: "No Go" },
};

function avatarColor(name: string): string {
  const colors = ["#491AEB", "#0891b2", "#16a34a", "#d97706", "#dc2626", "#7c3aed", "#db2777"];
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  return colors[Math.abs(hash) % colors.length];
}

export function BidHeaderBar({ bid, viewStage, onViewStage, activeTab, onTabChange }: Props) {
  const u = urgencyClass(bid.deadline);
  const av = initials(bid.client_name);
  const avBg = avatarColor(bid.client_name);
  const dec = bid.gonogo_decision ? DECISION_STYLE[bid.gonogo_decision] : null;

  const isViewingOther = viewStage !== bid.stage;

  return (
    <div
      style={{
        background: "var(--color-card)",
        borderBottom: "1px solid var(--color-border)",
        flexShrink: 0,
      }}
    >
      {/* Row 1 — Identity strip */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 16px",
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        {/* Avatar */}
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: "50%",
            background: avBg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
            fontWeight: 700,
            color: "#fff",
            flexShrink: 0,
          }}
        >
          {av}
        </div>

        {/* Name + title */}
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 18,
              fontWeight: 800,
              lineHeight: 1.1,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {bid.client_name}
          </div>
          <div
            style={{
              fontSize: 11.5,
              color: "var(--color-muted-foreground)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {bid.title}
          </div>
        </div>

        <div style={{ flex: 1 }} />

        {/* Deal value */}
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 10, color: "var(--color-muted-foreground)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Value
          </div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{fmtMoney(bid.value)}</div>
        </div>

        <Divider />

        {/* Deadline */}
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 10, color: "var(--color-muted-foreground)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Deadline
          </div>
          <div className={`text-[13px] font-semibold ${u.className}`}>{u.label}</div>
        </div>

        <Divider />

        {/* Decision badge */}
        {dec ? (
          <span
            style={{
              flexShrink: 0,
              padding: "3px 10px",
              borderRadius: 6,
              background: dec.bg,
              color: dec.color,
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            {dec.label}
          </span>
        ) : (
          <span
            style={{
              flexShrink: 0,
              padding: "3px 10px",
              borderRadius: 6,
              background: "rgba(73,26,235,.1)",
              color: "var(--color-primary)",
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            Pending
          </span>
        )}

        <Divider />

        {/* Action buttons */}
        <button
          title="AI Session"
          className="size-8 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors"
        >
          <Bot size={15} />
        </button>
        <button
          title="Activity"
          className="size-8 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors"
        >
          <Activity size={15} />
        </button>
      </div>

      {/* Row 2 — Stage Journey */}
      <div style={{ background: "var(--color-sidebar)", borderBottom: "1px solid var(--color-border)" }}>
        {isViewingOther && (
          <div
            style={{
              padding: "4px 16px",
              fontSize: 10.5,
              color: "rgba(255,255,255,.6)",
              background: "rgba(73,26,235,.2)",
              borderBottom: "1px solid rgba(73,26,235,.2)",
            }}
          >
            Viewing <strong style={{ color: "rgba(255,255,255,.85)" }}>{stageLabel(viewStage)}</strong> — this bid is
            currently at <strong style={{ color: "rgba(255,255,255,.85)" }}>{stageLabel(bid.stage)}</strong>
          </div>
        )}
        <StageJourney bidStage={bid.stage} viewStage={viewStage} onViewStage={onViewStage} />
      </div>

      {/* Row 3 — Tab nav */}
      <div
        style={{
          display: "flex",
          borderTop: "1px solid var(--color-border)",
          overflowX: "auto",
          scrollbarWidth: "none",
        }}
      >
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = activeTab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => onTabChange(t.key)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                padding: "9px 14px",
                fontSize: 11.5,
                fontWeight: active ? 600 : 400,
                color: active ? "var(--color-primary)" : "var(--color-muted-foreground)",
                background: "none",
                border: "none",
                borderBottom: active ? "2.5px solid var(--color-primary)" : "2.5px solid transparent",
                cursor: "pointer",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              <Icon size={13} />
              {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Divider() {
  return (
    <div
      style={{
        width: 1,
        height: 24,
        background: "var(--color-border)",
        flexShrink: 0,
        margin: "0 4px",
      }}
    />
  );
}
