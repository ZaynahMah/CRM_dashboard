import type { Campaign, QcChecklist } from "@/types/campaign";

export type Stage =
  | "AWAITING_CATEGORY" | "CATEGORY_SUBMITTED" | "CRM_REVIEW" | "CRM_PROCESSING"
  | "PRODUCTION_PENDING" | "PRODUCTION_SUBMITTED"
  | "FINAL_QC" | "READY" | "BLOCKED";

/**
 * One derived stage, so every screen tells the same story about a campaign.
 *
 * PARALLEL. Content and Design receive the campaign at the same time and
 * submit independently:
 *
 *   CRM Input -> Category (if applicable) -> CRM
 *     -> Content + Design together -> CRM (one combined review)
 *     -> Final QC -> Calendar
 *
 * This reverses the sequential model built earlier. The CRM checkpoint
 * between the two legs was removing a real cost (Design idle while Content
 * worked) without buying anything — CRM reviews both at once anyway.
 *
 * The combined leg means a campaign is "back with CRM" only when BOTH have
 * submitted. One team finishing early does not pull it out of the other's
 * queue.
 *
 * `calendar_status = 'UPDATED'` remains the single explicit finalization
 * signal, set only by CRM's Update Calendar action after QC passes.
 */
export function stageOf(c: Campaign): Stage {
  if (c.production_status === "BLOCKED") return "BLOCKED";
  if (c.calendar_status === "UPDATED") return "READY";
  if (c.qc_status === "PASSED") return "FINAL_QC";

  const contentDone = c.content_status === "SUBMITTED";
  const designDone = c.design_status === "SUBMITTED";
  const routed = c.crm_status === "SENT_TO_CONTENT"
    || c.content_status !== "NOT_ASSIGNED" || c.design_status !== "NOT_ASSIGNED";

  if (routed) {
    // Both back -> CRM's combined review. Either one alone -> still in flight.
    if (contentDone && designDone) return "PRODUCTION_SUBMITTED";
    return "PRODUCTION_PENDING";
  }

  if (c.crm_status === "IN_PLANNING") return "CRM_PROCESSING";
  if (c.crm_status === "AWAITING_REVIEW" && c.category_status === "LOCKED") return "CRM_REVIEW";
  if (c.category_status === "LOCKED" || c.category_status === "SUBMITTED") return "CATEGORY_SUBMITTED";
  return "AWAITING_CATEGORY";
}

/** True when both production teams are done and CRM owes a combined review. */
export const awaitingCombinedReview = (c: Campaign) =>
  c.content_status === "SUBMITTED" && c.design_status === "SUBMITTED"
  && c.qc_status !== "PASSED" && c.calendar_status !== "UPDATED";

/** True when CRM's next action is Final QC. */
export const awaitingFinalQc = (c: Campaign) =>
  c.design_status === "SUBMITTED" && c.qc_status !== "PASSED";

export const STAGE_LABEL: Record<Stage, string> = {
  AWAITING_CATEGORY: "Category pending",
  CATEGORY_SUBMITTED: "Category submitted",
  CRM_REVIEW: "CRM review",
  CRM_PROCESSING: "CRM processing",
  PRODUCTION_PENDING: "With Content + Design",
  PRODUCTION_SUBMITTED: "Ready for CRM review",
  FINAL_QC: "Final QC",
  READY: "In calendar",
  BLOCKED: "Blocked",
};

export const STAGE_ORDER: Stage[] = [
  "AWAITING_CATEGORY", "CATEGORY_SUBMITTED", "CRM_REVIEW", "CRM_PROCESSING",
  "PRODUCTION_PENDING", "PRODUCTION_SUBMITTED", "FINAL_QC", "READY",
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

/** Why a campaign is not yet in the calendar, in the operator's words. */
export function notReadyReason(c: Campaign): string | null {
  const s = stageOf(c);
  if (s === "READY") return null;
  return {
    AWAITING_CATEGORY: "Category details incomplete",
    CATEGORY_SUBMITTED: "Awaiting CRM review",
    CRM_REVIEW: "Awaiting CRM approve/request changes",
    CRM_PROCESSING: "CRM planning in progress",
    PRODUCTION_PENDING: "Content and/or Design still working",
    PRODUCTION_SUBMITTED: "Both submitted — awaiting CRM final QC",
    FINAL_QC: "QC passed — awaiting Update Calendar",
    BLOCKED: "Blocked",
  }[s as Exclude<Stage, "READY">];
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
