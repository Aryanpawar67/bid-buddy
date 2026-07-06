export const STAGES = [
  { key: "deal_qualification", label: "Deal Qualification", short: "Qualify" },
  { key: "rfi", label: "RFI", short: "RFI" },
  { key: "rfp", label: "RFP", short: "RFP" },
  { key: "orals", label: "Orals", short: "Orals" },
  { key: "due_diligence", label: "Due Diligence", short: "DD" },
  { key: "bafo", label: "BAFO", short: "BAFO" },
  { key: "contract_closure", label: "Contract", short: "Contract" },
  { key: "post_closure", label: "Closure", short: "Closure" },
] as const;

export type StageKey = (typeof STAGES)[number]["key"];

export const STAGE_INDEX: Record<StageKey, number> = STAGES.reduce(
  (acc, s, i) => ({ ...acc, [s.key]: i }),
  {} as Record<StageKey, number>,
);

export function stageLabel(key: string): string {
  return STAGES.find((s) => s.key === key)?.label ?? key;
}

export const TEAM_LABEL: Record<string, string> = {
  pre_sales: "Pre-Sales",
  legal: "Legal",
  finance: "Finance",
  product: "Product",
  engineering: "Engineering",
};

export const ROLE_LABEL: Record<string, string> = {
  pre_sales: "Pre-Sales",
  legal: "Legal",
  finance: "Finance",
  admin: "Admin",
};

export const PORTALS = [
  "Workday",
  "Coupa",
  "SAP Ariba",
  "Jaggaer",
  "Oracle",
  "Client portal",
  "Email",
  "Other",
] as const;

export function urgencyClass(deadline: string | null | undefined): {
  label: string;
  className: string;
} {
  if (!deadline) return { label: "—", className: "text-muted-foreground" };
  const d = new Date(deadline);
  const days = Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (days < 0) return { label: `${Math.abs(days)}d over`, className: "text-[oklch(0.45_0.18_25)] font-medium" };
  if (days <= 2) return { label: `${days}d left`, className: "text-[oklch(0.5_0.22_25)] font-medium" };
  if (days <= 5) return { label: `${days}d left`, className: "text-warning-foreground font-medium" };
  return { label: `${days}d left`, className: "text-muted-foreground" };
}

export function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("") || "?";
}

export function fmtMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}
