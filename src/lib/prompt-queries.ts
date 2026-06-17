import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type PromptVersion = {
  id: string;
  prompt_text: string;
  label: string | null;
  created_by: string | null;
  created_at: string;
  is_active: boolean;
};

export function usePromptVersions() {
  return useQuery({
    queryKey: ["prompt-versions"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("prompt_versions")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PromptVersion[];
    },
  });
}

export function useActivePrompt() {
  return useQuery({
    queryKey: ["prompt-versions", "active"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("prompt_versions")
        .select("*")
        .eq("is_active", true)
        .maybeSingle();
      return data as PromptVersion | null;
    },
  });
}

// Save a new prompt version and mark it active, deactivating all others.
export function useSavePrompt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { promptText: string; label?: string; createdBy: string }) => {
      // Deactivate existing active version
      await (supabase as any)
        .from("prompt_versions")
        .update({ is_active: false })
        .eq("is_active", true);

      // Insert new active version
      const { data, error } = await (supabase as any)
        .from("prompt_versions")
        .insert({
          prompt_text: input.promptText,
          label: input.label ?? null,
          created_by: input.createdBy,
          is_active: true,
        })
        .select()
        .single();
      if (error) throw error;
      return data as PromptVersion;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["prompt-versions"] });
    },
  });
}

// Restore a specific version as active.
export function useRestorePrompt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (versionId: string) => {
      await (supabase as any)
        .from("prompt_versions")
        .update({ is_active: false })
        .eq("is_active", true);

      const { error } = await (supabase as any)
        .from("prompt_versions")
        .update({ is_active: true })
        .eq("id", versionId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["prompt-versions"] });
    },
  });
}
