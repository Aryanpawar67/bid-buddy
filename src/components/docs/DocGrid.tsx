import type { BidDocument, DocType } from "@/lib/doc-queries";
import { DocCard } from "./DocCard";

const TYPE_SECTION: Record<DocType, string> = {
  template:  "Templates",
  proposal:  "Proposals",
  rfp:       "RFP",
  legal:     "Legal & Compliance",
  reference: "Reference",
};

const SECTION_ORDER: DocType[] = ["template", "proposal", "rfp", "legal", "reference"];

type Props = {
  docs: BidDocument[];
  isLoading: boolean;
  onPreview: (doc: BidDocument) => void;
};

export function CompanyKBTab({ docs, isLoading, onPreview }: Props) {
  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-[12px] text-muted-foreground">
        Loading documents…
      </div>
    );
  }

  if (docs.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground py-16">
        <div className="text-3xl opacity-20">📁</div>
        <div className="text-[13px]">No documents yet</div>
        <div className="text-[11px]">Upload your first document using the button above</div>
      </div>
    );
  }

  const grouped = SECTION_ORDER.reduce<{ type: DocType; label: string; items: BidDocument[] }[]>(
    (acc, type) => {
      const items = docs.filter((d) => d.type === type);
      if (items.length) acc.push({ type, label: TYPE_SECTION[type], items });
      return acc;
    },
    []
  );

  return (
    <div className="flex-1 overflow-y-auto px-5 py-4 pb-8">
      {grouped.map(({ type, label, items }) => (
        <section key={type} className="mb-6">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
            {label}
            <span className="text-[9px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full font-normal">
              {items.length}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
            {items.map((doc) => (
              <DocCard key={doc.id} doc={doc} onPreview={onPreview} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
