import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Link2 } from "lucide-react";
import { useDocuments, type BidDocument } from "@/lib/doc-queries";
import { useBids } from "@/lib/bid-queries";
import { DocGrid } from "@/components/docs/DocGrid";
import { DocPreviewModal } from "@/components/docs/DocPreviewModal";
import { UploadModal } from "@/components/docs/UploadModal";
import { SharePointModal } from "@/components/docs/SharePointModal";
import { useCurrentUser } from "@/lib/auth";

export const Route = createFileRoute("/_app/docs")({
  component: DocsPage,
});

function DocsPage() {
  const { data: docs = [], isLoading } = useDocuments();
  const { data: bids = [] } = useBids();
  const { primaryRole } = useCurrentUser();
  const [previewDoc, setPreviewDoc] = useState<BidDocument | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [spOpen, setSpOpen] = useState(false);

  const isAdmin = primaryRole === "admin";
  const canUpload = primaryRole === "pre_sales" || isAdmin;

  return (
    <div className="h-full flex flex-col">
      {/* TopBar actions row */}
      <div className="flex items-center gap-3 px-5 py-3 border-b hairline border-border bg-card shrink-0">
        <input
          className="flex-1 max-w-[280px] text-[11px] bg-background border hairline border-border rounded-md px-3 py-1.5 text-foreground placeholder:text-muted-foreground"
          placeholder="Search documents…"
          readOnly
        />
        <div className="flex-1" />
        {isAdmin && (
          <button
            onClick={() => setSpOpen(true)}
            className="h-8 px-3 rounded-md hairline border border-border text-foreground text-[12px] font-medium inline-flex items-center gap-1.5 hover:bg-muted transition-colors"
          >
            <Link2 className="w-3.5 h-3.5" />
            SharePoint
          </button>
        )}
        {canUpload && (
          <button
            onClick={() => setUploadOpen(true)}
            className="h-8 px-4 rounded-md bg-primary text-primary-foreground text-[12px] font-medium inline-flex items-center gap-1.5 hover:opacity-90"
          >
            + Upload
          </button>
        )}
      </div>

      {/* Grid */}
      <DocGrid
        docs={docs}
        bids={bids}
        isLoading={isLoading}
        onPreview={setPreviewDoc}
      />

      {/* Modals */}
      <DocPreviewModal
        doc={previewDoc}
        allDocs={docs}
        onClose={() => setPreviewDoc(null)}
      />

      <UploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        bids={bids}
      />

      <SharePointModal
        open={spOpen}
        onClose={() => setSpOpen(false)}
      />
    </div>
  );
}
