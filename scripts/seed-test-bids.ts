import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const bids = [
  {
    client_name: "Acme Corp",
    title: "[TEST] Deal Qualification Bid",
    type: "rfp" as const,
    stage: "deal_qualification" as const,
    status: "active" as const,
    priority: "medium" as const,
    value: 250000,
    deadline: "2026-09-30",
  },
  {
    client_name: "GlobalTech Inc",
    title: "[TEST] RFP Stage Bid",
    type: "rfp" as const,
    stage: "rfp" as const,
    status: "active" as const,
    priority: "high" as const,
    value: 500000,
    deadline: "2026-08-15",
  },
];

const { data, error } = await supabase.from("bids").insert(bids).select("id, client_name, stage");

if (error) {
  console.error("Seed failed:", error.message);
  process.exit(1);
}

console.log("Seeded test bids:");
for (const bid of data) {
  console.log(`  ${bid.stage.padEnd(20)} ${bid.client_name}  (${bid.id})`);
}
