import type { Campaign } from "@/types/campaign";
import type { QcMap } from "./crmBuckets";

/**
 * "Monthly workflow — per team": ONE calculation, shared by all four roles.
 *
 * The server function `monthly_workflow_summary()` (migration 20) is the
 * source of truth, because migration 17 scoped reads per role — CONTENT
 * cannot read a PN CRM has not sent, CATEGORY cannot read CRM Self rows —
 * so counting client-side would give each login different numbers, which is
 * exactly the bug this fixes.
 *
 * `summariseLocally` exists only as a fallback when the RPC is unavailable
 * (migration 20 not yet applied). It uses the same stage definitions, so
 * the shapes cannot drift; it is just limited to rows the caller can read,
 * and the UI says so when it is used.
 *
 * Content is the only production team. design_status is never read.
 */

export interface WorkflowSummary {
  total: number;
  awaiting_category: number;
  crm_review: number;
  crm_ready: number;
  with_content: number;
  content_submitted: number;
  crm_reviewed: number;
  final_qc: number;
  on_calendar: number;
  emergencies: number;
  crm_self: number;
  category_led: number;
}

export const EMPTY_SUMMARY: WorkflowSummary = {
  total: 0, awaiting_category: 0, crm_review: 0, crm_ready: 0, with_content: 0, content_submitted: 0, crm_reviewed: 0,
  final_qc: 0, on_calendar: 0, emergencies: 0, crm_self: 0, category_led: 0,
};

/**
 * The flowchart nodes, in workflow order. Labels and team captions match
 * the original component's wording; the only change from before is that
 * Content is the sole production team, so there is no Design node.
 */
export const WORKFLOW_NODES: { key: keyof WorkflowSummary; label: string; team: string }[] = [
  { key: "awaiting_category",  label: "Category pending",     team: "Category" },
  { key: "crm_review",         label: "CRM review",           team: "CRM" },
  { key: "crm_ready",          label: "CRM processing",       team: "CRM" },
  { key: "with_content",       label: "With Content",         team: "Content" },
  { key: "content_submitted",  label: "Ready for CRM review", team: "CRM" },
  { key: "crm_reviewed",       label: "CRM reviewed",         team: "CRM" },
  { key: "final_qc",           label: "Final QC",             team: "CRM" },
  { key: "on_calendar",        label: "In calendar",          team: "Finalized" },
];

/** Previous name, kept so existing imports and tests keep working. */
export const WORKFLOW_ROWS = WORKFLOW_NODES;

/**
 * Mirrors monthly_workflow_summary() exactly. Kept in step with the SQL by
 * `monthlyWorkflow.test.ts`, which asserts the stage buckets partition the
 * population with no orphan and no double-count.
 */
export function summariseLocally(campaigns: Campaign[], qc: QcMap = {}): WorkflowSummary {
  const live = (c: Campaign) => c.calendar_status !== "UPDATED" && c.qc_status !== "PASSED";
  const reviewed = (c: Campaign) => qc[c.id]?.copy_verified === true;
  const unrouted = (c: Campaign) => c.content_status === "NOT_ASSIGNED";

  return {
    total: campaigns.length,
    // These three partition every unrouted, live row exactly once.
    // `category_submitted` used to exist with the SAME condition as
    // crm_review, double-counting every locked row; and CRM Self rows with
    // no template fell into no stage at all. Both are fixed here and in
    // migration 20, which must stay identical.
    awaiting_category: campaigns.filter((c) =>
      live(c) && unrouted(c) && !c.is_crm_self && c.category_status !== "LOCKED").length,
    crm_review: campaigns.filter((c) =>
      live(c) && unrouted(c) && !c.pn_template
      && (c.is_crm_self || c.category_status === "LOCKED")).length,
    crm_ready: campaigns.filter((c) =>
      live(c) && unrouted(c) && Boolean(c.pn_template)).length,
    with_content: campaigns.filter((c) =>
      live(c) && (c.content_status === "PENDING" || c.content_status === "NEEDS_CHANGES")).length,
    content_submitted: campaigns.filter((c) =>
      live(c) && c.content_status === "SUBMITTED" && !reviewed(c)).length,
    crm_reviewed: campaigns.filter((c) =>
      live(c) && c.content_status === "SUBMITTED" && reviewed(c)).length,
    final_qc: campaigns.filter((c) =>
      c.qc_status === "PASSED" && c.calendar_status !== "UPDATED").length,
    on_calendar: campaigns.filter((c) => c.calendar_status === "UPDATED").length,
    emergencies: campaigns.filter((c) => c.is_emergency).length,
    crm_self: campaigns.filter((c) => c.is_crm_self).length,
    category_led: campaigns.filter((c) => !c.is_crm_self).length,
  };
}

/* ---------------- Content-submitted split (CRM board banner) ---------------- */

/**
 * The combined Content total and its flow split, as one calculation.
 *
 * CRM saw 2 under "Incoming From Content" after Content submitted 5, and
 * assumed three were lost — the other three were CRM Self rows in the CRM
 * Self section. Nothing was missing; nothing said so. This is the number the
 * banner shows. It does NOT change bucket membership.
 */
export function contentSubmittedSplit(
  campaigns: Campaign[],
  inSection: (c: Campaign) => boolean
): { total: number; categoryLed: number; crmSelf: number; rows: Campaign[] } {
  const rows = campaigns.filter(inSection);
  return {
    total: rows.length,
    categoryLed: rows.filter((c) => !c.is_crm_self).length,
    crmSelf: rows.filter((c) => c.is_crm_self).length,
    rows,
  };
}
