import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/pending")({
  component: PendingPage,
});

function PendingPage() {
  return (
    <div className="h-screen flex items-center justify-center bg-background">
      <div className="max-w-sm text-center flex flex-col items-center gap-4 px-6">
        <div className="w-12 h-12 rounded-full bg-[#ede9fd] flex items-center justify-center text-2xl">⏳</div>
        <h1 className="text-[16px] font-semibold">Awaiting Approval</h1>
        <p className="text-[12px] text-muted-foreground leading-relaxed">
          Your account has been created and is pending admin approval. You'll be able to access BidCompass once an admin reviews and activates your account.
        </p>
        <p className="text-[11px] text-muted-foreground">If you believe this is an error, contact your administrator.</p>
      </div>
    </div>
  );
}
