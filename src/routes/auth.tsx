import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/lib/auth";

export const Route = createFileRoute("/auth")({
  component: AuthPage,
});

function AuthPage() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const { session } = useSession();

  useEffect(() => {
    if (session) navigate({ to: "/", replace: true });
  }, [session, navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { full_name: name },
          },
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <img
            src="/imocha-logo.png"
            alt="iMocha"
            className="h-8 w-auto mx-auto mb-4"
          />
          <h1 className="text-[20px] font-medium">Bid Pursuit</h1>
          <p className="text-[12px] text-muted-foreground mt-1">
            iMocha Pursuit Compass
          </p>
        </div>
        <form onSubmit={submit} className="bg-card hairline border rounded-xl p-5 space-y-3">
          <div className="flex gap-1 p-0.5 bg-muted rounded-md text-[12px]">
            {(["signin", "signup"] as const).map((m) => (
              <button
                type="button"
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 h-7 rounded-sm ${mode === m ? "bg-card font-medium" : "text-muted-foreground"}`}
              >
                {m === "signin" ? "Sign in" : "Sign up"}
              </button>
            ))}
          </div>
          {mode === "signup" && (
            <Field label="Full name">
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full h-9 px-2.5 rounded-md hairline border bg-card text-[13px]"
              />
            </Field>
          )}
          <Field label="Email">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full h-9 px-2.5 rounded-md hairline border bg-card text-[13px]"
            />
          </Field>
          <Field label="Password">
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full h-9 px-2.5 rounded-md hairline border bg-card text-[13px]"
            />
          </Field>
          {err && <div className="text-[11px] text-destructive">{err}</div>}
          <button
            type="submit"
            disabled={busy}
            className="w-full h-9 rounded-md bg-primary text-primary-foreground text-[13px] font-medium disabled:opacity-50"
          >
            {busy ? "…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>
          <p className="text-[10px] text-muted-foreground text-center">
            New accounts are provisioned as Pre-Sales. Admins can change roles in Settings.
          </p>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[11px] text-muted-foreground mb-1">{label}</div>
      {children}
    </label>
  );
}
