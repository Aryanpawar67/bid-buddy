import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useDocuments, type BidDocument } from "@/lib/doc-queries";
import { useBids } from "@/lib/bid-queries";
import { CompanyKBTab } from "@/components/docs/DocGrid";
import { BidDocumentsTab } from "@/components/docs/BidDocumentsTab";
import { SharePointTab } from "@/components/docs/SharePointTab";
import { DocPreviewModal } from "@/components/docs/DocPreviewModal";
import { UploadModal } from "@/components/docs/UploadModal";
import { SharePointModal } from "@/components/docs/SharePointModal";
import { useCurrentUser } from "@/lib/auth";

export const Route = createFileRoute("/_app/docs")({
  component: DocsPage,
});

type TabKey = "kb" | "sp" | "bids";

function DocsPage() {
  const { data: docs = [], isLoading } = useDocuments();
  const { data: bids = [] } = useBids();
  const { primaryRole } = useCurrentUser();

  const [tab, setTab] = useState<TabKey>("kb");
  const [previewDoc, setPreviewDoc] = useState<BidDocument | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [spOpen, setSpOpen] = useState(false);

  const isAdmin = primaryRole === "admin";
  const canUpload = primaryRole === "pre_sales" || isAdmin;

  const globalDocs = docs.filter((d) => d.bid_id === null);

  return (
    <div className="h-full flex flex-col">
      {/* TopBar */}
      <div className="flex items-center gap-3 px-5 py-3 border-b hairline border-border bg-card shrink-0">
        <div className="relative flex items-center max-w-[280px] flex-1">
          <span className="absolute left-2.5 text-muted-foreground text-[11px] pointer-events-none select-none">
            ⌕
          </span>
          <input
            className="w-full h-8 bg-background border hairline border-border rounded-md pl-7 pr-3 text-[11px] text-foreground outline-none placeholder:text-muted-foreground"
            placeholder="Search documents…"
            readOnly
          />
        </div>
        <div className="flex-1" />
        {canUpload && (
          <button
            onClick={() => setUploadOpen(true)}
            className="h-8 px-4 rounded-md bg-primary text-primary-foreground text-[12px] font-medium inline-flex items-center gap-1.5 hover:opacity-90 transition-opacity"
          >
            + Upload
          </button>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex items-center px-5 border-b hairline border-border bg-card shrink-0">
        {(
          [
            { key: "kb",   label: "Company KB",     badge: String(globalDocs.length), lock: true },
            { key: "sp",   label: "SharePoint",     badge: null,                      lock: false },
            { key: "bids", label: "Bid Documents",  badge: `${bids.length} bids`,     lock: false },
          ] as { key: TabKey; label: string; badge: string | null; lock: boolean }[]
        ).map(({ key, label, badge, lock }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={[
              "h-10 px-3.5 text-[12px] font-medium flex items-center gap-1.5 border-b-2 transition-colors shrink-0",
              tab === key
                ? "text-foreground border-primary"
                : "text-muted-foreground border-transparent hover:text-foreground",
            ].join(" ")}
          >
            {label}
            {badge && (
              <span
                className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
                  tab === key
                    ? "bg-primary/15 text-primary"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {badge}
              </span>
            )}
            {lock && (
              <span className="text-[9px] text-amber-500/70">🔒</span>
            )}
          </button>
        ))}
      </div>

      {/* Company KB access banner */}
      {tab === "kb" && (
        <div className="mx-5 mt-3 px-3 py-2 bg-amber-500/10 border hairline border-amber-500/20 rounded-md text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-2 shrink-0">
          <span>🔒</span>
          <span>
            <strong>Restricted upload access.</strong> Only Admins and Pre-Sales can add or remove
            Company KB documents. All team members can read and search.
          </span>
        </div>
      )}

      {/* Tab content */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        {tab === "kb" && (
          <CompanyKBTab docs={globalDocs} isLoading={isLoading} onPreview={setPreviewDoc} />
        )}
        {tab === "sp" && <SharePointTab onManage={() => setSpOpen(true)} />}
        {tab === "bids" && (
          <BidDocumentsTab
            bids={bids}
            docs={docs}
            isLoading={isLoading}
            onPreview={setPreviewDoc}
          />
        )}
      </div>

      {/* Modals — unchanged */}
      <DocPreviewModal doc={previewDoc} allDocs={docs} onClose={() => setPreviewDoc(null)} />
      <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} bids={bids} />
      <SharePointModal open={spOpen} onClose={() => setSpOpen(false)} />
    </div>
  );
}
