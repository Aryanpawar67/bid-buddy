import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAssignBid } from "@/lib/settings-queries";
import { useBids } from "@/lib/bid-queries";
import { useCurrentUser } from "@/lib/auth";
import { stageLabel } from "@/lib/bid-constants";
import { Badge } from "@/components/ui/badge";

type Props = {
  open: boolean;
  onClose: () => void;
  userId: string;
  assignedBidIds: string[];
};

export function BidAssignModal({ open, onClose, userId, assignedBidIds }: Props) {
  const [search, setSearch] = useState("");
  const { data: bids = [] } = useBids();
  const assignBid = useAssignBid();
  const { user } = useCurrentUser();

  const available = bids.filter(
    (b) =>
      !assignedBidIds.includes(b.id) &&
      b.client_name.toLowerCase().includes(search.toLowerCase()),
  );

  const handleAssign = (bidId: string) => {
    if (!user) return;
    assignBid.mutate(
      { bidId, userId, assignedBy: user.id },
      { onSuccess: onClose },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-[13px]">Assign Bid</DialogTitle>
        </DialogHeader>
        <input
          type="text"
          placeholder="Search bids…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full text-[11px] px-3 py-2 rounded-md hairline border border-border bg-background outline-none focus:ring-1 focus:ring-primary"
        />
        <div className="max-h-64 overflow-y-auto flex flex-col gap-0.5 mt-1">
          {available.length === 0 && (
            <p className="text-[11px] text-muted-foreground text-center py-6">No unassigned bids found</p>
          )}
          {available.map((bid) => (
            <button
              key={bid.id}
              onClick={() => handleAssign(bid.id)}
              disabled={assignBid.isPending}
              className="flex items-center justify-between px-3 py-2 rounded-md hover:bg-muted text-left transition-colors disabled:opacity-50"
            >
              <span className="text-[11px] font-medium truncate">{bid.client_name}</span>
              <Badge variant="outline" className="text-[9px] ml-2 shrink-0">
                {stageLabel(bid.stage)}
              </Badge>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
