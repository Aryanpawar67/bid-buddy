import { Check, Circle, AlertTriangle } from "lucide-react";
import { STAGES, type StageKey } from "@/lib/bid-constants";

export function StageNav({
  current,
  selected,
  onSelect,
}: {
  current: StageKey;
  selected: StageKey;
  onSelect: (s: StageKey) => void;
}) {
  const iC = STAGES.findIndex((s) => s.key === current);
  return (
    <div className="w-[168px] shrink-0 bg-surface hairline border-r overflow-y-auto">
      <div className="px-3 py-2.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium hairline border-b">
        Stages
      </div>
      <ol className="relative py-1">
        {STAGES.map((s, i) => {
          const state =
            i < iC ? "done" : i === iC ? "active" : "pending";
          const isSelected = s.key === selected;
          return (
            <li key={s.key} className="relative">
              {i < STAGES.length - 1 && (
                <span className="absolute left-[26px] top-9 h-[calc(100%-12px)] w-px bg-border" />
              )}
              <button
                onClick={() => onSelect(s.key)}
                className={[
                  "w-full flex items-center gap-2.5 pl-3 pr-2 py-2 text-left relative",
                  isSelected ? "bg-card" : "hover:bg-card/40",
                ].join(" ")}
              >
                {isSelected && (
                  <span className="absolute left-0 top-1 bottom-1 w-[2px] bg-primary rounded-r" />
                )}
                <StageDot state={state} />
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-medium leading-tight truncate">{s.label}</div>
                </div>
                <div className="text-[9px] text-muted-foreground tabular-nums">{i + 1}</div>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function StageDot({ state }: { state: "done" | "active" | "pending" | "blocked" }) {
  if (state === "done")
    return (
      <span className="size-[22px] rounded-full bg-success-soft border border-[#97C459] flex items-center justify-center">
        <Check className="size-3 text-success-foreground" strokeWidth={2.5} />
      </span>
    );
  if (state === "active")
    return (
      <span className="size-[22px] rounded-full bg-primary-soft border-2 border-primary flex items-center justify-center">
        <span className="size-1.5 rounded-full bg-primary" />
      </span>
    );
  if (state === "blocked")
    return (
      <span className="size-[22px] rounded-full bg-warning-soft border border-[#FB794B] flex items-center justify-center">
        <AlertTriangle className="size-3 text-warning-foreground" strokeWidth={2} />
      </span>
    );
  return (
    <span className="size-[22px] rounded-full border border-dashed border-border flex items-center justify-center">
      <Circle className="size-2 text-muted-foreground" />
    </span>
  );
}
