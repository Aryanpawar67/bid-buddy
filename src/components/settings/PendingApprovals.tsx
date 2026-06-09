import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  usePendingMembers,
  useApproveUser,
  useRejectUser,
} from "@/lib/settings-queries";
import type { AppRole } from "@/lib/auth";
import { initials } from "@/lib/bid-constants";

function fmtRole(role: string): string {
  return role.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

export function PendingApprovals() {
  const { data: members = [], isLoading } = usePendingMembers();
  const { data: pendingRoles = [] } = useQuery({
    queryKey: ["pending-member-roles"],
    queryFn: async () => {
      const { data } = await (supabase as any).from("user_roles").select("user_id, role");
      return (data ?? []) as { user_id: string; role: string }[];
    },
  });
  const approveUser = useApproveUser();
  const rejectUser = useRejectUser();

  if (isLoading) {
    return (
      <section>
        <h2 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
          Pending Approvals
        </h2>
        <div className="bg-card hairline border border-border rounded-lg divide-y divide-border">
          {[0, 1].map((i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2.5 animate-pulse">
              <div className="size-7 rounded-full bg-muted shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-2.5 bg-muted rounded w-32" />
                <div className="h-2 bg-muted rounded w-44" />
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (members.length === 0) return null;

  return (
    <section>
      <h2 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
        Pending Approvals
        <span className="ml-2 text-[10px] font-semibold bg-accent/15 text-accent px-1.5 py-px rounded-full">
          {members.length}
        </span>
      </h2>
      <div className="bg-card hairline border border-border rounded-lg divide-y divide-border">
        {members.map((member) => {
          const role = (pendingRoles.find((r) => r.user_id === member.id)?.role ?? "pre_sales") as AppRole;
          return (
            <div key={member.id} className="flex items-center gap-3 px-3 py-2.5">
              <div className="size-7 rounded-full bg-accent flex items-center justify-center text-[10px] font-semibold text-white shrink-0">
                {initials(member.full_name ?? member.email)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-medium text-foreground truncate">
                  {member.full_name ?? member.email}
                </div>
                <div className="text-[10px] text-muted-foreground truncate">{member.email}</div>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium shrink-0">
                {fmtRole(role)}
              </span>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => approveUser.mutate({ userId: member.id, role })}
                  disabled={approveUser.isPending}
                  className="h-7 px-3 rounded-md bg-primary text-white text-[11px] font-medium hover:opacity-90 disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  onClick={() => {
                    if (window.confirm("Reject this user? This cannot be undone.")) {
                      rejectUser.mutate(member.id);
                    }
                  }}
                  disabled={rejectUser.isPending}
                  className="h-7 px-3 rounded-md border hairline border-border-strong text-[11px] text-destructive hover:bg-destructive/5 disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
