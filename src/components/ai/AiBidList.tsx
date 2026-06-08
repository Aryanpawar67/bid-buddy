import { useState, useRef } from "react";
import { Plus, Loader2, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import type { Bid } from "@/lib/bid-queries";
import { urgencyClass, stageLabel } from "@/lib/bid-constants";
import type { AiSession } from "@/lib/ai-queries";
import { useRenameSession, useDeleteSession } from "@/lib/ai-queries";

export type AiMode = "bid" | "global";

type Props = {
  bids: Bid[];
  sessions: Record<string, AiSession[]>;
  globalSessions: AiSession[];
  mode: AiMode;
  onModeChange: (mode: AiMode) => void;
  selectedBidId: string | null;
  selectedSessionId: string | null;
  onSelectSession: (bidId: string | null, sessionId: string) => void;
  onBidSelect: (bidId: string) => void;
  onNewSession: (bidId: string | null) => void;
  creatingBidId: string | null;
};

export function AiBidList({
  bids,
  sessions,
  globalSessions,
  mode,
  onModeChange,
  selectedBidId,
  selectedSessionId,
  onSelectSession,
  onBidSelect,
  onNewSession,
  creatingBidId,
}: Props) {
  return (
    <div className="w-60 shrink-0 border-r hairline border-border bg-card flex flex-col h-full">
      {/* Mode toggle */}
      <div className="flex gap-0 p-2 border-b hairline border-border shrink-0">
        <button
          onClick={() => onModeChange("bid")}
          className={[
            "flex-1 text-[11px] font-semibold py-1.5 rounded-l-md border-y border-l hairline border-border transition-colors",
            mode === "bid"
              ? "bg-primary text-white border-primary"
              : "text-muted-foreground hover:bg-background",
          ].join(" ")}
        >
          Bid
        </button>
        <button
          onClick={() => onModeChange("global")}
          className={[
            "flex-1 text-[11px] font-semibold py-1.5 rounded-r-md border-y border-r border-l hairline border-border transition-colors",
            mode === "global"
              ? "bg-primary text-white border-primary"
              : "text-muted-foreground hover:bg-background",
          ].join(" ")}
        >
          Global
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {mode === "global" ? (
          <GlobalSessionList
            sessions={globalSessions}
            selectedSessionId={selectedSessionId}
            onSelectSession={(sid) => onSelectSession(null, sid)}
            onNewSession={() => onNewSession(null)}
            isCreating={creatingBidId === "__global"}
          />
        ) : (
          <BidSessionList
            bids={bids}
            sessions={sessions}
            selectedBidId={selectedBidId}
            selectedSessionId={selectedSessionId}
            onSelectSession={onSelectSession}
            onBidSelect={onBidSelect}
            onNewSession={onNewSession}
            creatingBidId={creatingBidId}
          />
        )}
      </div>
    </div>
  );
}

function GlobalSessionList({
  sessions,
  selectedSessionId,
  onSelectSession,
  onNewSession,
  isCreating,
}: {
  sessions: AiSession[];
  selectedSessionId: string | null;
  onSelectSession: (sid: string) => void;
  onNewSession: () => void;
  isCreating: boolean;
}) {
  return (
    <div className="p-2 flex flex-col gap-1">
      <div className="flex items-center justify-between px-1 py-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Global
        </span>
        <button
          onClick={onNewSession}
          disabled={isCreating}
          className="h-5 w-5 flex items-center justify-center rounded border hairline border-border text-muted-foreground hover:bg-background disabled:opacity-50"
        >
          {isCreating ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Plus className="size-3" />
          )}
        </button>
      </div>
      {sessions.length === 0 && (
        <div className="text-[10px] text-muted-foreground px-1 py-2">No sessions yet</div>
      )}
      {sessions.map((s) => (
        <SessionRow
          key={s.id}
          session={s}
          bidId={null}
          isSelected={selectedSessionId === s.id}
          onSelect={() => onSelectSession(s.id)}
        />
      ))}
    </div>
  );
}

