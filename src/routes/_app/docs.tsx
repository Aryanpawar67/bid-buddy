import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/docs")({
  component: () => (
    <div className="h-full flex items-center justify-center px-6">
      <div className="max-w-md text-center">
        <h1 className="text-[18px] font-medium mb-1">Documents</h1>
        <p className="text-[12px] text-muted-foreground">
          Centralised, versioned bid documents land here. Upload from the intake modal in the next milestone.
        </p>
      </div>
    </div>
  ),
});
