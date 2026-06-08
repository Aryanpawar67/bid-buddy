import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useBidAssignments, useUpdateMemberRole, useRemoveBidAssignment, useSuspendUser } from "@/lib/settings-queries";
import type { TeamMember } from "@/lib/settings-queries";
import type { AppRole } from "@/lib/auth";
import { BidAssignModal } from "./BidAssignModal";
import { initials } from "@/lib/bid-constants";

type Props = { members: TeamMember[]; isAdmin: boolean };

const ROLE_OPTIONS: { value: AppRole; label: string }[] = [
  { value: "admin", label: "Admin" },
  { value: "pre_sales", label: "Pre-Sales" },
  { value: "legal", label: "Legal" },
  { value: "finance", label: "Finance" },
];

function MemberRow({ member, isAdmin }: { member: TeamMember; isAdmin: boolean }) {
  const [assignOpen, setAssignOpen] = useState(false);
  const updateRole = useUpdateMemberRole();
  const removeAssignment = useRemoveBidAssignment();
  const suspend = useSuspendUser();
  const { data: assignments = [] } = useBidAssignments(member.id);

  const assignedBidIds = assignments.map((a) => a.bid_id);

  return (
    <div className="flex items-start gap-3 px-3 py-2.5 border-b hairline border-border last:border-0">
      {/* Avatar */}
      <div className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-semibold shrink-0 mt-0.5">
        {member.avatar_url ? (
          <img src={member.avatar_url} className="w-full h-full rounded-full object-cover" alt="" />
        ) : (
          initials(member.full_name ?? member.email)
        )}
      </div>

      {/* Name + Email */}
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-medium truncate">{member.full_name ?? "—"}</div>
        <div className="text-[10px] text-muted-foreground truncate">{member.email}</div>

        {/* Assigned bids pills */}
        <div className="flex flex-wrap gap-1 mt-1.5">
          {assignments.map((a) => (
            <span
              key={a.id}
              className="inline-flex items-center gap-1 text-[10px] bg-muted px-2 py-0.5 rounded-full hairline border border-border"
            >
              {a.bids?.client_name ?? "Bid"}
              {isAdmin && (
                <button
                  onClick={() => removeAssignment.mutate(a.id)}
                  className="text-muted-foreground hover:text-destructive transition-colors ml-0.5"
                  aria-label="Remove assignment"
                >
                  ×
                </button>
              )}
            </span>
          ))}
          {isAdmin && (
            <button
              onClick={() => setAssignOpen(true)}
              className="inline-flex items-center text-[10px] text-primary hover:underline"
            >
              + Add Bid
            </button>
          )}
        </div>
      </div>

      {/* Role */}
      <div className="shrink-0 w-28">
        {isAdmin ? (
          <Select
            value={member.primaryRole}
            onValueChange={(val) =>
              updateRole.mutate({ userId: member.id, newRole: val as AppRole })
            }
          >
            <SelectTrigger className="h-7 text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} className="text-[11px]">
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="text-[11px] text-muted-foreground capitalize">
            {member.primaryRole.replace("_", " ")}
          </span>
        )}
      </div>

      {/* Status badge + suspend */}
      <div className="shrink-0 flex items-center gap-2 pt-0.5">
        {member.status === "suspended" && (
          <span className="text-[9px] uppercase tracking-wider text-destructive bg-destructive/10 px-1.5 py-0.5 rounded">
            Suspended
          </span>
        )}
        {isAdmin && member.status !== "suspended" && (
          <button
            onClick={() => suspend.mutate(member.id)}
            disabled={suspend.isPending}
            className="text-[10px] text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40"
          >
            Suspend
          </button>
        )}
      </div>

      <BidAssignModal
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        userId={member.id}
        assignedBidIds={assignedBidIds}
      />
    </div>
  );
}

export function MemberList({ members, isAdmin }: Props) {
  if (!members.length) {
    return (
      <div className="bg-card hairline border border-border rounded-lg px-4 py-8 text-center text-[11px] text-muted-foreground">
        No active members yet.
      </div>
    );
  }

  return (
    <div className="bg-card hairline border border-border rounded-lg overflow-hidden">
      <div className="flex items-center gap-3 px-3 py-2 border-b hairline border-border bg-muted/30">
        <div className="w-7 shrink-0" />
        <div className="flex-1 text-[10px] uppercase tracking-wider text-muted-foreground">Member</div>
        <div className="w-28 text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">Role</div>
        <div className="w-20 shrink-0" />
      </div>
      {members.map((m) => (
        <MemberRow key={m.id} member={m} isAdmin={isAdmin} />
      ))}
    </div>
  );
}
