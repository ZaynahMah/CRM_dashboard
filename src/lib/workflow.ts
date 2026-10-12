import type { Campaign, QcChecklist } from "@/types/campaign";

export type Stage =
  | "AWAITING_CATEGORY" | "CATEGORY_SUBMITTED" | "CRM_REVIEW" | "CRM_PROCESSING"
  | "PRODUCTION_PENDING" | "PRODUCTION_SUBMITTED"
  | "FINAL_QC" | "READY" | "BLOCKED";

/**
 * One derived stage, so every screen tells the same story about a campaign.
 *
 * CONTENT IS THE ONLY PRODUCTION TEAM. `design_status` is never read here.
 * A PN is PRODUCTION_SUBMITTED the moment Content submits; nothing waits on
 * Design.
 *
 *   CRM Self:     CRM Upload -> Content -> CRM Final QC -> Calendar
 *   Category-led: CRM Upload -> Category -> CRM -> Content -> CRM Final QC -> Calendar
 *   Emergency:    Category raises -> CRM Accept -> Content -> CRM Final QC -> Calendar
 *
 * `calendar_status = 'UPDATED'` remains the single explicit finalization
 * signal, set only by the update_calendar() RPC after QC passes.
 */
export function stageOf(c: Campaign): Stage {
  if (c.production_status === "BLOCKED") return "BLOCKED";
  if (c.calendar_status === "UPDATED") return "READY";
  if (c.qc_status === "PASSED") return "FINAL_QC";

  if (c.content_status === "SUBMITTED") return "PRODUCTION_SUBMITTED";
  if (c.crm_status === "SENT_TO_CONTENT" || c.content_status === "PENDING"
      || c.content_status === "NEEDS_CHANGES") return "PRODUCTION_PENDING";

  if (c.crm_status === "IN_PLANNING") return "CRM_PROCESSING";
  if (c.crm_status === "AWAITING_REVIEW" && c.category_status === "LOCKED") return "CRM_REVIEW";
  if (c.category_status === "LOCKED" || c.category_status === "SUBMITTED") return "CATEGORY_SUBMITTED";
  return "AWAITING_CATEGORY";
}

/** True when Content is done and CRM owes a review. */
export const awaitingCrmReview = (c: Campaign) =>
  c.content_status === "SUBMITTED" && c.qc_status !== "PASSED"
  && c.calendar_status !== "UPDATED";

/** True when CRM's next action is Final QC. */
export const awaitingFinalQc = (c: Campaign) =>
  c.content_status === "SUBMITTED" && c.qc_status !== "PASSED";

export const STAGE_LABEL: Record<Stage, string> = {
  AWAITING_CATEGORY: "Category pending",
  CATEGORY_SUBMITTED: "Category submitted",
  CRM_REVIEW: "CRM review",
  CRM_PROCESSING: "CRM processing",
  PRODUCTION_PENDING: "With Content",
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

/**
 * Creative verification only applies when there IS a creative.
 *
 * The Design team has gone and `creative_link` is optional, so most PNs have
 * nothing to verify. Requiring the tick anyway made it a rubber stamp — and
 * a checklist people tick without looking is worse than one box fewer.
 */
export const creativeRequired = (c: Pick<Campaign, "creative_link"> | null | undefined) =>
  Boolean(c?.creative_link && c.creative_link.trim() !== "");

/** The checks that actually apply to this campaign. */
export const requiredQcFields = (c: Pick<Campaign, "creative_link"> | null | undefined) =>
  creativeRequired(c) ? QC_FIELDS : QC_FIELDS.filter((f) => f.key !== "creative_verified");

/** Labels for checks that are not applicable, shown as "N/A". */
export const QC_NA_LABEL = "N/A – no creative";

/**
 * Passing `campaign` makes creative_verified conditional. It is optional so
 * existing callers keep the strict behaviour rather than silently loosening.
 */
export const qcComplete = (
  qc: QcChecklist | null,
  campaign?: Pick<Campaign, "creative_link"> | null
) => {
  if (!qc) return false;
  const fields = campaign === undefined ? QC_FIELDS : requiredQcFields(campaign);
  return fields.every((f) => qc[f.key] === true);
};

/** Which applicable checks are still unticked. */
export const missingQcFields = (
  qc: QcChecklist | null,
  campaign?: Pick<Campaign, "creative_link"> | null
) => {
  const fields = campaign === undefined ? QC_FIELDS : requiredQcFields(campaign);
  return fields.filter((f) => qc?.[f.key] !== true).map((f) => f.label);
};

/** Why a campaign is not yet in the calendar, in the operator's words. */
export function notReadyReason(c: Campaign): string | null {
  const s = stageOf(c);
  if (s === "READY") return null;
  return {
    AWAITING_CATEGORY: "Category details incomplete",
    CATEGORY_SUBMITTED: "Awaiting CRM review",
    CRM_REVIEW: "Awaiting CRM approve/request changes",
    CRM_PROCESSING: "CRM planning in progress",
    PRODUCTION_PENDING: "With Content — copy pending",
    PRODUCTION_SUBMITTED: "Content submitted — awaiting CRM final QC",
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
