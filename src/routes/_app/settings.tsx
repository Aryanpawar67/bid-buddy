import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useCurrentUser } from "@/lib/auth";
import { TeamTab } from "@/components/settings/TeamTab";
import { IntegrationsTab } from "@/components/settings/IntegrationsTab";

export const Route = createFileRoute("/_app/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const { isAdmin } = useCurrentUser();
  const [tab, setTab] = useState<"team" | "integrations">("team");

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-1 px-5 py-2.5 border-b hairline border-border bg-card shrink-0">
        {(["team", "integrations"] as const)
          .filter((t) => t === "team" || isAdmin)
          .map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={[
                "text-[11px] px-4 py-1.5 rounded-md border hairline transition-colors capitalize",
                tab === t
                  ? "bg-primary text-white border-primary"
                  : "border-border text-muted-foreground hover:bg-background",
              ].join(" ")}
            >
              {t === "team" ? "Team" : "Integrations"}
            </button>
          ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === "team" && <TeamTab isAdmin={isAdmin} />}
        {tab === "integrations" && isAdmin && <IntegrationsTab />}
      </div>
    </div>
  );
}
