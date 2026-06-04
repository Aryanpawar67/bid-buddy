import { createFileRoute } from "@tanstack/react-router";

function Placeholder({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div className="h-full flex items-center justify-center px-6">
      <div className="max-w-md text-center">
        <h1 className="text-[18px] font-medium mb-1">{title}</h1>
        <p className="text-[12px] text-muted-foreground">{blurb}</p>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-4">
          Coming in milestone 2
        </div>
      </div>
    </div>
  );
}

export const Analytics = () => (
  <Placeholder
    title="Analytics"
    blurb="Pipeline value, win rate, cycle time, blockers — six charts arriving in the next milestone."
  />
);

export const Route = createFileRoute("/_app/analytics")({ component: Analytics });
