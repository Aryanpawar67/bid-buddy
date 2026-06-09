import { useTeamMembers, useRolePermissions, useBidAssignments } from "@/lib/settings-queries";
import { PermissionMatrix } from "./PermissionMatrix";
import { MemberList } from "./MemberList";
import { PendingApprovals } from "./PendingApprovals";

type Props = { isAdmin: boolean };

export function TeamTab({ isAdmin }: Props) {
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
        <h2 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
          Team Members
        </h2>
        <MemberList members={members} isAdmin={isAdmin} />
      </section>
    </div>
  );
}
