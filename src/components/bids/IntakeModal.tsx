import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PORTALS } from "@/lib/bid-constants";
import { useCurrentUser } from "@/lib/auth";

const schema = z.object({
  client_name: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(160),
  type: z.enum(["rfp", "rfi", "rfq", "direct"]),
  procurement_portal: z.string().min(1),
  deadline: z.string().min(1),
  clarification_deadline: z.string().optional().or(z.literal("")),
  orals_date: z.string().optional().or(z.literal("")),
  value: z.coerce.number().min(0).max(1_000_000_000),
  priority: z.enum(["high", "medium", "low"]),
  hubspot_deal_id: z.string().optional().or(z.literal("")),
});

type FormData = z.infer<typeof schema>;

export function IntakeModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { user } = useCurrentUser();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { type: "rfp", priority: "medium", procurement_portal: "Email", value: 0 },
  });

  async function onSubmit(data: FormData) {
    if (!user) return;
    const insert = {
      client_name: data.client_name,
      title: data.title,
      type: data.type,
      procurement_portal: data.procurement_portal,
      deadline: data.deadline,
      clarification_deadline: data.clarification_deadline || null,
      orals_date: data.orals_date || null,
      value: data.value,
      priority: data.priority,
      hubspot_deal_id: data.hubspot_deal_id || null,
      owner_id: user.id,
      created_by: user.id,
      stage: "deal_qualification" as const,
      status: "active" as const,
    };
    const { data: row, error } = await supabase.from("bids").insert(insert).select("id").single();
    if (error) {
      alert(error.message);
      return;
    }
    await supabase.from("bid_stage_history").insert({
      bid_id: row.id,
      stage: "deal_qualification",
      moved_by: user.id,
    });
    await supabase.from("bid_activity_log").insert({
      bid_id: row.id,
      user_id: user.id,
      action: "bid_created",
      metadata: { client: data.client_name },
    });
    qc.invalidateQueries({ queryKey: ["bids"] });
    reset();
    onOpenChange(false);
    navigate({ to: "/bids/$id", params: { id: row.id } });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-[15px]">New bid</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-2 gap-3 text-[12px]">
          <F label="Client name" err={errors.client_name?.message} className="col-span-2">
            <input {...register("client_name")} className={inputCls} />
          </F>
          <F label="Bid title" err={errors.title?.message} className="col-span-2">
            <input {...register("title")} className={inputCls} />
          </F>
          <F label="Bid type">
            <select {...register("type")} className={inputCls}>
              <option value="rfp">RFP</option>
              <option value="rfi">RFI</option>
              <option value="rfq">RFQ</option>
              <option value="direct">Direct</option>
            </select>
          </F>
          <F label="Procurement portal">
            <select {...register("procurement_portal")} className={inputCls}>
              {PORTALS.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </F>
          <F label="Submission deadline" err={errors.deadline?.message}>
            <input type="date" {...register("deadline")} className={inputCls} />
          </F>
          <F label="Clarification deadline">
            <input type="date" {...register("clarification_deadline")} className={inputCls} />
          </F>
          <F label="Orals / presentation">
            <input type="date" {...register("orals_date")} className={inputCls} />
          </F>
          <F label="Estimated value (USD)">
            <input type="number" step="1000" {...register("value")} className={inputCls} />
          </F>
          <F label="Priority">
            <select {...register("priority")} className={inputCls}>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </F>
          <F label="HubSpot deal ID (optional)">
            <input {...register("hubspot_deal_id")} className={inputCls} />
          </F>
          <div className="col-span-2 flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="h-8 px-3 rounded-md hairline border bg-card text-[12px] hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-[12px] font-medium disabled:opacity-50"
            >
              {isSubmitting ? "…" : "Create bid"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const inputCls =
  "w-full h-8 px-2 rounded-md hairline border bg-card text-[12px] focus:outline-none focus:ring-2 focus:ring-ring";

function F({
  label,
  err,
  children,
  className,
}: {
  label: string;
  err?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className ?? ""}`}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      {children}
      {err && <div className="text-[10px] text-destructive mt-1">{err}</div>}
    </label>
  );
}
