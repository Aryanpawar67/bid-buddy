import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useBids } from "@/lib/bid-queries";
import { useCurrentUser } from "@/lib/auth";
import {
  useAiSessions,
  useCreateAiSession,
  useAiRequestCount,
  useAiChat,
  type AiSession,
} from "@/lib/ai-queries";
import { AiBidList, type AiMode } from "@/components/ai/AiBidList";
import { AiChatPanel } from "@/components/ai/AiChatPanel";
import { ConfigureDrawer } from "@/components/ai/ConfigureDrawer";
import { useDocuments } from "@/lib/doc-queries";
import { useAiConfigure } from "@/lib/ai-configure-context";

const MODEL_STORAGE_KEY = "bid-compass:ai-model";
const DEFAULT_MODEL = "claude-sonnet-4-6";

export const Route = createFileRoute("/_app/ai")({
  validateSearch: (search: Record<string, unknown>) => ({
    bidId: typeof search.bidId === "string" ? search.bidId : undefined,
  }),
  component: AiPage,
});

function AiPage() {
  const { user } = useCurrentUser();
  const { data: bids = [] } = useBids();
  const { open: configureOpen, setOpen: setConfigureOpen } = useAiConfigure();
  const { bidId: initialBidId } = Route.useSearch();

  const [mode, setMode] = useState<AiMode>("bid");
  const [selectedBidId, setSelectedBidId] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  // "__global" sentinel distinguishes global-mode creation from bid-mode (string bidId)
  const [creatingBidId, setCreatingBidId] = useState<string | null>(null);
  const [model, setModel] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem(MODEL_STORAGE_KEY) ?? DEFAULT_MODEL;
    }
    return DEFAULT_MODEL;
  });

  const createSession = useCreateAiSession();
  const { data: requestCount = 0 } = useAiRequestCount(user?.id);

  // Bid sessions — only load when a bid is selected in bid mode
  const bidSessionsQuery = useAiSessions(
    mode === "bid" && selectedBidId ? selectedBidId : undefined
  );
  // Global sessions — always load
  const globalSessionsQuery = useAiSessions(null);

  // Pass sessions for the selected bid only; other bids show empty until selected
  const sessionsMap: Record<string, AiSession[]> = selectedBidId
    ? { [selectedBidId]: bidSessionsQuery.data ?? [] }
    : {};

  const activeBid = bids.find((b) => b.id === selectedBidId) ?? null;

  const { data: bidDocs = [] } = useDocuments(
    mode === "bid" && selectedBidId ? { bidId: selectedBidId } : undefined
  );

  const { messages, isStreaming, inputValue, setInputValue, send } = useAiChat(
    selectedSessionId,
    mode === "global" ? null : selectedBidId,
    model
  );

  // Seed bid from URL search param on mount
  useEffect(() => {
    if (initialBidId && !selectedBidId) {
      setMode("bid");
      setSelectedBidId(initialBidId);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-select most recent session when bid sessions load
  useEffect(() => {
    if (
      mode === "bid" &&
      selectedBidId &&
      !selectedSessionId &&
      bidSessionsQuery.data?.length
    ) {
      setSelectedSessionId(bidSessionsQuery.data[0].id);
    }
  }, [selectedBidId, bidSessionsQuery.data, selectedSessionId, mode]);

  // Auto-select most recent global session on global mode switch
  useEffect(() => {
    if (mode === "global" && !selectedSessionId && globalSessionsQuery.data?.length) {
      setSelectedSessionId(globalSessionsQuery.data[0].id);
    }
  }, [mode, globalSessionsQuery.data, selectedSessionId]);

  function handleModelChange(newModel: string) {
    setModel(newModel);
    if (typeof window !== "undefined") {
      localStorage.setItem(MODEL_STORAGE_KEY, newModel);
    }
  }

  function handleModeChange(newMode: AiMode) {
    setMode(newMode);
    setSelectedBidId(null);
    setSelectedSessionId(null);
  }

  function handleSelectSession(bidId: string | null, sessionId: string) {
    setSelectedBidId(bidId);
    setSelectedSessionId(sessionId);
  }

  // Called when a bid row is expanded — triggers bidSessionsQuery and auto-select effect
  function handleBidSelect(bidId: string) {
    setSelectedBidId(bidId);
    setSelectedSessionId(null); // cleared so auto-select effect fires when sessions load
  }

  async function handleNewSession(bidId: string | null) {
    if (!user) return;
    const key = bidId ?? "__global";
    setCreatingBidId(key);
    try {
      const session = await createSession.mutateAsync({
        bidId,
        userId: user.id,
        model,
      });
      setSelectedBidId(bidId);
      setSelectedSessionId(session.id);
    } finally {
      setCreatingBidId(null);
    }
  }

  return (
    <div className="h-full flex overflow-hidden">
      <ConfigureDrawer open={configureOpen} onClose={() => setConfigureOpen(false)} />
      <AiBidList
        bids={bids}
        sessions={sessionsMap}
        globalSessions={globalSessionsQuery.data ?? []}
        mode={mode}
        onModeChange={handleModeChange}
        selectedBidId={selectedBidId}
        selectedSessionId={selectedSessionId}
        onSelectSession={handleSelectSession}
        onBidSelect={handleBidSelect}
        onNewSession={handleNewSession}
        creatingBidId={creatingBidId}
      />

      <AiChatPanel
        activeBid={activeBid}
        isGlobal={mode === "global"}
        sessionId={selectedSessionId}
        messages={messages}
        isStreaming={isStreaming}
        inputValue={inputValue}
        onInputChange={setInputValue}
        onSend={send}
        model={model}
        onModelChange={handleModelChange}
        requestCount={requestCount}
        bidDocs={bidDocs}
      />
    </div>
  );
}
