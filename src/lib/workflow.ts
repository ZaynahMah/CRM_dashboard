import type { Campaign, QcChecklist } from "@/types/campaign";

export type Stage =
  | "AWAITING_CATEGORY" | "CATEGORY_SUBMITTED" | "CRM_REVIEW" | "CRM_PROCESSING"
  | "CONTENT_PENDING" | "CONTENT_SUBMITTED"
  | "DESIGN_PENDING" | "DESIGN_SUBMITTED"
  | "FINAL_QC" | "READY" | "BLOCKED";

/**
 * One derived stage, so every screen tells the same story about a campaign.
 * Driven entirely by the columns the app actually writes to today —
 * `calendar_status` is the single, explicit finalization signal (set only
 * by CRM's "Update Calendar" action after QC passes), not an inferred
 * heuristic on `production_status`. A campaign is never "READY" here unless
 * that explicit action has happened.
 *
 * SEQUENTIAL, not parallel. Content and Design are two separate legs with a
 * CRM checkpoint between them:
 *
 *   CRM Input -> Category -> CRM -> Content -> CRM -> Design -> CRM
 *   -> Final QC -> Calendar
 *
 * The ordering of the checks below IS the sequence, read bottom-up. It needs
 * no new columns: `design_status` simply stays NOT_ASSIGNED until CRM has
 * reviewed Content's work and routed the campaign onward, so "Content done,
 * not yet with Design" is already a distinguishable state.
 */
export function stageOf(c: Campaign): Stage {
  if (c.production_status === "BLOCKED") return "BLOCKED";
  if (c.calendar_status === "UPDATED") return "READY";
  if (c.qc_status === "PASSED") return "FINAL_QC";

  // Design leg — only reachable once CRM has routed it there.
  if (c.design_status === "SUBMITTED") return "DESIGN_SUBMITTED";
  if (c.design_status === "PENDING") return "DESIGN_PENDING";

  // Content leg.
  if (c.content_status === "SUBMITTED") return "CONTENT_SUBMITTED";
  if (c.crm_status === "SENT_TO_CONTENT" || c.content_status === "PENDING" ||
      c.content_status === "NEEDS_CHANGES")
    return "CONTENT_PENDING";

  if (c.crm_status === "IN_PLANNING") return "CRM_PROCESSING";
  if (c.crm_status === "AWAITING_REVIEW" && c.category_status === "LOCKED") return "CRM_REVIEW";
  if (c.category_status === "LOCKED" || c.category_status === "SUBMITTED") return "CATEGORY_SUBMITTED";
  return "AWAITING_CATEGORY";
}

/** True when CRM's next action is to route this campaign to Design. */
export const awaitingDesignRouting = (c: Campaign) =>
  c.content_status === "SUBMITTED" && c.design_status === "NOT_ASSIGNED"
  && c.qc_status !== "PASSED" && c.calendar_status !== "UPDATED";

/** True when CRM's next action is Final QC. */
export const awaitingFinalQc = (c: Campaign) =>
  c.design_status === "SUBMITTED" && c.qc_status !== "PASSED";

export const STAGE_LABEL: Record<Stage, string> = {
  AWAITING_CATEGORY: "Category pending",
  CATEGORY_SUBMITTED: "Category submitted",
  CRM_REVIEW: "CRM review",
  CRM_PROCESSING: "CRM processing",
  CONTENT_PENDING: "With Content",
  CONTENT_SUBMITTED: "CRM review (post-Content)",
  DESIGN_PENDING: "With Design",
  DESIGN_SUBMITTED: "CRM review (post-Design)",
  FINAL_QC: "Final QC",
  READY: "In calendar",
  BLOCKED: "Blocked",
};

export const STAGE_ORDER: Stage[] = [
  "AWAITING_CATEGORY", "CATEGORY_SUBMITTED", "CRM_REVIEW", "CRM_PROCESSING",
  "CONTENT_PENDING", "CONTENT_SUBMITTED", "DESIGN_PENDING", "DESIGN_SUBMITTED",
  "FINAL_QC", "READY",
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
    CONTENT_PENDING: "With Content — copy pending",
    CONTENT_SUBMITTED: "Content submitted — awaiting CRM review before Design",
    DESIGN_PENDING: "With Design — creative pending",
    DESIGN_SUBMITTED: "Design submitted — awaiting final QC",
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
