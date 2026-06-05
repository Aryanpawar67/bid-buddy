import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/lib/auth";
import { useBids } from "@/lib/bid-queries";

export type CalendarEvent = {
  id: string;
  title: string;
  event_date: string;
  created_by: string;
  created_at: string;
};

export type ViewMode = "team" | "personal";

// Returns active bids filtered by owner_id in personal mode.
// Derives from cached useBids() data — not a query itself.
export function useCalendarBids(mode: ViewMode) {
  const { user } = useCurrentUser();
  const { data: bids = [] } = useBids();
  return bids.filter((b) => {
    if (b.status !== "active") return false;
    if (mode === "personal") return b.owner_id === user?.id;
    return true;
  });
}

export function useCalendarEvents(mode: ViewMode) {
  const { user } = useCurrentUser();
  return useQuery({
    queryKey: ["calendar-events", mode, user?.id],
    enabled: !!user,
    queryFn: async () => {
      let query = supabase
        .from("bid_events")
        .select("*")
        .order("event_date", { ascending: true });
      if (mode === "personal") {
        query = query.eq("created_by", user!.id);
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as CalendarEvent[];
    },
  });
}

export function useCreateEvent() {
  const { user } = useCurrentUser();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ title, event_date }: { title: string; event_date: string }) => {
      const { error } = await supabase.from("bid_events").insert({
        title,
        event_date,
        created_by: user!.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["calendar-events"] });
    },
  });
}

export function useDeleteEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("bid_events").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["calendar-events"] });
    },
  });
}
