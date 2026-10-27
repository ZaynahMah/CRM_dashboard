import type { Campaign } from "@/types/campaign";
import type { QcChecklist } from "@/types/campaign";

/**
 * The CRM dashboard's bucket definitions, as pure functions over a campaign
 * and its QC checklist row.
 *
 * CONTENT IS THE ONLY PRODUCTION TEAM. The Design team has left, so
 * `design_status` is NEVER read here for routing or visibility. The column
 * still exists and still holds history, but no bucket, stage or count
 * depends on it. A PN is back with CRM the moment Content submits.
 *
 * Derived entirely from columns that already exist; no new status value and
 * no schema change:
 *
 *   - CRM Part 2 complete  ->  pn_template is filled
 *   - CRM reviewed Content ->  qc_checklists.copy_verified
 *
 * `copy_verified` is one of the ten existing Final QC checklist fields, so
 * ticking it here is the same tick CRM would make in Final QC — the board
 * and Final QC read the same row and cannot disagree.
 *
 * INVARIANTS, enforced by tests:
 *   ZERO ORPHANS  - every non-terminal status combination lands in at least
 *                   one visible section, so no PN can ever disappear.
 *   ZERO OVERLAPS - no PN is actionable in two sections at once.
 */

export type QcMap = Record<string, QcChecklist | undefined>;

const flag = (qc: QcMap, c: Campaign, key: "copy_verified" | "creative_verified") =>
  qc[c.id]?.[key] === true;

/** CRM's Part 2 is considered done once the PN template is chosen. */
export const part2Complete = (c: Campaign) => Boolean(c.pn_template);

/** Terminal: finalized onto the calendar. Shown by Calendar / Final View. */
export const isOnCalendar = (c: Campaign) => c.calendar_status === "UPDATED";

/**
 * Routed to Content and not yet returned.
 *
 * Keyed on content_status ALONE. The previous version also accepted
 * `crm_status === 'SENT_TO_CONTENT'`, which contradicts
 * `content_status = 'NOT_ASSIGNED'` — a row in that inconsistent state read
 * as both "not yet sent" and "with Content" at the same time. content_status
 * is the column the send actually writes, so it is the only one to trust.
 */
export const withContent = (c: Campaign) =>
  c.content_status === "PENDING" || c.content_status === "NEEDS_CHANGES";

/* ============ 1. Incoming Inputs From Category (Category-led only) ============ */

/**
 * A PN that missed its own TAT. Per PN, never per week — this is the ONE
 * definition of "defaulted" in the app. The old Day 0/1/2/3 week ladder is
 * gone (migration 28).
 */
export const isDefaulted = (c: Campaign) => Boolean(c.defaulted_at);

/** Category may no longer edit a defaulted PN; it belongs to CRM now. */
export const categoryReadOnly = (c: Campaign) =>
  isDefaulted(c) || c.category_status === "LOCKED" || c.category_status === "SUBMITTED";

export const fromCategoryPending = (c: Campaign) =>
  c.category_status === "LOCKED" && !part2Complete(c)
  && c.content_status === "NOT_ASSIGNED";

export const fromCategoryCompleted = (c: Campaign) =>
  c.category_status === "LOCKED" && part2Complete(c)
  && c.content_status === "NOT_ASSIGNED";

/* ============ 2. Incoming From Content ============ */

/**
 * Content alone decides this now. The previous version required
 * `design_status === 'SUBMITTED'` as well, which is why a PN submitted by
 * Content never appeared for CRM once Design stopped submitting — the
 * bucket condition could never be true. That was the Final QC visibility
 * bug.
 */
export const contentSubmitted = (c: Campaign) => c.content_status === "SUBMITTED";

/** Content submitted, CRM has not reviewed it yet. */
export const fromContentPending = (c: Campaign, qc: QcMap) =>
  contentSubmitted(c) && c.qc_status !== "PASSED" && !isOnCalendar(c)
  && !flag(qc, c, "copy_verified");

/** CRM reviewed the copy — ready for Final QC and the calendar. */
export const fromContentReady = (c: Campaign, qc: QcMap) =>
  contentSubmitted(c) && c.qc_status !== "PASSED" && !isOnCalendar(c)
  && flag(qc, c, "copy_verified");

/**
 * Passed QC but not yet pushed. Still CRM's to act on, so it must remain
 * visible — without this a PN between "QC passed" and "on calendar" would
 * belong to no section at all.
 */
