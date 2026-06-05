import { format } from "date-fns";
import { Calendar } from "lucide-react";
import { type DateRange, presetToRange } from "@/lib/analytics-queries";

type Preset = "30d" | "90d" | "12m";

interface Props {
  preset: Preset;
  range: DateRange;
  onPresetChange: (p: Preset) => void;
  onRangeChange: (r: DateRange) => void;
}

const PRESETS: { label: string; value: Preset }[] = [
  { label: "30d", value: "30d" },
  { label: "90d", value: "90d" },
  { label: "12m", value: "12m" },
];

export function DateRangePicker({ preset, range, onPresetChange }: Props) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex gap-1">
        {PRESETS.map((p) => (
          <button
            key={p.value}
            onClick={() => onPresetChange(p.value)}
            className={[
              "h-[26px] px-2.5 rounded-full text-[10px] font-medium border transition-colors",
              preset === p.value
                ? "bg-[#491AEB] text-white border-[#491AEB]"
                : "bg-white text-[#6b6785] border-[#ddd] hover:border-[#491AEB] hover:text-[#491AEB]",
            ].join(" ")}
          >
            {p.label}
          </button>
        ))}
      </div>
      <button className="h-[26px] px-2.5 rounded-md border border-[#ddd] bg-white text-[10px] font-medium text-[#6b6785] flex items-center gap-1.5 cursor-default select-none">
        <Calendar size={10} className="opacity-50" />
        {format(range.from, "MMM d")} – {format(range.to, "MMM d")}
      </button>
    </div>
  );
}

// re-export for convenience
export { presetToRange };
