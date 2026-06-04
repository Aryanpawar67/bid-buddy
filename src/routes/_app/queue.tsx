import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMyQueue } from "@/lib/bid-queries";
import { useCurrentUser } from "@/lib/auth";
import { stageLabel, urgencyClass, initials } from "@/lib/bid-constants";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Circle, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/_app/queue")({
  component: MyQueuePage,
});

type Filter = "all" | "overdue" | "today" | "week" | "blocked";

function MyQueuePage() {
  const { user, profile } = useCurrentUser();
  const { data, isLoading } = useMyQueue(user?.id);
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>("all");

  const all = useMemo(() => {
    const items: Array<{
      id: string;
      kind: "question" | "deliverable";
      label: string;
      type: string;
      stage: string;
      status: string;
      due_date: string | null;
      bid: { id: string; client_name: string; title: string; stage: string; deadline: string };
    }> = [];
    for (const q of data?.questions ?? []) {
      items.push({
        id: q.id,
        kind: "question",
        label: q.question_text,
        type: "Question",
        stage: q.stage,
        status: q.status,
        due_date: q.due_date,
        bid: q.bids,
      });
    }
    for (const d of data?.deliverables ?? []) {
      items.push({
        id: d.id,
        kind: "deliverable",
        label: d.label,
        type: d.type,
        stage: d.stage,
        status: d.status,
        due_date: d.due_date,
        bid: d.bids,
      });
    }
    return items.filter((i) => {
      const dueDate = i.due_date ? new Date(i.due_date) : new Date(i.bid.deadline);
      const days = Math.ceil((dueDate.getTime() - Date.now()) / 86400000);
      if (filter === "overdue") return days < 0;
      if (filter === "today") return days === 0;
      if (filter === "week") return days >= 0 && days <= 7;
      if (filter === "blocked") return i.status === "blocked";
      return true;
    });
  }, [data, filter]);

  const grouped = useMemo(() => {
    const m = new Map<string, { bid: typeof all[number]["bid"]; items: typeof all }>();
    for (const it of all) {
      if (!m.has(it.bid.id)) m.set(it.bid.id, { bid: it.bid, items: [] });
      m.get(it.bid.id)!.items.push(it);
    }
    return [...m.values()].sort(
      (a, b) => new Date(a.bid.deadline).getTime() - new Date(b.bid.deadline).getTime(),
    );
  }, [all]);

  const today = all.filter((i) => {
    const d = i.due_date ? new Date(i.due_date) : new Date(i.bid.deadline);
    return Math.ceil((d.getTime() - Date.now()) / 86400000) === 0;
  }).length;
  const overdue = all.filter((i) => {
    const d = i.due_date ? new Date(i.due_date) : new Date(i.bid.deadline);
    return Math.ceil((d.getTime() - Date.now()) / 86400000) < 0;
  }).length;
  const inProgress = all.filter((i) => i.status === "in_progress").length;
  const done = all.filter((i) => i.status === "done").length;

  async function toggle(it: (typeof all)[number]) {
    const tbl = it.kind === "question" ? "bid_questions" : "bid_deliverables";
    const next = it.status === "done" ? "pending" : "done";
    await supabase.from(tbl).update({ status: next }).eq("id", it.id);
    qc.invalidateQueries({ queryKey: ["my-queue"] });
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[12px] font-medium">
              {initials(profile?.full_name ?? "?")}
            </div>
            <div>
              <h1 className="text-[16px] font-medium leading-tight">My queue</h1>
              <div className="text-[11px] text-muted-foreground">
                {all.length} open · {profile?.full_name}
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-3 mb-4">
          <Stat label="Due today" value={today} />
          <Stat label="Overdue" value={overdue} accent />
          <Stat label="In progress" value={inProgress} />
          <Stat label="Done" value={done} />
        </div>

        <div className="flex gap-1 mb-3">
          {(["all", "overdue", "today", "week", "blocked"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-[10px] uppercase tracking-wider px-2.5 h-7 rounded-md ${
                filter === f
                  ? "bg-primary text-primary-foreground"
                  : "bg-card hairline border text-muted-foreground hover:bg-muted"
              }`}
            >
              {f === "week" ? "Due this week" : f === "today" ? "Due today" : f}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="text-[12px] text-muted-foreground">Loading…</div>
        ) : grouped.length === 0 ? (
          <div className="bg-card hairline border rounded-xl p-10 text-center">
            <div className="text-[14px] font-medium">You're all caught up</div>
            <p className="text-[12px] text-muted-foreground mt-1">
              No outstanding items match this filter.
            </p>
            <Link to="/dashboard" className="text-[12px] text-primary mt-3 inline-block">
              Browse pipeline →
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {grouped.map((g) => {
              const u = urgencyClass(g.bid.deadline);
              return (
                <section key={g.bid.id} className="bg-card hairline border rounded-xl overflow-hidden">
                  <header className="px-4 py-2.5 hairline border-b bg-surface flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium leading-tight truncate">
                        {g.bid.client_name}
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">{g.bid.title}</div>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded-sm bg-primary-soft text-primary font-medium">
                      {stageLabel(g.bid.stage)}
                    </span>
                    <span className={`text-[11px] ${u.className}`}>{u.label}</span>
                    <Link
                      to="/bids/$id"
                      params={{ id: g.bid.id }}
                      className="text-[11px] text-primary inline-flex items-center gap-1 hover:underline"
                    >
                      Open <ArrowRight className="size-3" />
                    </Link>
                  </header>
                  <ul className="divide-y hairline divide-border">
                    {g.items.map((it) => (
                      <li key={it.id} className="flex items-start gap-3 px-4 py-2.5">
                        <button
                          onClick={() => toggle(it)}
                          className={`size-[18px] rounded-full flex items-center justify-center shrink-0 mt-0.5 hairline border ${
                            it.status === "done"
                              ? "bg-success-soft border-[#97C459]"
                              : "border-dashed border-border-strong"
                          }`}
                        >
                          {it.status === "done" ? (
                            <Check className="size-3 text-success-foreground" strokeWidth={2.5} />
                          ) : (
                            <Circle className="size-2 text-muted-foreground/40" />
                          )}
                        </button>
                        <div className="min-w-0 flex-1">
                          <div
                            className={`text-[12.5px] leading-snug ${
                              it.status === "done" ? "text-muted-foreground line-through" : ""
                            }`}
                          >
                            {it.label}
                          </div>
                          <div className="text-[10px] text-muted-foreground mt-0.5 flex gap-2">
                            <span className="capitalize">{it.type}</span>
                            <span>·</span>
                            <span>{stageLabel(it.stage)}</span>
                            {it.due_date && (
                              <>
                                <span>·</span>
                                <span>Due {new Date(it.due_date).toLocaleDateString()}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="bg-card hairline border rounded-lg p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-[20px] font-medium leading-none mt-1 ${accent && value > 0 ? "text-destructive" : ""}`}>
        {value}
      </div>
    </div>
  );
}
