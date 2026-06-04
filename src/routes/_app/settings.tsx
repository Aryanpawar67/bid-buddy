import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/settings")({
  component: () => (
    <div className="h-full flex items-center justify-center px-6">
      <div className="max-w-md text-center">
        <h1 className="text-[18px] font-medium mb-1">Settings</h1>
        <p className="text-[12px] text-muted-foreground">
          User management, role assignment, HubSpot stage mapping and Slack webhooks in milestone 3.
        </p>
      </div>
    </div>
  ),
});
