import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/lib/auth";

export const Route = createFileRoute("/auth")({
  component: AuthPage,
});

const FEATURES = [
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3h18v18H3z" /><path d="M3 9h18M9 21V9" />
      </svg>
    ),
    title: "8-stage pipeline",
    desc: "Qualification to contract closure — every deal tracked in one place.",
  },
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a10 10 0 1 0 10 10" /><path d="M22 2 11 13" /><path d="m22 2-7 20-4-9-9-4 20-7z" />
      </svg>
    ),
    title: "AI proposal generation",
    desc: "Draft TA and TM proposals in seconds with Haiku-powered authoring.",
  },
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="9" cy="7" r="4" /><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /><path d="M21 21v-2a4 4 0 0 0-3-3.87" />
      </svg>
    ),
    title: "Role-based collaboration",
    desc: "Pre-sales, legal, finance and admin — everyone in their lane.",
  },
];

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
    <div className="min-h-screen flex">
      {/* ── Left panel ────────────────────────────────────────────── */}
      <div
        className="hidden lg:flex w-1/2 flex-col relative overflow-hidden"
        style={{ background: "#220032" }}
      >
        {/* Decorative circles */}
        <div
          className="absolute -bottom-32 -left-32 rounded-full opacity-[0.07]"
          style={{ width: 520, height: 520, background: "#FD5B0E" }}
        />
        <div
          className="absolute -top-24 -right-24 rounded-full opacity-[0.06]"
          style={{ width: 380, height: 380, background: "#491AEB" }}
        />
        {/* Dot grid */}
        <svg
          className="absolute inset-0 w-full h-full opacity-[0.04]"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <pattern id="dots" x="0" y="0" width="28" height="28" patternUnits="userSpaceOnUse">
              <circle cx="1.5" cy="1.5" r="1.5" fill="white" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#dots)" />
        </svg>

        {/* Content */}
        <div className="relative z-10 flex flex-col h-full p-12">
          {/* Logo */}
          <div className="flex items-center gap-2.5 mb-auto">
            <img src="/favicon.jpg" alt="iMocha" className="h-9 w-9 rounded-lg object-cover" />
            <div>
              <div className="text-white text-[15px] font-semibold leading-none">Bid Compass</div>
              <div className="text-white/40 text-[10px] uppercase tracking-widest mt-0.5">by iMocha</div>
            </div>
          </div>

          {/* Hero copy */}
          <div className="my-auto">
            <div
              className="text-[11px] font-semibold uppercase tracking-[0.2em] mb-4"
              style={{ color: "#FD5B0E" }}
            >
              Pre-sales command center
            </div>
            <h1 className="text-white text-[38px] font-bold leading-[1.15] mb-5">
              Win more bids.<br />Move faster.
            </h1>
            <p className="text-white/50 text-[14px] leading-relaxed max-w-xs">
              One workspace for your entire pursuit cycle — from deal qualification to contract closure.
            </p>

            {/* Feature list */}
            <div className="mt-10 space-y-5">
              {FEATURES.map((f) => (
                <div key={f.title} className="flex items-start gap-4">
                  <div
                    className="flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center"
                    style={{ background: "rgba(253,91,14,0.12)", color: "#FD5B0E" }}
                  >
                    {f.icon}
                  </div>
                  <div>
                    <div className="text-white text-[13px] font-medium">{f.title}</div>
                    <div className="text-white/40 text-[12px] mt-0.5 leading-relaxed">{f.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div className="text-white/20 text-[11px]">
            © {new Date().getFullYear()} iMocha Technologies
          </div>
        </div>
      </div>

      {/* ── Right panel ───────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col items-center justify-center bg-white px-8 py-12">
        {/* Mobile-only logo */}
        <div className="lg:hidden mb-8 text-center">
          <img src="/imocha-logo.png" alt="iMocha" className="h-7 w-auto mx-auto mb-2" />
          <div className="text-[13px] font-semibold text-gray-900">Bid Compass</div>
        </div>

        <div className="w-full max-w-sm">
          {/* Heading */}
          <div className="mb-8">
            <h2 className="text-[24px] font-bold text-gray-900">
              {mode === "signin" ? "Welcome back" : "Create account"}
            </h2>
            <p className="text-[13px] text-gray-400 mt-1">
              {mode === "signin"
                ? "Sign in to your iMocha Bid Compass account"
                : "Request access to Bid Compass"}
            </p>
          </div>

          {/* Form */}
          <form onSubmit={submit} className="space-y-4">
            {mode === "signup" && (
              <FormField label="Full name">
                <input
                  required
                  placeholder="Aryan Pawar"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full h-11 px-3.5 rounded-lg border border-gray-200 bg-gray-50 text-[13px] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#491AEB] focus:bg-white transition-colors"
                />
              </FormField>
            )}

            <FormField label="Email address">
              <input
                type="email"
                required
                placeholder="you@imocha.io"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full h-11 px-3.5 rounded-lg border border-gray-200 bg-gray-50 text-[13px] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#491AEB] focus:bg-white transition-colors"
              />
            </FormField>

            <FormField label="Password">
              <input
                type="password"
                required
                minLength={8}
                placeholder="········"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full h-11 px-3.5 rounded-lg border border-gray-200 bg-gray-50 text-[13px] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#491AEB] focus:bg-white transition-colors"
              />
            </FormField>

            {err && (
              <div className="text-[12px] text-red-500 bg-red-50 rounded-lg px-3.5 py-2.5">
                {err}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full h-11 rounded-lg text-[13px] font-semibold text-white transition-opacity disabled:opacity-60"
              style={{ background: "#FD5B0E" }}
            >
              {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Request access"}
            </button>
          </form>

          {/* Toggle mode */}
          <p className="mt-6 text-center text-[12px] text-gray-400">
            {mode === "signin" ? (
              <>
                New to Bid Compass?{" "}
                <button
                  type="button"
                  onClick={() => { setMode("signup"); setErr(null); }}
                  className="font-medium text-[#491AEB] hover:underline"
                >
                  Register & set up your account
                </button>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <button
                  type="button"
                  onClick={() => { setMode("signin"); setErr(null); }}
                  className="font-medium text-[#491AEB] hover:underline"
                >
                  Sign in
                </button>
              </>
            )}
          </p>

          {mode === "signup" && (
            <p className="mt-4 text-center text-[11px] text-gray-300">
              New accounts are provisioned as Pre-Sales.<br />Admins can change roles in Settings.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[12px] font-medium text-gray-600 mb-1.5">{label}</div>
      {children}
    </label>
  );
}
