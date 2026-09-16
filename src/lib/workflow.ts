import type { Campaign, QcChecklist } from "@/types/campaign";

export type Stage =
  | "AWAITING_CATEGORY" | "CATEGORY_SUBMITTED" | "CRM_PROCESSING" | "CONTENT_PENDING"
  | "CONTENT_SUBMITTED" | "FINAL_QC" | "READY" | "PUSHED" | "BLOCKED";

/** One derived stage, so every screen tells the same story about a campaign. */
export function stageOf(c: Campaign): Stage {
  if (c.production_status === "PUSHED") return "PUSHED";
  if (c.production_status === "BLOCKED") return "BLOCKED";
  if (c.production_status === "READY" || c.crm_status === "READY") return "READY";
  if (c.crm_status === "FINAL_QC") return "FINAL_QC";
  if (c.content_status === "SUBMITTED") return "CONTENT_SUBMITTED";
  if (c.crm_status === "SENT_TO_CONTENT" || c.content_status === "PENDING" || c.content_status === "NEEDS_CHANGES")
    return "CONTENT_PENDING";
  if (c.crm_status === "IN_PLANNING" || c.crm_status === "AWAITING_REVIEW") return "CRM_PROCESSING";
  if (c.category_status === "LOCKED" || c.category_status === "SUBMITTED") return "CATEGORY_SUBMITTED";
  return "AWAITING_CATEGORY";
}

export const STAGE_LABEL: Record<Stage, string> = {
  AWAITING_CATEGORY: "Awaiting Category",
  CATEGORY_SUBMITTED: "Category submitted",
  CRM_PROCESSING: "CRM processing",
  CONTENT_PENDING: "Content pending",
  CONTENT_SUBMITTED: "Content submitted",
  FINAL_QC: "Final QC",
  READY: "Ready",
  PUSHED: "Pushed",
  BLOCKED: "Blocked",
};

export const STAGE_ORDER: Stage[] = [
  "AWAITING_CATEGORY", "CATEGORY_SUBMITTED", "CRM_PROCESSING", "CONTENT_PENDING",
  "CONTENT_SUBMITTED", "FINAL_QC", "READY", "PUSHED",
];

/** RULE 12 — Ready is unreachable until every QC line is verified. */
export const QC_FIELDS: { key: keyof QcChecklist; label: string }[] = [
  { key: "category_verified", label: "Category verified" },
  { key: "brand_verified", label: "Brand verified" },
  { key: "offer_verified", label: "Offer verified" },
  { key: "landing_verified", label: "Landing verified" },
  { key: "date_verified", label: "Date verified" },
  { key: "time_verified", label: "Time verified" },
  { key: "audience_verified", label: "Audience verified" },
  { key: "creative_verified", label: "Creative verified" },
  { key: "copy_verified", label: "Copy verified" },
  { key: "tracking_verified", label: "Tracking verified" },
];

export const qcComplete = (qc: QcChecklist | null) =>
  !!qc && QC_FIELDS.every((f) => qc[f.key] === true);

/** Why a campaign is not ready, in the operator's words. */
export function notReadyReason(c: Campaign): string | null {
  const s = stageOf(c);
  if (s === "READY" || s === "PUSHED") return null;
  return {
    AWAITING_CATEGORY: "Category details incomplete",
    CATEGORY_SUBMITTED: "Awaiting CRM review",
    CRM_PROCESSING: "CRM planning in progress",
    CONTENT_PENDING: "Content pending",
    CONTENT_SUBMITTED: "Awaiting final QC",
    FINAL_QC: "Final QC in progress",
    BLOCKED: "Blocked",
  }[s as Exclude<Stage, "READY" | "PUSHED">];
}

/** Character ceilings for push copy. */
export const HEADER_LIMIT = 60;
export const SUB_COPY_LIMIT = 100;

export const REQUIRED_CATEGORY_FIELDS: (keyof Campaign)[] = [
  "campaign_name", "category", "sub_category", "brand",
  "campaign_type", "offer", "offer_details", "brief", "landing",
];

export function categoryCompleteness(draft: Partial<Campaign>) {
  const filled = REQUIRED_CATEGORY_FIELDS.filter((f) => {
    const v = draft[f];
    return typeof v === "string" ? v.trim().length > 0 : v != null;
  });
  return { filled: filled.length, total: REQUIRED_CATEGORY_FIELDS.length };
}
