import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PORTALS } from "@/lib/bid-constants";
import { useCurrentUser } from "@/lib/auth";
import { useRef, useState } from "react";
import { useUploadAndIndexDocument } from "@/lib/doc-queries";
import { Paperclip, X as XIcon } from "lucide-react";

const schema = z.object({
  client_name: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(160),
  type: z.enum(["rfp", "rfi", "rfq", "direct"]),
  product_type: z.enum(["TA", "TM"]).optional().or(z.literal("")).transform((v) => v || undefined),
  procurement_portal: z.string().min(1),
  deadline: z.string().min(1),
  clarification_deadline: z.string().optional().or(z.literal("")),
  orals_date: z.string().optional().or(z.literal("")),
  value: z.coerce.number().min(0).max(1_000_000_000),
  priority: z.enum(["high", "medium", "low"]),
  hubspot_deal_id: z.string().optional().or(z.literal("")),
  contact_name: z.string().optional().or(z.literal("")),
  contact_email: z.string().optional().or(z.literal("")),
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
  const upload = useUploadAndIndexDocument();
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { type: "rfp", priority: "medium", procurement_portal: "Email", value: 0 },
  });

  function addFiles(incoming: File[]) {
    const valid = incoming.filter((f) => f.size <= 26_214_400 && /\.(pdf|docx|xlsx)$/i.test(f.name));
    setPendingFiles((prev) => [...prev, ...valid]);
  }

  function removeFile(i: number) {
    setPendingFiles((prev) => prev.filter((_, j) => j !== i));
  }

  async function onSubmit(data: FormData) {
    if (!user) return;
    const insert = {
      client_name: data.client_name,
      title: data.title,
      type: data.type,
      product_type: (data.product_type as "TA" | "TM" | undefined) ?? null,
      procurement_portal: data.procurement_portal,
      deadline: data.deadline,
      clarification_deadline: data.clarification_deadline || null,
      orals_date: data.orals_date || null,
      value: data.value,
      priority: data.priority,
      hubspot_deal_id: data.hubspot_deal_id || null,
      contact_name: data.contact_name || null,
      contact_email: data.contact_email || null,
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

    // Upload any attached documents linked to the new bid
    for (const file of pendingFiles) {
      try {
        await upload.mutateAsync({
          file,
          type: "rfp",
          bidId: row.id,
          stage: "deal_qualification",
        });
      } catch (e) {
        console.error("Doc upload failed:", e);
      }
    }

    qc.invalidateQueries({ queryKey: ["bids"] });
    reset();
    setPendingFiles([]);
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
          <F label="Product (TA / TM)">
            <select {...register("product_type")} className={inputCls}>
              <option value="">— select —</option>
              <option value="TA">TA — Talent Acquisition / Skills Assessment</option>
              <option value="TM">TM — Talent Management / Skills Intelligence</option>
            </select>
          </F>
          <F label="Procurement portal" className="col-span-2">
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
          <F label="Contact name (optional)">
            <input {...register("contact_name")} placeholder="e.g. Jane Smith" className={inputCls} />
          </F>
          <F label="Contact email (optional)">
            <input type="email" {...register("contact_email")} placeholder="e.g. jane@acme.com" className={inputCls} />
          </F>
          {/* Document attachments */}
          <div className="col-span-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
              Documents <span className="normal-case font-normal">(optional — PDF, DOCX, XLSX)</span>
            </div>
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed rounded-md px-3 py-3 cursor-pointer hover:border-primary/50 transition-colors"
            >
              {pendingFiles.length === 0 ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Paperclip className="size-3.5 shrink-0" />
                  <span className="text-[11px]">Click to attach files</span>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {pendingFiles.map((f, i) => (
                    <div key={i} className="flex items-center gap-2 text-[11px]">
                      <Paperclip className="size-3 text-muted-foreground shrink-0" />
                      <span className="truncate flex-1 text-foreground">{f.name}</span>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                        className="shrink-0 text-muted-foreground hover:text-destructive"
                      >
                        <XIcon className="size-3" />
                      </button>
                    </div>
                  ))}
                  <div className="text-[10px] text-primary mt-1">+ Add more files</div>
                </div>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.docx,.xlsx"
              className="hidden"
              onChange={(e) => {
                addFiles(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
          </div>

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
