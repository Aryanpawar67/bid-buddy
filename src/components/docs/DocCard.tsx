import type { BidDocument, DocType } from "@/lib/doc-queries";

const EXT_COLORS: Record<string, { bg: string; color: string; label: string }> = {
  pdf:  { bg: "#fff1f1", color: "#e53e3e", label: "PDF" },
  docx: { bg: "#ebf5ff", color: "#2563eb", label: "DOC" },
  xlsx: { bg: "#edfaf4", color: "#16a34a", label: "XLS" },
};

const TYPE_STYLES: Record<DocType, string> = {
  rfp:       "bg-[#fff1f1] text-[#e53e3e]",
  proposal:  "bg-[#fff0e8] text-[#fd5b0e]",
  legal:     "bg-[#edfaf4] text-[#16a34a]",
  template:  "bg-[#ede9fd] text-[#491aeb]",
  reference: "bg-[#f5f4fa] text-muted-foreground",
};

function fmtBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

type Props = {
  doc: BidDocument;
  bidName?: string;
  onPreview: (doc: BidDocument) => void;
};

export function DocCard({ doc, bidName, onPreview }: Props) {
  const ext = doc.name.split(".").pop()?.toLowerCase() ?? "pdf";
  const extStyle = EXT_COLORS[ext] ?? EXT_COLORS.pdf;
  const isIndexed = doc.embedding !== null;

  return (
    <button
      onClick={() => onPreview(doc)}
      className="relative bg-card hairline border border-border rounded-lg p-3 text-left hover:border-primary/40 transition-colors w-full flex flex-col gap-2"
    >
      {/* AI badge */}
      {isIndexed && (
        <span className="absolute top-2 right-2 text-[9px] bg-[#ede9fd] text-primary px-1.5 py-0.5 rounded font-semibold">
          ✦ AI
        </span>
      )}

      {/* File type icon */}
      <div
        className="w-10 h-12 rounded flex items-center justify-center text-[11px] font-black shrink-0"
        style={{ background: extStyle.bg, color: extStyle.color }}
      >
        {extStyle.label}
      </div>

      {/* Name */}
      <div
        className="text-[11px] font-medium leading-[1.35] overflow-hidden"
        style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}
      >
        {doc.name}
      </div>

      {/* Badges + meta */}
      <div className="flex flex-col gap-1 mt-auto">
        <div className="flex items-center gap-1 flex-wrap">
          <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${TYPE_STYLES[doc.type]}`}>
            {doc.type.charAt(0).toUpperCase() + doc.type.slice(1)}
          </span>
          {doc.source === "generated" && (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#fff7ed] text-orange-600 font-semibold border hairline border-orange-200">
              Generated
            </span>
          )}
        </div>
        <div className="text-[9px] text-muted-foreground">
          {fmtBytes(doc.size_bytes)} · {fmtDate(doc.created_at)}
        </div>
        {bidName && (
          <div className="text-[9px] text-muted-foreground truncate">{bidName}</div>
        )}
        {!bidName && !doc.bid_id && (
          <div className="text-[9px] text-muted-foreground">Global template</div>
        )}
      </div>
    </button>
  );
}
