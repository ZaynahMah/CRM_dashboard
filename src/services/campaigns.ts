"use client";

import { canMoveForward, missingPart2 } from "@/lib/crmPart2";
import { fetchCampaignsByIds } from "./contentBulk";

import { supabase } from "@/lib/supabase";
import type {
  ActivityLog, Campaign, ChangeRequest, ContentSubmission, CrmDecision, QcChecklist,
} from "@/types/campaign";
import { qcComplete, missingQcFields } from "@/lib/workflow";
import {
  trackingCheck, suggestTrackingFields, buildTrackingCode, buildLandingPlusTracking,
} from "@/lib/trackingCode";

const TABLE = "campaigns";

/**
 * Ordering is fully deterministic, down to the primary key. Ordering by
 * launch_date alone is not: dozens of rows legitimately share a date, and
 * Postgres gives no guaranteed order for ties — so two identical queries
 * could return the same rows in a different sequence. In a grid of inline
 * inputs that reads as "my value jumped to another row". The id tiebreaker
 * makes every refetch return the same sequence.
 */
/**
 * PostgREST caps a response at `max-rows` (1,000 by default on Supabase),
 * and it does so SILENTLY — no error, just a short array. With 3,000
 * campaigns the dashboard would show the first 1,000 and quietly lose the
 * rest, which is indistinguishable from the data not existing.
 *
 * So every page is fetched explicitly until a short page comes back.
 */
export const PAGE_SIZE = 1000;

