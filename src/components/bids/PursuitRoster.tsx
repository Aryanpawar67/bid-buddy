import { Search, ChevronLeft, ChevronRight } from "lucide-react";
import { STAGES, type StageKey, initials } from "@/lib/bid-constants";
import type { Bid } from "@/lib/bid-queries";

type Filter = "all" | "mine" | "legal" | "urgent";

type Props = {
  bids: Bid[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  q: string;
  onQ: (q: string) => void;
  filter: Filter;
  onFilter: (f: Filter) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
};

function daysLeft(deadline: string): number {
  return Math.ceil((new Date(deadline).getTime() - Date.now()) / 86400000);
}

function avatarColor(name: string): string {
  const colors = ["#491AEB", "#0891b2", "#16a34a", "#d97706", "#dc2626", "#7c3aed", "#db2777"];
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  return colors[Math.abs(hash) % colors.length];
}

const STAGE_CHIP: Record<StageKey, { bg: string; color: string }> = {
  deal_qualification: { bg: "rgba(73,26,235,.2)",   color: "rgba(255,255,255,.8)" },
  rfi:               { bg: "rgba(37,99,235,.2)",    color: "rgba(255,255,255,.8)" },
  rfp:               { bg: "rgba(67,56,202,.2)",    color: "rgba(255,255,255,.8)" },
  orals:             { bg: "rgba(6,182,212,.2)",    color: "rgba(255,255,255,.8)" },
  due_diligence:     { bg: "rgba(249,115,22,.2)",   color: "rgba(255,255,255,.8)" },
  bafo:              { bg: "rgba(245,158,11,.2)",   color: "rgba(255,255,255,.8)" },
  contract_closure:  { bg: "rgba(34,197,94,.2)",    color: "rgba(255,255,255,.8)" },
  post_closure:      { bg: "rgba(107,114,128,.2)",  color: "rgba(255,255,255,.8)" },
};

const STRIPE: Record<"urgent" | "needs-attention" | "on-track", string> = {
  urgent:           "#EF4444",
  "needs-attention": "#F59E0B",
  "on-track":        "#22C55E",
};

const GROUP_LABEL: Record<"urgent" | "needs-attention" | "on-track", string> = {
  urgent:           "Urgent · ≤3d",
  "needs-attention": "Needs attention · 14d",
  "on-track":        "On track",
};

function urgencyBucket(bid: Bid): "urgent" | "needs-attention" | "on-track" {
  if (bid.status === "won" || bid.status === "lost" || bid.status === "no_go") return "on-track";
  const d = daysLeft(bid.deadline);
  if (d <= 3) return "urgent";
  if (d <= 14) return "needs-attention";
  return "on-track";
}

function stageBarWidth(stage: StageKey): number {
  const idx = STAGES.findIndex((s) => s.key === stage);
  return Math.round((idx / (STAGES.length - 1)) * 100);
}

function stageShortLabel(stage: StageKey): string {
  return STAGES.find((s) => s.key === stage)?.short ?? stage;
}

function daysLabel(deadline: string): string {
  const d = daysLeft(deadline);
  if (d < 0) return `${Math.abs(d)}d over`;
  if (d === 0) return "Today";
  return `${d}d`;
}

export function PursuitRoster({ bids, selectedId, onSelect, q, onQ, filter, onFilter, collapsed = false, onToggleCollapse }: Props) {
  const groups: Array<{ bucket: "urgent" | "needs-attention" | "on-track"; items: Bid[] }> = [
    { bucket: "urgent", items: [] },
    { bucket: "needs-attention", items: [] },
    { bucket: "on-track", items: [] },
  ];
  for (const b of bids) {
    groups.find((g) => g.bucket === urgencyBucket(b))!.items.push(b);
  }

  if (collapsed) {
    return (
      <aside
        style={{
          width: 40,
          flexShrink: 0,
          background: "var(--roster)",
          borderRight: "1px solid var(--roster-border)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          paddingTop: 10,
          gap: 10,
          transition: "width .2s ease",
          overflow: "hidden",
        }}
      >
        <button
          onClick={onToggleCollapse}
          title="Expand roster"
          style={{
            width: 28,
            height: 28,
            borderRadius: 6,
            border: "1px solid var(--roster-border)",
            background: "rgba(255,255,255,.06)",
            color: "rgba(255,255,255,.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <ChevronRight size={14} />
        </button>
        {/* Urgency dots for selected bids */}
        {groups.map(({ bucket, items }) =>
          items.length === 0 ? null : (
            <div
              key={bucket}
              title={`${items.length} ${GROUP_LABEL[bucket]}`}
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: STRIPE[bucket],
                flexShrink: 0,
              }}
            />
          ),
        )}
      </aside>
    );
  }

  return (
    <aside
      style={{
        width: 232,
        flexShrink: 0,
        background: "var(--roster)",
        borderRight: "1px solid var(--roster-border)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        transition: "width .2s ease",
      }}
    >
      {/* Head */}
      <div style={{ padding: "12px 10px 8px", borderBottom: "1px solid var(--roster-border)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "rgba(255,255,255,.85)" }}>
            PURSUITS
          </div>
          <button
            onClick={onToggleCollapse}
            title="Collapse roster"
            style={{
              width: 22,
              height: 22,
              borderRadius: 4,
              border: "1px solid var(--roster-border)",
              background: "rgba(255,255,255,.06)",
              color: "rgba(255,255,255,.45)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            <ChevronLeft size={12} />
          </button>
        </div>

        {/* Search */}
        <div style={{ position: "relative", marginBottom: 6 }}>
          <Search
            size={12}
            style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: "rgba(255,255,255,.3)", pointerEvents: "none" }}
          />
          <input
            value={q}
            onChange={(e) => onQ(e.target.value)}
            placeholder="Search…"
            style={{
              width: "100%",
              height: 28,
              paddingLeft: 26,
              paddingRight: 8,
              borderRadius: 6,
              border: "1px solid var(--roster-border)",
              background: "rgba(255,255,255,.06)",
              color: "rgba(255,255,255,.85)",
              fontSize: 11,
              outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>

        {/* Filter pills */}
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {(["all", "mine", "urgent", "legal"] as const).map((f) => (
            <button
              key={f}
              onClick={() => onFilter(f)}
              style={{
                height: 20,
                padding: "0 7px",
                borderRadius: 4,
                fontSize: 9.5,
                fontWeight: 600,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                border: "none",
                cursor: "pointer",
                background: filter === f ? "rgba(73,26,235,.6)" : "rgba(255,255,255,.08)",
                color: filter === f ? "#fff" : "rgba(255,255,255,.45)",
              }}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Roster list */}
      <div style={{ flex: 1, overflowY: "auto", scrollbarWidth: "thin" }}>
        {groups.map(({ bucket, items }) => {
          if (items.length === 0) return null;
          return (
            <div key={bucket}>
              <div
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: STRIPE[bucket],
                  padding: "8px 10px 4px",
                  opacity: 0.8,
                }}
              >
                {GROUP_LABEL[bucket]}
              </div>
              {items.map((bid) => {
                const active = bid.id === selectedId;
                const chip = STAGE_CHIP[bid.stage];
                const barW = stageBarWidth(bid.stage);
                const dl = daysLabel(bid.deadline);
                const d = daysLeft(bid.deadline);
                const dlColor = d <= 3 ? "#EF4444" : d <= 14 ? "#F59E0B" : "rgba(255,255,255,.4)";
                const av = initials(bid.client_name);
                const avBg = avatarColor(bid.client_name);

                return (
                  <button
                    key={bid.id}
                    onClick={() => onSelect(bid.id)}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "7px 10px 7px 0",
                      cursor: "pointer",
                      border: "none",
                      background: active ? "rgba(73,26,235,.25)" : "transparent",
                      borderRight: active ? "2px solid var(--color-primary)" : "2px solid transparent",
                      position: "relative",
                      textAlign: "left",
                    }}
                    onMouseEnter={(e) => {
                      if (!active) (e.currentTarget as HTMLElement).style.background = "var(--roster-hover)";
                    }}
                    onMouseLeave={(e) => {
                      if (!active) (e.currentTarget as HTMLElement).style.background = "transparent";
                    }}
                  >
                    {/* Urgency stripe */}
                    <div
                      style={{
                        width: 3,
                        alignSelf: "stretch",
                        background: STRIPE[bucket],
                        borderRadius: "0 2px 2px 0",
                        flexShrink: 0,
                      }}
                    />

                    {/* Avatar */}
                    <div
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: "50%",
                        background: avBg,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 10,
                        fontWeight: 700,
                        color: "#fff",
                        flexShrink: 0,
                      }}
                    >
                      {av}
                    </div>

                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 12.5,
                          fontWeight: 600,
                          color: "rgba(255,255,255,.9)",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          lineHeight: 1.3,
                        }}
                      >
                        {bid.client_name}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
                        <span
                          style={{
                            fontSize: 9,
                            fontWeight: 600,
                            padding: "1px 5px",
                            borderRadius: 3,
                            background: chip.bg,
                            color: chip.color,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {stageShortLabel(bid.stage)}
                        </span>
                        <span style={{ fontSize: 10, color: dlColor, fontWeight: d <= 14 ? 600 : 400 }}>
                          {dl}
                        </span>
                      </div>
                      {/* Stage bar */}
                      <div
                        style={{
                          marginTop: 5,
                          height: 2,
                          borderRadius: 1,
                          background: "rgba(255,255,255,.1)",
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            width: `${barW}%`,
                            background: "rgba(73,26,235,.7)",
                            borderRadius: 1,
                          }}
                        />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          );
        })}

        {bids.length === 0 && (
          <div style={{ padding: "24px 10px", textAlign: "center", color: "rgba(255,255,255,.3)", fontSize: 12 }}>
            No bids match your filter.
          </div>
        )}
      </div>
    </aside>
  );
}
