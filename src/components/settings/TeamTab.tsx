import { useState } from "react";
import { useTeamMembers, useRolePermissions, useBidAssignments } from "@/lib/settings-queries";
import { PermissionMatrix } from "./PermissionMatrix";
import { MemberList } from "./MemberList";
import { PendingApprovals } from "./PendingApprovals";
import { CreateUserModal } from "./CreateUserModal";

type Props = { isAdmin: boolean };

export function TeamTab({ isAdmin }: Props) {
  const [createOpen, setCreateOpen] = useState(false);
  const { data: members = [], isLoading: membersLoading } = useTeamMembers();
  const { data: permissions = [], isLoading: permsLoading } = useRolePermissions();
  useBidAssignments(); // warm cache

  if (membersLoading || (isAdmin && permsLoading)) {
    return (
      <div className="flex items-center justify-center py-16 text-[11px] text-muted-foreground">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 p-5">
      {isAdmin && <PendingApprovals />}
      {isAdmin && (
        <section>
          <h2 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
            Permission Matrix
          </h2>
          <PermissionMatrix permissions={permissions} />
        </section>
      )}

      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Team Members
          </h2>
          {isAdmin && (
            <button
              onClick={() => setCreateOpen(true)}
              className="h-6 px-2.5 rounded-md bg-primary text-white text-[10px] font-medium hover:opacity-90 transition-opacity"
            >
              + Add User
            </button>
          )}
        </div>
        <MemberList members={members} isAdmin={isAdmin} />
      </section>

      <CreateUserModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
