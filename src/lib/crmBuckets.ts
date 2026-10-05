import type { Campaign } from "@/types/campaign";
import type { QcChecklist } from "@/types/campaign";

/**
 * The CRM dashboard's bucket definitions, as pure functions over a campaign
 * and its QC checklist row.
 *
 * These are derived entirely from columns that already exist. No new status
 * value and no migration was introduced for this board:
 *
 *   - CRM Part 2 complete  ->  pn_template is filled
 *   - CRM reviewed Content ->  qc_checklists.copy_verified
 *   - CRM reviewed Design  ->  qc_checklists.creative_verified
 *
 * copy_verified and creative_verified are two of the ten existing Final QC
 * checklist fields. Ticking one here is the same tick CRM would make in
 * Final QC, so the dashboard and Final QC read the same row and cannot
 * disagree.
 */

export type QcMap = Record<string, QcChecklist | undefined>;

const flag = (qc: QcMap, c: Campaign, key: "copy_verified" | "creative_verified") =>
  qc[c.id]?.[key] === true;

/** CRM's Part 2 is considered done once the PN template is chosen. */
export const part2Complete = (c: Campaign) => Boolean(c.pn_template);

/* ---------- 1. Incoming from Category ---------- */

export const fromCategoryPending = (c: Campaign) =>
  c.category_status === "LOCKED" && !part2Complete(c)
  && c.content_status === "NOT_ASSIGNED" && c.design_status === "NOT_ASSIGNED";

export const fromCategoryCompleted = (c: Campaign) =>
  c.category_status === "LOCKED" && part2Complete(c)
  && c.content_status === "NOT_ASSIGNED" && c.design_status === "NOT_ASSIGNED";

/* ---------- 2. Incoming from Content + Design (ONE combined queue) ---------- */

/**
 * Content and Design now work in parallel and CRM reviews their output
 * ONCE, together. There is no longer a separate "incoming from Content"
 * and "incoming from Design" — a campaign is in this queue when BOTH have
 * submitted, and CRM does a single final QC.
 *
 * `copy_verified` and `creative_verified` are still the review markers, but
 * they are now two checkboxes on one review rather than two separate
 * gates in sequence. Completed means both are ticked.
 */
export const bothSubmitted = (c: Campaign) =>
  c.content_status === "SUBMITTED" && c.design_status === "SUBMITTED";

export const fromProductionPending = (c: Campaign, qc: QcMap) =>
  bothSubmitted(c) && c.qc_status !== "PASSED"
  && !(flag(qc, c, "copy_verified") && flag(qc, c, "creative_verified"));

export const fromProductionCompleted = (c: Campaign, qc: QcMap) =>
  bothSubmitted(c) && c.qc_status !== "PASSED"
  && flag(qc, c, "copy_verified") && flag(qc, c, "creative_verified");

/** In flight: routed, but at least one team has not submitted yet. */
export const inProduction = (c: Campaign) =>
  !bothSubmitted(c)
  && (c.content_status !== "NOT_ASSIGNED" || c.design_status !== "NOT_ASSIGNED");

/* ---------- CRM Self: leg 1 is the upload itself ---------- */

/**
 * CRM Self rows skip Category, so their first section is the upload itself
 * and its two buckets key off CRM's own completeness, not category_status.
 * Both require the row to be un-routed, so they are mutually exclusive.
 */
export const crmSelfUploadPending = (c: Campaign) =>
  c.content_status === "NOT_ASSIGNED" && !part2Complete(c);

export const crmSelfUploadCompleted = (c: Campaign) =>
  c.content_status === "NOT_ASSIGNED" && part2Complete(c);

/* ---------- flow split ---------- */

export const isCategoryLed = (c: Campaign) => !c.is_crm_self;
export const isCrmSelf = (c: Campaign) => c.is_crm_self;
