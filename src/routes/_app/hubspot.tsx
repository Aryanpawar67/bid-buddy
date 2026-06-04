import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/hubspot")({
  component: () => (
    <div className="h-full flex items-center justify-center px-6">
      <div className="max-w-md text-center">
        <h1 className="text-[18px] font-medium mb-1">HubSpot sync</h1>
        <p className="text-[12px] text-muted-foreground">
          Bidirectional deal sync arrives in milestone 3. Bids already accept a HubSpot deal ID at intake.
        </p>
      </div>
    </div>
  ),
});