function BidSessionList({
  bids,
  sessions,
  selectedBidId,
  selectedSessionId,
  onSelectSession,
  onBidSelect,
  onNewSession,
  creatingBidId,
}: {
  bids: Bid[];
  sessions: Record<string, AiSession[]>;
  selectedBidId: string | null;
  selectedSessionId: string | null;
  onSelectSession: (bidId: string, sessionId: string) => void;
  onBidSelect: (bidId: string) => void;
  onNewSession: (bidId: string) => void;
  creatingBidId: string | null;
}) {
  const [expandedBidId, setExpandedBidId] = useState<string | null>(selectedBidId);
  const activeBids = bids.filter((b) => b.status === "active");

  if (activeBids.length === 0) {
    return (
      <div className="text-[10px] text-muted-foreground px-3 py-3">No active bids</div>
    );
  }

  return (
    <div className="p-2 flex flex-col gap-1">
      {activeBids.map((bid) => {
        const bidSessions = sessions[bid.id] ?? [];
        const isExpanded = expandedBidId === bid.id;
        const urgency = urgencyClass(bid.deadline);

        return (
          <div key={bid.id}>
            <button
              onClick={() => {
                const nowExpanded = !isExpanded;
                setExpandedBidId(nowExpanded ? bid.id : null);
                if (nowExpanded) onBidSelect(bid.id);
              }}
              className={[
                "w-full text-left rounded-md px-2 py-2 transition-colors",
                selectedBidId === bid.id ? "bg-primary/10" : "hover:bg-background",
              ].join(" ")}
            >
              <div className="flex items-start justify-between gap-1">
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-medium truncate text-foreground">
                    {bid.client_name}
                  </div>
                  <div className="text-[9px] text-muted-foreground truncate mt-0.5">
                    {stageLabel(bid.stage)}
                  </div>
                </div>
                <span className={`text-[9px] shrink-0 ${urgency.className}`}>
                  {urgency.label}
                </span>
              </div>
            </button>

            {isExpanded && (
              <div className="ml-3 flex flex-col gap-0.5 mb-1">
                <div className="flex items-center justify-between px-1 py-0.5">
                  <span className="text-[9px] text-muted-foreground">Sessions</span>
                  <button
                    onClick={() => onNewSession(bid.id)}
                    disabled={creatingBidId === bid.id}
                    className="h-4 w-4 flex items-center justify-center rounded border hairline border-border text-muted-foreground hover:bg-background disabled:opacity-50"
                  >
                    {creatingBidId === bid.id ? (
                      <Loader2 className="size-2.5 animate-spin" />
                    ) : (
                      <Plus className="size-2.5" />
                    )}
                  </button>
                </div>
                {bidSessions.length === 0 && (
                  <div className="text-[9px] text-muted-foreground px-1">
                    No sessions yet
                  </div>
                )}
                {bidSessions.map((s) => (
                  <SessionRow
                    key={s.id}
                    session={s}
                    bidId={bid.id}
                    isSelected={selectedSessionId === s.id}
                    onSelect={() => onSelectSession(bid.id, s.id)}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SessionRow({
  session,
  bidId,
  isSelected,
  onSelect,
}: {
  session: AiSession;
  bidId: string | null;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const renameRef = useRef<HTMLInputElement>(null);
  const rename = useRenameSession();
  const del = useDeleteSession();

  function startRename() {
    setMenuOpen(false);
    setRenameValue(sessionLabel(session));
    setRenaming(true);
    setTimeout(() => renameRef.current?.select(), 0);
  }

  function commitRename() {
    if (renameValue.trim() !== sessionLabel(session)) {
      rename.mutate({ sessionId: session.id, title: renameValue, bidId });
    }
    setRenaming(false);
  }

  function handleRenameKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") commitRename();
    if (e.key === "Escape") setRenaming(false);
  }

  function handleDelete() {
    del.mutate({ sessionId: session.id, bidId });
    setConfirmDelete(false);
  }

  return (
    <div className="relative group">
      {renaming ? (
        <input
          ref={renameRef}
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={commitRename}
          onKeyDown={handleRenameKey}
          className="w-full text-[10px] rounded-md px-2 py-1 bg-background border hairline border-primary/50 text-foreground outline-none"
          autoFocus
        />
      ) : (
        <button
          onClick={onSelect}
          className={[
            "w-full text-left rounded-md px-2 py-1.5 transition-colors pr-7",
            isSelected
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:bg-background",
          ].join(" ")}
        >
          <div className="text-[10px] truncate">{sessionLabel(session)}</div>
          <div className="text-[9px] opacity-60">
            {new Date(session.created_at).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}
          </div>
        </button>
      )}

      {/* … menu trigger — hidden until hover */}
      {!renaming && (
        <button
          onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); setConfirmDelete(false); }}
          className="absolute right-1 top-1.5 h-5 w-5 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground hover:bg-background transition-opacity"
        >
          <MoreHorizontal className="size-3" />
        </button>
      )}

      {/* Inline menu */}
      {menuOpen && !confirmDelete && (
        <div className="absolute right-0 top-6 z-50 w-28 bg-card border hairline border-border rounded-lg shadow-lg overflow-hidden">
          <button
            onClick={(e) => { e.stopPropagation(); startRename(); }}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[11px] text-foreground hover:bg-background"
          >
            <Pencil className="size-3" /> Rename
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setMenuOpen(false); setConfirmDelete(true); }}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[11px] text-destructive hover:bg-background"
          >
            <Trash2 className="size-3" /> Delete
          </button>
        </div>
      )}

      {/* Delete confirm popover */}
      {confirmDelete && (
        <div className="absolute right-0 top-6 z-50 w-44 bg-card border hairline border-border rounded-lg shadow-lg p-2.5 flex flex-col gap-2">
          <div className="text-[10px] text-foreground">Delete this session?</div>
          <div className="flex gap-1.5">
            <button
              onClick={(e) => { e.stopPropagation(); handleDelete(); }}
              disabled={del.isPending}
              className="flex-1 text-[10px] py-1 rounded-md bg-destructive text-white disabled:opacity-50"
            >
              {del.isPending ? "…" : "Delete"}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setConfirmDelete(false); }}
              className="flex-1 text-[10px] py-1 rounded-md border hairline border-border text-muted-foreground hover:bg-background"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function sessionLabel(s: AiSession): string {
  if (s.title) return s.title;
  const firstUser = (s.messages as { role: string; content: string }[]).find(
    (m) => m.role === "user"
  );
  if (firstUser) {
    const label = firstUser.content.slice(0, 32);
    return label + (firstUser.content.length > 32 ? "…" : "");
  }
  return "New session";
}