export async function listCampaigns(filters: Record<string, string | boolean> = {}) {
  const all: Campaign[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let q = supabase
      .from(TABLE)
      .select("*")
      .order("launch_date", { ascending: true })
      .order("launch_time", { ascending: true, nullsFirst: true })
      .order("slot_number", { ascending: true, nullsFirst: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    Object.entries(filters).forEach(([k, v]) => { q = q.eq(k, v); });
    const { data, error } = await q;
    if (error) throw error;
    const page = (data ?? []) as Campaign[];
    all.push(...page);
    // A short page means this was the last one. Guard against a runaway
    // loop if the server ever returns a full page forever.
    if (page.length < PAGE_SIZE || all.length > 100_000) break;
  }
  return all;
}

export async function getCampaign(id: string) {
  const [{ data: campaign }, { data: decision }, { data: content }, { data: qc }, { data: logs }] =
    await Promise.all([
      supabase.from(TABLE).select("*").eq("id", id).single(),
      supabase.from("crm_decisions").select("*").eq("campaign_id", id).maybeSingle(),
      supabase.from("content_submissions").select("*").eq("campaign_id", id).maybeSingle(),
      supabase.from("qc_checklists").select("*").eq("campaign_id", id).maybeSingle(),
      supabase.from("activity_logs").select("*").eq("campaign_id", id).order("created_at", { ascending: false }),
    ]);
  return {
    campaign: campaign as Campaign,
    decision: (decision ?? null) as CrmDecision | null,
    content: (content ?? null) as ContentSubmission | null,
    qc: (qc ?? null) as QcChecklist | null,
    logs: (logs ?? []) as ActivityLog[],
  };
}

/** RULE 14 — every meaningful action writes to the audit trail. */
export async function log(campaignId: string | null, userId: string | null, action: string, description: string) {
  await supabase.from("activity_logs").insert({ campaign_id: campaignId, user_id: userId, action, description });
}

export async function notify(targetRole: string, type: string, title: string, message: string, campaignId?: string) {
  await supabase.from("notifications").insert({
    target_role: targetRole, type, title, message, campaign_id: campaignId ?? null,
  });
}

export async function createCampaign(input: Partial<Campaign>, userId: string) {
  const { data, error } = await supabase.from(TABLE).insert({ ...input, created_by: userId }).select().single();
  if (error) throw error;
  return data as Campaign;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Every campaign write goes through here, and every one is scoped to a
 * single UUID. The guard exists because a blank or undefined id would
 * otherwise reach PostgREST as `id=eq.` — which errors rather than matching
 * everything, but fails far from the cause. Failing here names the caller.
 */
export async function updateCampaign(id: string, patch: Partial<Campaign>) {
  if (!id || !UUID_RE.test(id)) {
    throw new Error(`updateCampaign was called without a valid campaign id (got ${JSON.stringify(id)}).`);
  }
  const { data, error } = await supabase.from(TABLE).update(patch).eq("id", id).select().single();
  if (error) throw error;
  return data as Campaign;
}

/** RULE 7 — submitting locks the Category block through a database function. */
export async function submitCategory(campaign: Campaign, userId: string) {
  const { error } = await supabase.rpc("submit_category", { p_campaign_id: campaign.id });
  if (error) throw error;
  await log(campaign.id, userId, "CATEGORY_SUBMITTED", "Category submitted campaign details.");
  await notify("CRM", "REVIEW", "Campaign awaiting review",
    `${campaign.campaign_name} is ready for CRM review.`, campaign.id);
}

/**
 * Locks exactly one campaign's Category block. Goes through the existing
 * submit_category() RPC, which is SECURITY DEFINER, role-checked, and
 * updates `where id = p_campaign_id` — one row, by UUID, server-side.
 *
 * Deliberately not the same as submitCategory() above: that one also fires
 * a CRM notification, which is right for a one-off submit but would be spam
 * when locking rows individually across a grid. The activity log still
 * records every lock.
 */
export async function lockCategoryInput(campaignId: string, userId: string) {
  if (!campaignId || !UUID_RE.test(campaignId)) {
    throw new Error(`lockCategoryInput was called without a valid campaign id (got ${JSON.stringify(campaignId)}).`);
  }
  const { error } = await supabase.rpc("submit_category", { p_campaign_id: campaignId });
  if (error) throw error;
  await log(campaignId, userId, "CATEGORY_ROW_LOCKED", "Category locked this row's input.");
}

/**
 * Reopens one locked row. CRM only — and not by choice of the UI: RLS
 * policy `campaigns_update` (migration 12) only permits the CATEGORY role
 * to update rows whose category_status is EMPTY or DRAFT, so a Category
 * user physically cannot move a row back out of LOCKED. The button is
 * hidden for them rather than shown and then failing.
 */
export async function unlockCategoryInput(campaignId: string, userId: string) {
  await updateCampaign(campaignId, { category_status: "DRAFT" });
  await log(campaignId, userId, "CATEGORY_ROW_UNLOCKED", "CRM reopened this row for Category edits.");
}

export async function saveDecision(campaignId: string, patch: Partial<CrmDecision>, userId: string) {
  const { data: existing } = await supabase
    .from("crm_decisions").select("id").eq("campaign_id", campaignId).maybeSingle();
  if (existing) {
    const { error } = await supabase.from("crm_decisions").update(patch).eq("id", existing.id);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("crm_decisions").insert({ ...patch, campaign_id: campaignId, created_by: userId });
    if (error) throw error;
  }
}

export async function sendToContent(campaign: Campaign, userId: string) {
  /**
   * The gate, enforced where the STATUS CHANGES rather than only in the UI,
   * so a disabled button cannot be bypassed by any other caller.
   *
   * A PN that has already moved on is never re-validated — existing rows
   * sent to Content, through QC or on the calendar are untouched.
   */
  if (!canMoveForward(campaign)) {
    throw new Error(
      `Cannot send to Content — still needed: ${missingPart2(campaign).join(", ")}.`);
  }
  await updateCampaign(campaign.id, { crm_status: "SENT_TO_CONTENT", content_status: "PENDING" });
  await log(campaign.id, userId, "SENT_TO_CONTENT", "CRM handed the campaign to Content.");
  await notify("CONTENT", "ASSIGNMENT", "New campaign assigned",
    `${campaign.campaign_name} needs copy and creative.`, campaign.id);
}

/**
 * Every QC checklist row, keyed by campaign id.
 *
 * The CRM dashboard needs `copy_verified` and `creative_verified` to decide
 * which review bucket a campaign sits in. Those are the existing Final QC
 * checklist fields — CRM ticking "copy reviewed" on the dashboard is the
 * same tick it would make in Final QC later, so nothing is duplicated and no
 * new status column was needed.
 *
 * One query for the whole board rather than one per row.
 */
export async function listQcChecklists(): Promise<Record<string, QcChecklist>> {
  const { data, error } = await supabase.from("qc_checklists").select("*");
  if (error) throw error;
  const byCampaign: Record<string, QcChecklist> = {};
  for (const row of (data ?? []) as QcChecklist[]) byCampaign[row.campaign_id] = row;
  return byCampaign;
}

/** Marks one campaign's Content copy as reviewed by CRM. UUID-scoped. */
export async function markCopyReviewed(campaignId: string, userId: string) {
  await saveQc(campaignId, { copy_verified: true });
  await log(campaignId, userId, "CRM_COPY_REVIEWED", "CRM reviewed Content's copy.");
}

export async function saveQc(campaignId: string, patch: Partial<QcChecklist>) {
  if (!campaignId || !UUID_RE.test(campaignId)) {
    throw new Error(`saveQc was called without a valid campaign id (got ${JSON.stringify(campaignId)}).`);
  }
  const { data: existing } = await supabase
    .from("qc_checklists").select("id").eq("campaign_id", campaignId).maybeSingle();
  if (existing) {
    const { error } = await supabase.from("qc_checklists").update(patch).eq("id", existing.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from("qc_checklists").insert({ ...patch, campaign_id: campaignId });
    if (error) throw error;
  }
}

/**
 * The one explicit finalization gate. Calls the update_calendar() RPC, which
 * itself re-checks qc_status = 'PASSED' server-side and rejects otherwise —
 * so this can never be bypassed by a client that skipped the checklist.
 * Final View and the Calendar page both read calendar_status = 'UPDATED'
 * exclusively; nothing appears there any other way.
 */
/**
 * Finalizes one campaign: the explicit step after Final QC that makes a PN
 * appear in Final View and the Calendar.
 *
 * The write happens server-side in `update_calendar()`, which re-reads the
 * campaign inside the transaction and re-checks QC, the tracking code and
 * its `cid=` format. The client cannot talk it past those gates.
 *
 * IDEMPOTENT by construction: there is no separate calendar table. Final
 * View and the Calendar both read `campaigns where calendar_status =
 * 'UPDATED'`, so finalizing twice sets the same row to the same state and
 * cannot produce a duplicate entry. Returning the refreshed row lets the
 * caller confirm the write landed rather than assuming it.
 */
export async function updateCalendar(campaign: Campaign, userId: string): Promise<Campaign> {
  const before = {
    campaignId: campaign.id,
    previousStatus: campaign.calendar_status,
    qcStatus: campaign.qc_status,
    hasTrackingCode: Boolean((campaign.tracking_code ?? "").trim()),
  };

  // Already finalized: return the stored record instead of writing again.
  if (campaign.calendar_status === "UPDATED") {
    const { data, error } = await supabase
      .from(TABLE).select("*").eq("id", campaign.id).single();
    if (error) throw error;
    console.info("[updateCalendar] already finalized", before);
    return data as Campaign;
  }

  const { error } = await supabase.rpc("update_calendar", { p_campaign_id: campaign.id });
  if (error) {
    console.error("[updateCalendar] rejected", { ...before, error: error.message });
    throw error;
  }

  // Read the row BACK so success is proven, not assumed.
  const { data, error: readErr } = await supabase
    .from(TABLE).select("*").eq("id", campaign.id).single();
  if (readErr) throw readErr;
  const after = data as Campaign;

  if (after.calendar_status !== "UPDATED") {
    throw new Error(
      "The calendar update did not take effect. The campaign has not been finalized.");
  }

  await log(campaign.id, userId, "CALENDAR_UPDATED",
    "CRM added this campaign to the finalized calendar.");
  console.info("[updateCalendar] finalized", { ...before, finalStatus: after.calendar_status });
  return after;
}

/**
 * Builds the tracking code from the campaign's own fields and PERSISTS it.
 *
 * This existed only in the bulk workspace, so a CRM user working in the
 * drawer had no way to produce one — they filled everything, saw green, and
 * `update_calendar()` then refused the row for an empty tracking code with
 * no visible reason. Same generator, same `cid=` format, same masters.
 */
export async function generateTrackingCode(campaign: Campaign): Promise<Campaign> {
  const fields = suggestTrackingFields(campaign);
  const { code, valid, missing } = buildTrackingCode(fields);
  if (!valid) {
    throw new Error(
      `Tracking Code could not be generated because ${missing.join(", ")} `
      + `${missing.length === 1 ? "is" : "are"} missing.`);
  }
  const landing = buildLandingPlusTracking(campaign.landing, code);
  return updateCampaign(campaign.id, {
    tracking_code: code,
    landing_plus_tracking: landing.url || null,
    tracking_code_check: trackingCheck(fields).label,
  });
}

/**
 * Marks Final QC passed for one campaign, but ONLY when all ten checklist
 * boxes are ticked. The same gate the drawer applies, so bulk cannot be a
 * back door around it.
 */
export async function markQcPassed(
  campaignId: string,
  checklist: QcChecklist | null | undefined,
  campaign?: Pick<Campaign, "creative_link"> | null
) {
  if (!qcComplete(checklist ?? null, campaign)) {
    const missing = missingQcFields(checklist ?? null, campaign);
    throw new Error(`QC checklist incomplete — missing: ${missing.join(", ")}.`);
  }
  await updateCampaign(campaignId, { qc_status: "PASSED" });
}

export interface BulkCalendarOutcome {
  campaignId: string;
  campaignName: string;
  ok: boolean;
  reason?: string;
}

/**
 * Bulk calendar push — the SAME path the drawer uses, once per campaign.
 *
 * Deliberately not a single multi-row write, and deliberately not a
 * client-side `qc_status = 'PASSED'` shortcut. Every campaign goes through
 * `update_calendar()`, which is SECURITY DEFINER and re-checks
 * `qc_status = 'PASSED'` server-side. A client that skipped the checklist
 * cannot get past it, in bulk or one at a time.
 *
 * Each PN is validated and committed INDEPENDENTLY:
 *   - a failure does not abort the batch
 *   - a failed PN is left exactly as it was, still in QC
 *   - only PNs whose validation passed move to the calendar
 *   - every success writes its own activity_logs row, as before
 *
 * Returns one outcome per campaign so the caller can show which failed and
 * why, rather than a count with no detail.
 */
export async function bulkUpdateCalendar(
  campaigns: Campaign[], userId: string,
  qcByCampaign: Record<string, QcChecklist | undefined> = {}
): Promise<BulkCalendarOutcome[]> {
  const outcomes: BulkCalendarOutcome[] = [];
  for (const c of campaigns) {
    const name = c.campaign_name ?? c.id;
    try {
      // A PN whose ten boxes are all ticked but whose qc_status has not yet
      // been flipped is marked passed here first — through markQcPassed,
      // which refuses unless the checklist is genuinely complete. That is
      // the same gate the drawer's "Mark QC Complete" button applies, so
      // bulk is not a back door around it.
      if (c.qc_status !== "PASSED") {
        const checklist = qcByCampaign[c.id] ?? null;
        // creative_verified is only required when a creative link exists (#7).
        if (!qcComplete(checklist, c)) {
          const missing = missingQcFields(checklist, c);
          outcomes.push({
            campaignId: c.id, campaignName: name, ok: false,
            reason: `QC checklist incomplete — missing: ${missing.join(", ")}.`,
          });
          continue;
        }
        // The tracking check is the gate, not merely a non-empty string:
        // a code built from incomplete fields would be silently wrong in
        // analytics forever. Names the missing fields so CRM can fix them.
        const check = trackingCheck(suggestTrackingFields(c));
        if (!check.ok) {
          outcomes.push({
            campaignId: c.id, campaignName: name, ok: false,
            reason: `Tracking code incomplete. ${check.detail}`,
          });
          continue;
        }
        if (!c.tracking_code || !c.tracking_code.trim()) {
          outcomes.push({
            campaignId: c.id, campaignName: name, ok: false,
            reason: "Tracking code not generated yet — use Generate Tracking Codes.",
          });
          continue;
        }
        await markQcPassed(c.id, checklist, c);
        await log(c.id, userId, "FINAL_QC_COMPLETED", "CRM completed final QC (bulk).");
      }
      if (c.calendar_status === "UPDATED") {
        // Idempotent: a second submission of the same PN is reported, not
        // re-applied, so a double click cannot write twice.
        outcomes.push({
          campaignId: c.id, campaignName: name, ok: false,
          reason: "Already on the calendar — skipped.",
        });
        continue;
      }
      const { error } = await supabase.rpc("update_calendar", { p_campaign_id: c.id });
      if (error) throw error;
      await log(c.id, userId, "CALENDAR_UPDATED", "CRM added this campaign to the finalized calendar.");
      outcomes.push({ campaignId: c.id, campaignName: name, ok: true });
    } catch (e) {
      const raw = e instanceof Error ? e.message
        : (e && typeof e === "object" && "message" in e) ? String((e as { message: unknown }).message)
        : String(e);
      outcomes.push({ campaignId: c.id, campaignName: name, ok: false, reason: raw });
    }
  }
  await log(null, userId, "CALENDAR_BULK_UPDATE",
    `Bulk calendar push: ${outcomes.filter((o) => o.ok).length} succeeded, ` +
    `${outcomes.filter((o) => !o.ok).length} failed, ${outcomes.length} attempted.`);
  return outcomes;
}

/** RULE 8 — locked Category data changes only through a reviewed request. */
export async function requestChange(
  campaign: Campaign, field: string, currentValue: string, requestedValue: string,
  reason: string, userId: string
) {
  const { error } = await supabase.from("change_requests").insert({
    campaign_id: campaign.id, requested_by: userId, field_name: field,
    current_value: currentValue, requested_value: requestedValue, reason,
  });
  if (error) throw error;
  await log(campaign.id, userId, "CHANGE_REQUESTED", `Change requested on ${field}.`);
  await notify("CRM", "CHANGE_REQUEST", "Change request raised",
    `${campaign.campaign_name}: ${field} change awaiting approval.`, campaign.id);
}

export async function listChangeRequests(status?: ChangeRequest["status"]) {
  let q = supabase.from("change_requests").select("*").order("created_at", { ascending: false });
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as ChangeRequest[];
}

export async function approveChange(request: ChangeRequest, userId: string) {
  const { error } = await supabase.rpc("apply_change_request", { p_request_id: request.id });
  if (error) throw error;
  await log(request.campaign_id, userId, "CHANGE_APPROVED", `Approved change to ${request.field_name}.`);
  await notify("CATEGORY", "CHANGE_APPROVED", "Change request approved",
    `Your change to ${request.field_name} was applied.`, request.campaign_id);
}

export async function rejectChange(request: ChangeRequest, userId: string) {
  const { error } = await supabase
    .from("change_requests")
    .update({ status: "REJECTED", reviewed_by: userId, reviewed_at: new Date().toISOString() })
    .eq("id", request.id);
  if (error) throw error;
  await log(request.campaign_id, userId, "CHANGE_REJECTED", `Rejected change to ${request.field_name}.`);
  await notify("CATEGORY", "CHANGE_REJECTED", "Change request rejected",
    `Your change to ${request.field_name} was not applied.`, request.campaign_id);
}

/** RULE: emergency time is mandatory at creation — CRM accepts using exactly that slot. */
export async function acceptEmergency(campaign: Campaign, userId: string) {
  const { error } = await supabase.rpc("accept_emergency", { p_campaign_id: campaign.id });
  if (error) throw error;
  await log(campaign.id, userId, "EMERGENCY_ACCEPTED", `CRM accepted the emergency push for ${campaign.launch_date} ${campaign.launch_time}.`);
  await notify("CATEGORY", "EMERGENCY_ACCEPTED", "Emergency push accepted",
    `${campaign.campaign_name} was accepted and is now in the review pipeline.`, campaign.id);
}

export async function rejectEmergency(campaign: Campaign, reason: string, userId: string) {
  const { error } = await supabase.rpc("reject_emergency", { p_campaign_id: campaign.id, p_reason: reason });
  if (error) throw error;
  await log(campaign.id, userId, "EMERGENCY_REJECTED", `CRM rejected the emergency push: ${reason}`);
  await notify("CATEGORY", "EMERGENCY_REJECTED", "Emergency push rejected",
    `${campaign.campaign_name} was rejected: ${reason}`, campaign.id);
}

/**
 * Routes a batch to Content. Content is the only production team, so this
 * is the single production handoff — `design_status` is not written.
 *
 * One write per campaign id, as always.
 */
/**
 * Bulk send. PARTIAL by design: complete rows go through and incomplete
 * ones are reported back with what each is missing, rather than failing the
 * whole batch. The existing per-row outcome pattern already supports this.
 *
 * Re-reads each campaign so the check runs against stored values, not a
 * stale client copy.
 */
export async function sendBatchToContent(
  campaignIds: string[], userId: string
): Promise<BulkCalendarOutcome[]> {
  const rows = await fetchCampaignsByIds(campaignIds);
  const byId = new Map(rows.map((c) => [c.id, c]));

  // The existing per-row outcome shape, so the board reports blocked rows
  // the same way it already reports failures.
  const outcomes: BulkCalendarOutcome[] = [];
  const sent: string[] = [];

  for (const id of campaignIds) {
    const c = byId.get(id);
    if (!c) continue;
    if (!canMoveForward(c)) {
      outcomes.push({
        campaignId: id, ok: false,
        // Named by PN, date and slot, so CRM can find the blocked row.
        campaignName: `${c.campaign_name} · ${c.launch_date ?? "no date"} · slot ${
          c.slot_label ?? c.slot_number ?? "—"}`,
        reason: `Incomplete CRM Part 2 — still needed: ${missingPart2(c).join(", ")}`,
      });
      continue;
    }
    await updateCampaign(id, { crm_status: "SENT_TO_CONTENT", content_status: "PENDING" });
    outcomes.push({ campaignId: id, ok: true, campaignName: c.campaign_name });
    sent.push(id);
  }

  if (sent.length > 0) {
    await log(null, userId, "SENT_TO_CONTENT",
      `CRM sent ${sent.length} campaigns to Content.`
      + (outcomes.length - sent.length > 0
         ? ` ${outcomes.length - sent.length} blocked for incomplete CRM Part 2.` : ""));
    await notify("CONTENT", "ASSIGNMENT", "New campaigns assigned",
      `${sent.length} campaigns need copy.`);
  }
  return outcomes;
}

/**
 * Content submits copy for one campaign. Returns the saved row so the caller
 * can update its UI from the confirmed server state rather than guessing.
 * H/S counts are derived here too, so they can never disagree with the text.
 */
export async function submitContentRow(
  campaignId: string,
  fields: { header: string; sub_copy_text: string; reference_link: string },
  userId: string
) {
  const header = fields.header.trim();
  const subCopy = fields.sub_copy_text.trim();
  const saved = await updateCampaign(campaignId, {
    header: header || null,
    sub_copy_text: subCopy || null,
    h_count: header.length,
    s_count: subCopy.length,
    reference_link: fields.reference_link.trim() || null,
    content_status: "SUBMITTED",
  } as Partial<Campaign>);
  await log(campaignId, userId, "CONTENT_SUBMITTED", "Content submitted copy.");
  return saved;
}

/** Saves Content's work in progress without submitting it. */
export async function saveContentRow(
  campaignId: string,
  fields: { header: string; sub_copy_text: string; reference_link: string }
) {
  const header = fields.header.trim();
  const subCopy = fields.sub_copy_text.trim();
  return updateCampaign(campaignId, {
    header: header || null,
    sub_copy_text: subCopy || null,
    h_count: header.length,
    s_count: subCopy.length,
    reference_link: fields.reference_link.trim() || null,
  } as Partial<Campaign>);
}


/**
 * How many change requests are waiting on CRM.
 *
 * Reads the SAME table and the SAME status the Changes page uses
 * (`change_requests.status === 'PENDING'`), so the badge and the page can
 * never disagree. Resolved, approved and rejected requests are not counted.
 *
 * Returns 0 rather than throwing: a missing count must never stop the
 * navigation rendering.
 */
export async function pendingChangeRequestCount(): Promise<number> {
  const { count, error } = await supabase
    .from("change_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "PENDING");
  if (error) return 0;
  return count ?? 0;
}


/**
 * Lets the Changes page tell the shell that a request was just accepted or
 * rejected, so the nav badge updates immediately instead of waiting for the
 * next navigation.
 *
 * A tiny module-level subscription rather than a context: the shell and the
 * page are not in the same tree, and this carries no data — only "recount".
 */
const changeRequestListeners = new Set<() => void>();

export function onChangeRequestsUpdated(fn: () => void) {
  changeRequestListeners.add(fn);
  return () => { changeRequestListeners.delete(fn); };
}

export function notifyChangeRequestsUpdated() {
  changeRequestListeners.forEach((fn) => fn());
}


/*
 * The global "reset running PNs" was REMOVED.
 *
 * `runningPnCount()`, `resetRunningPns()` and /api/reset-running are gone,
 * and nothing calls `reset_running_pns()` or `reset_campaigns_with_archive()`
 * any more. Undoing an upload is now scoped to one batch — see
 * services/uploadBatch.ts and migration 32. The SQL functions stay in the
 * database, unreferenced, because the db-qc suites still verify them.
 */
