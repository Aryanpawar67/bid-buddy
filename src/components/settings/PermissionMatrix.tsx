import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { useUpdateRolePermissions } from "@/lib/settings-queries";
import type { RolePermission } from "@/lib/settings-queries";

type Props = { permissions: RolePermission[] };

const ROLES = ["pre_sales", "legal", "finance"] as const;
const ROLE_LABELS: Record<string, string> = {
  pre_sales: "Pre-Sales",
  legal: "Legal",
  finance: "Finance",
};

type DirtyMap = Map<string, boolean>;

export function PermissionMatrix({ permissions }: Props) {
  const [dirty, setDirty] = useState<DirtyMap>(new Map());
  const update = useUpdateRolePermissions();

  const getValue = (id: string, fallback: boolean) =>
    dirty.has(id) ? (dirty.get(id) as boolean) : fallback;

  const toggle = (id: string, current: boolean) => {
    setDirty((prev) => {
      const next = new Map(prev);
      next.set(id, !current);
      return next;
    });
  };

  const handleSave = () => {
    const updates = Array.from(dirty.entries()).map(([id, allowed]) => ({ id, allowed }));
    update.mutate(updates, { onSuccess: () => setDirty(new Map()) });
  };

  const pages = permissions.filter((p) => p.resource_type === "page");
  const features = permissions.filter((p) => p.resource_type === "feature");

  const uniqueKeys = (items: RolePermission[]) =>
    [...new Set(items.map((p) => p.resource_key))].sort();

  const getCell = (key: string, role: string) =>
    permissions.find((p) => p.resource_key === key && p.role === role);

  const renderSection = (label: string, items: RolePermission[]) => {
    const keys = uniqueKeys(items);
    if (!keys.length) return null;
    return (
      <div key={label}>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-3 py-1.5 bg-muted/40 border-b hairline border-border">
          {label}
        </div>
        {keys.map((key) => (
          <div key={key} className="flex items-center border-b hairline border-border last:border-0">
            <div className="flex-1 px-3 py-2 text-[11px] text-foreground font-mono">
              {key.split(":").slice(1).join(":")}
            </div>
            {ROLES.map((role) => {
              const cell = getCell(key, role);
              if (!cell) return (
                <div key={role} className="w-20 flex justify-center py-2">
                  <span className="text-[10px] text-muted-foreground">—</span>
                </div>
              );
              const val = getValue(cell.id, cell.allowed);
              return (
                <div key={role} className="w-20 flex justify-center py-2">
                  <Switch
                    checked={val}
                    onCheckedChange={() => toggle(cell.id, val)}
                    className="scale-75"
                  />
                </div>
              );
            })}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="bg-card hairline border border-border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center border-b hairline border-border">
        <div className="flex-1 px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground">
          Resource
        </div>
        {ROLES.map((role) => (
          <div key={role} className="w-20 text-center py-2 text-[10px] uppercase tracking-wider text-muted-foreground">
            {ROLE_LABELS[role]}
          </div>
        ))}
      </div>

      {renderSection("Pages", pages)}
      {renderSection("Features", features)}

      {/* Footer */}
      <div className="flex items-center justify-end gap-2 px-3 py-2 border-t hairline border-border bg-muted/20">
        {dirty.size > 0 && (
          <span className="text-[10px] text-muted-foreground">{dirty.size} unsaved change{dirty.size !== 1 ? "s" : ""}</span>
        )}
        <button
          onClick={handleSave}
          disabled={dirty.size === 0 || update.isPending}
          className="text-[11px] px-3 py-1.5 rounded-md bg-primary text-white disabled:opacity-40 hover:opacity-90 transition-opacity"
        >
          {update.isPending ? "Saving…" : "Save Changes"}
        </button>
      </div>
    </div>
  );
}
