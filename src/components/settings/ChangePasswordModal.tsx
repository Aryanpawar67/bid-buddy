import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useChangePassword } from "@/lib/settings-queries";

type Props = { open: boolean; onClose: () => void; userId: string; userName: string };

export function ChangePasswordModal({ open, onClose, userId, userName }: Props) {
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const change = useChangePassword();

  function reset() { setPassword(""); setErr(null); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await change.mutateAsync({ userId, newPassword: password });
      reset();
      onClose();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to update password");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { reset(); onClose(); } }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-[13px] font-semibold">
            Change Password — {userName}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3 mt-1">
          <label className="block">
            <div className="text-[11px] font-medium text-muted-foreground mb-1">
              New password (min 8 chars)
            </div>
            <input
              type="password"
              required
              minLength={8}
              placeholder="········"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full h-8 px-2.5 rounded-md border border-border bg-background text-[12px] focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </label>

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
              disabled={change.isPending}
              className="h-7 px-3 rounded-md bg-primary text-white text-[11px] font-medium hover:opacity-90 disabled:opacity-50"
            >
              {change.isPending ? "Saving…" : "Set Password"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
