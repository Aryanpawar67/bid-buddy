import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { indexDocument } from "@/lib/api/doc-functions";

export type DocType = "rfp" | "proposal" | "legal" | "template" | "reference";

export type BidDocument = {
  id: string;
  bid_id: string | null;
  name: string;
  type: DocType;
  stage: string | null;
  storage_path: string;
  size_bytes: number;
  uploaded_by: string;
  embedding: number[] | null;
  created_at: string;
  source: "uploaded" | "generated";
};

export type DocFilters = {
  type?: DocType;
  bidId?: string;
  globalOnly?: boolean;
};

// ── useDocuments ─────────────────────────────────────────────────────────────
export function useDocuments(filters?: DocFilters) {
  return useQuery({
    queryKey: ["documents", filters],
    queryFn: async () => {
      let q = supabase
        .from("bid_documents")
        .select("*")
        .order("created_at", { ascending: false });

      if (filters?.type) q = q.eq("type", filters.type);
      if (filters?.bidId) q = q.eq("bid_id", filters.bidId);
      if (filters?.globalOnly) q = q.is("bid_id", null);

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as BidDocument[];
    },
  });
}

// ── useUploadDocument ─────────────────────────────────────────────────────────
export function useUploadDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      file: File;
      type: DocType;
      bidId: string | null;
      stage: string | null;
    }) => {
      const docId = crypto.randomUUID();
      const path = `${docId}/${input.file.name}`;

      // 1. Upload to Supabase Storage
      const { error: storageErr } = await supabase.storage
        .from("bid-documents")
        .upload(path, input.file, { upsert: false });
      if (storageErr) throw storageErr;

      // 2. Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // 3. Insert bid_documents record
      const { data: doc, error: insertErr } = await supabase
        .from("bid_documents")
        .insert({
          id: docId,
          name: input.file.name,
          type: input.type,
          bid_id: input.bidId,
          stage: input.stage,
          storage_path: path,
          size_bytes: input.file.size,
          uploaded_by: user.id,
          source: "uploaded",
        })
        .select()
        .single();
      if (insertErr) throw insertErr;

      // 4. Trigger server-side indexing (async — badge appears when embedding populates)
      indexDocument({ data: { documentId: doc.id } }).catch(console.error);

      return doc as BidDocument;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["documents"] });
    },
  });
}

// ── useReplaceDocument ────────────────────────────────────────────────────────
export function useReplaceDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      documentId: string;
      file: File;
      storagePath: string;
    }) => {
      // 1. Re-upload to the same storage path
      const { error: storageErr } = await supabase.storage
        .from("bid-documents")
        .upload(input.storagePath, input.file, { upsert: true });
      if (storageErr) throw storageErr;

      // 2. Update size, clear stale embedding so badge shows "indexing"
      const { error: updateErr } = await supabase
        .from("bid_documents")
        .update({ size_bytes: input.file.size, embedding: null })
        .eq("id", input.documentId);
      if (updateErr) throw updateErr;

      // 3. Re-index
      indexDocument({ data: { documentId: input.documentId } }).catch(console.error);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["documents"] });
    },
  });
}

// ── useUploadAndIndexDocument ──────────────────────────────────────────────────
// Like useUploadDocument but AWAITS indexDocument so chunks exist on resolve.
export function useUploadAndIndexDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      file: File;
      type: DocType;
      bidId: string | null;
      stage: string | null;
    }) => {
      const docId = crypto.randomUUID();
      const path = `${docId}/${input.file.name}`;

      const { error: upErr } = await supabase.storage
        .from("bid-documents")
        .upload(path, input.file, { upsert: false });
      if (upErr) throw upErr;

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data: doc, error: insertErr } = await (supabase as any)
        .from("bid_documents")
        .insert({
          id: docId,
          name: input.file.name,
          type: input.type,
          bid_id: input.bidId,
          stage: input.stage,
          storage_path: path,
          size_bytes: input.file.size,
          uploaded_by: user.id,
          source: "uploaded",
        })
        .select()
        .single();
      if (insertErr) throw insertErr;

      // Await real indexing — not fire-and-forget.
      // fetchPinnedChunks in stream-chat.ts reads bid_document_chunks,
      // which only exist after this resolves.
      await indexDocument({ data: { documentId: (doc as BidDocument).id } });
      return doc as BidDocument;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["documents"] }),
  });
}

// ── useDeleteDocument ─────────────────────────────────────────────────────────
export function useDeleteDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { documentId: string; storagePath: string }) => {
      // Delete storage object first (chunks + record deleted via DB cascade)
      await supabase.storage.from("bid-documents").remove([input.storagePath]);
      const { error } = await supabase
        .from("bid_documents")
        .delete()
        .eq("id", input.documentId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["documents"] });
    },
  });
}
