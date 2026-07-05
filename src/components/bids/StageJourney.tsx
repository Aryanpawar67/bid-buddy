import { Check } from "lucide-react";
import { STAGES, type StageKey } from "@/lib/bid-constants";

type Props = {
  bidStage: StageKey;
  viewStage: StageKey;
  onViewStage: (s: StageKey) => void;
};

export function StageJourney({ bidStage, viewStage, onViewStage }: Props) {
  const currentIdx = STAGES.findIndex((s) => s.key === bidStage);
  const viewIdx = STAGES.findIndex((s) => s.key === viewStage);

  return (
    <div className="flex items-start gap-0 overflow-x-auto px-4 py-3" style={{ scrollbarWidth: "none" }}>
      {STAGES.map((stage, i) => {
        const isDone = i < currentIdx;
        const isActive = i === currentIdx;
        const isView = i === viewIdx;
        const isPending = i > currentIdx;

        let dotBg: string;
        let dotBorder: string;
        let boxShadow: string | undefined;
        let labelColor: string;

        if (isDone) {
          dotBg = "var(--color-success-soft)";
          dotBorder = "2px solid var(--color-success)";
          boxShadow = undefined;
          labelColor = "rgba(255,255,255,.55)";
        } else if (isActive) {
          dotBg = "var(--color-primary)";
          dotBorder = "2px solid var(--color-primary)";
          boxShadow = isView
            ? "0 0 0 4px rgba(73,26,235,.15), 0 0 0 9px rgba(73,26,235,.07)"
            : "0 0 0 4px rgba(73,26,235,.15)";
          labelColor = "rgba(255,255,255,.9)";
        } else {
          dotBg = "var(--color-surface)";
          dotBorder = "1.5px dashed rgba(73,26,235,.25)";
          boxShadow = isView ? "0 0 0 9px rgba(73,26,235,.07)" : undefined;
          labelColor = "rgba(255,255,255,.35)";
        }

        if (!isActive && isView) {
          dotBorder = "2px solid var(--color-primary)";
          boxShadow = "0 0 0 4px rgba(73,26,235,.15), 0 0 0 9px rgba(73,26,235,.07)";
          labelColor = "rgba(255,255,255,.9)";
        }

        let connectorColor: string;
        if (i === 0) connectorColor = "transparent";
        else if (i <= currentIdx) connectorColor = "var(--color-success)";
        else connectorColor = "var(--color-border)";

        return (
          <div key={stage.key} className="flex items-center" style={{ minWidth: 0 }}>
            {i > 0 && (
              <div
                className="h-px shrink-0"
                style={{ width: 20, background: connectorColor, marginBottom: 20 }}
              />
            )}
            <button
              onClick={() => onViewStage(stage.key)}
              className="flex flex-col items-center gap-1 group shrink-0"
              style={{ minWidth: 56 }}
            >
              <div
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: "50%",
                  background: dotBg,
                  border: dotBorder,
                  boxShadow,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transition: "box-shadow .15s",
                  flexShrink: 0,
                }}
              >
                {isDone && <Check size={12} color="var(--color-success-foreground)" strokeWidth={3} />}
                {(isActive || (!isDone && isView)) && (
                  <div
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: isActive ? "#fff" : "var(--color-primary)",
                    }}
                  />
                )}
              </div>
              <span
                style={{
                  fontSize: 9.5,
                  color: labelColor,
                  fontWeight: isActive || isView ? 600 : 400,
                  textAlign: "center",
                  lineHeight: 1.2,
                  whiteSpace: "nowrap",
                }}
              >
                {stage.short}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