export const awaitingCalendarPush = (c: Campaign) =>
  c.qc_status === "PASSED" && !isOnCalendar(c);

/* ============ CRM Self upload ============ */

/**
 * CRM Self PNs skip Category. The upload writes `content_status: 'PENDING'`
 * and routes them straight to Content, so the previous conditions — which
 * required `content_status === 'NOT_ASSIGNED'` — matched nothing and the
 * section always showed 0. That was the CRM Self visibility bug.
 *
 * Pending  = uploaded, CRM input not finished (no pn_template).
 * Complete = CRM input finished. Stays visible after being sent to Content,
 *            read-only, so CRM can see what it handed over.
 */
export const crmSelfUploadPending = (c: Campaign) =>
  c.content_status === "NOT_ASSIGNED" && !isOnCalendar(c)
  && c.qc_status !== "PASSED" && !part2Complete(c);

/**
 * Actionable: CRM input finished, not yet handed over. These are the rows
 * "Bulk Send Selected to Content" acts on — it is no longer a no-op,
 * because the upload no longer routes anything automatically.
 */
export const crmSelfUploadCompleted = (c: Campaign) =>
  c.content_status === "NOT_ASSIGNED" && !isOnCalendar(c)
  && c.qc_status !== "PASSED" && part2Complete(c);

/**
 * Read-only: already handed to Content. Stays visible in the same section
 * so CRM can see what it handed over, but offers no action.
 */
export const sentToContent = (c: Campaign) => withContent(c);

/* ============ flow split ============ */

export const isCategoryLed = (c: Campaign) => !c.is_crm_self;
export const isCrmSelf = (c: Campaign) => c.is_crm_self;

/* ============ orphan guard ============ */

/**
 * Every section a campaign is visible in, across the whole app. The
 * zero-orphan test asserts this is never empty for a non-terminal row.
 * Terminal rows (on the calendar) are visible on Calendar / Final View.
 */
export function visibleSections(c: Campaign, qc: QcMap): string[] {
  const out: string[] = [];
  const self = c.is_crm_self;

  if (isOnCalendar(c)) { out.push("calendar"); return out; }

  if (c.production_status === "BLOCKED") out.push("crm:blocked");

  if (self) {
    if (crmSelfUploadPending(c)) out.push("crmself:upload/pending");
    if (crmSelfUploadCompleted(c)) out.push("crmself:upload/complete");
    if (sentToContent(c)) out.push("crmself:sent-to-content");
  } else {
    // Defaulted PNs are CRM's to fill, and must appear in exactly one
    // place: their own section, not also under Pending CRM Input.
    if (isDefaulted(c) && !part2Complete(c)) out.push("category/defaulted");
    else if (fromCategoryPending(c)) out.push("category/pending");
    else if (fromCategoryCompleted(c)) out.push("category/complete");
    // Category-led rows not yet locked belong to Category's own queue.
    if (c.category_status !== "LOCKED") out.push("category:queue");
  }

  if (withContent(c)) out.push("content:queue");
  if (fromContentPending(c, qc)) out.push((self ? "crmself:" : "") + "content/pending");
  if (fromContentReady(c, qc)) out.push((self ? "crmself:" : "") + "content/ready");
  if (awaitingCalendarPush(c)) out.push("finalqc");

  return out;
}

/** The sections that offer CRM a bulk action — used by the overlap test. */
export function actionableSections(c: Campaign, qc: QcMap): string[] {
  const self = c.is_crm_self;
  const out: string[] = [];
  if (isOnCalendar(c)) return out;
  if (self) {
    if (crmSelfUploadPending(c)) out.push("crmself:upload/pending");
    if (crmSelfUploadCompleted(c)) out.push("crmself:upload/complete");
    // sentToContent is deliberately absent: it is a read-only record of
    // what CRM handed over, not a section offering an action.
  } else {
    // Defaulted PNs are CRM's to fill, and must appear in exactly one
    // place: their own section, not also under Pending CRM Input.
    if (isDefaulted(c) && !part2Complete(c)) out.push("category/defaulted");
    else if (fromCategoryPending(c)) out.push("category/pending");
    else if (fromCategoryCompleted(c)) out.push("category/complete");
  }
  if (fromContentPending(c, qc)) out.push("content/pending");
  if (fromContentReady(c, qc)) out.push("content/ready");
  return out;
}
