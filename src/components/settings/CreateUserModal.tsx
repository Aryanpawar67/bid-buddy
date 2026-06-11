import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useCreateUser } from "@/lib/settings-queries";
import type { AppRole } from "@/lib/auth";

const ROLE_OPTIONS: { value: AppRole; label: string }[] = [
  { value: "pre_sales", label: "Pre-Sales" },
  { value: "legal", label: "Legal" },
  { value: "finance", label: "Finance" },
  { value: "admin", label: "Admin" },
];

type Props = { open: boolean; onClose: () => void };

export function CreateUserModal({ open, onClose }: Props) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<AppRole>("pre_sales");
  const [showPassword, setShowPassword] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const create = useCreateUser();

  function reset() {
    setEmail(""); setFullName(""); setPassword(""); setRole("pre_sales"); setShowPassword(false); setErr(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await create.mutateAsync({ email, password, fullName, role });
      reset();
      onClose();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to create user");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { reset(); onClose(); } }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-[13px] font-semibold">Create Team Member</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3 mt-1">
          <Field label="Full name">
            <input
              required
              placeholder="Jane Smith"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full h-8 px-2.5 rounded-md border border-border bg-background text-[12px] focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </Field>

          <Field label="Email address">
            <input
              type="email"
              required
              placeholder="jane@imocha.io"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full h-8 px-2.5 rounded-md border border-border bg-background text-[12px] focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </Field>

          <Field label="Role">
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as AppRole)}
              className="w-full h-8 px-2.5 rounded-md border border-border bg-background text-[12px] focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {ROLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>

          <Field label="Password (min 8 chars)">
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                required
                minLength={8}
                placeholder="········"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full h-8 px-2.5 pr-8 rounded-md border border-border bg-background text-[12px] focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPassword ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </button>
            </div>
          </Field>

          {err && (
            <div className="text-[11px] text-destructive bg-destructive/10 rounded-md px-2.5 py-1.5">
              {err}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => { reset(); onClose(); }}
              className="h-7 px-3 rounded-md border border-border text-[11px] text-muted-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={create.isPending}
              className="h-7 px-3 rounded-md bg-primary text-white text-[11px] font-medium hover:opacity-90 disabled:opacity-50"
            >
              {create.isPending ? "Creating…" : "Create User"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[11px] font-medium text-muted-foreground mb-1">{label}</div>
      {children}
    </label>
  );
}
