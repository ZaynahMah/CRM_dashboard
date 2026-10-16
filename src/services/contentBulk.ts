"use client";

import { supabase } from "@/lib/supabase";
import { log, updateCampaign, submitContentRow, type BulkCalendarOutcome } from "./campaigns";
import {
  countOf, diffContentFields, type ParsedContentRow, type ContentDiffField,
} from "@/lib/contentExcel";
import type { Campaign } from "@/types/campaign";

/**
 * Persistence for the Content bulk Excel workflow.
 *
 * Every write is one campaign UUID at a time, batched so a 1,000-row import
 * does not open 1,000 concurrent requests. Nothing here bypasses the
 * existing CRM review: a bulk send sets content_status to SUBMITTED exactly
 * as the single-row path does, and the campaign enters CRM's normal queue.
 */

const BATCH = 500;

async function inBatches<T>(
  items: T[], fn: (item: T) => Promise<unknown>,
  onProgress?: (done: number, total: number) => void
) {
  for (let i = 0; i < items.length; i += BATCH) {
    const slice = items.slice(i, i + BATCH);
    await Promise.all(slice.map(fn));
    onProgress?.(Math.min(i + slice.length, items.length), items.length);
  }
}

/**
 * Writes imported copy to the campaigns it belongs to, WITHOUT submitting.
 * Content reviews in the preview first; submission is a separate decision.
 *
 * H/S counts are recomputed from the text rather than taken from the sheet,
 * so a stale count typed in Excel can never disagree with the copy.
 */
export async function saveImportedContent(
  rows: ParsedContentRow[], profileId: string,
  onProgress?: (done: number, total: number) => void
): Promise<BulkCalendarOutcome[]> {
  const outcomes: BulkCalendarOutcome[] = [];
  const batchId = crypto.randomUUID();

  // The BEFORE state, read once. The diff has to be computed now: after the
  // write the previous value is gone, and activity_logs records which
  // campaign changed but not which column.
  const before = new Map<string, Campaign>();
  for (const c of await fetchCampaignsByIds(rows.map((r) => r.campaignId))) {
    before.set(c.id, c);
  }
  const changes: { campaign_id: string; batch_id: string; changed_fields: ContentDiffField[];
                   changed_by: string; source: string }[] = [];

  await inBatches(rows, async (r) => {
    try {
      const prev = before.get(r.campaignId);
      const changed = diffContentFields(
        { header: prev?.header ?? "", sub_copy_text: prev?.sub_copy_text ?? "",
          reference_link: prev?.reference_link ?? "" },
        { header: r.header, sub_copy_text: r.sub_copy_text, reference_link: r.reference_link });
      if (changed.length > 0) {
        changes.push({ campaign_id: r.campaignId, batch_id: batchId,
          changed_fields: changed, changed_by: profileId, source: "IMPORT" });
      }
      await updateCampaign(r.campaignId, {
        header: r.header || null,
        sub_copy_text: r.sub_copy_text || null,
        h_count: countOf(r.header),
        s_count: countOf(r.sub_copy_text),
        reference_link: r.reference_link || null,
      } as Partial<Campaign>);
      outcomes.push({ campaignId: r.campaignId, campaignName: r.campaignId, ok: true });
    } catch (e) {
      outcomes.push({
        campaignId: r.campaignId, campaignName: `Excel row ${r.excelRow}`, ok: false,
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }, onProgress);

  // Recorded after the writes land, so a failed row leaves no phantom diff.
  const landed = new Set(outcomes.filter((o) => o.ok).map((o) => o.campaignId));
  const toRecord = changes.filter((c) => landed.has(c.campaign_id));
  for (let i = 0; i < toRecord.length; i += BATCH) {
    const { error } = await supabase
      .from("content_change_sets").insert(toRecord.slice(i, i + BATCH));
    // A missing table means migration 27 has not run. The import itself
    // succeeded, so this must not fail it — CRM just loses the diff.
    if (error && !/does not exist|schema cache/i.test(error.message)) throw error;
  }

  const ok = outcomes.filter((o) => o.ok).length;
  await log(null, profileId, "CONTENT_EXCEL_IMPORT",
    `Content imported an Excel worklist: ${ok} of ${rows.length} rows saved, `
    + `${toRecord.length} with changed fields. Batch ${batchId}.`);
  return outcomes;
}

/** A single inline correction in the preview. Saves immediately. */
export async function savePreviewEdit(
  campaignId: string, patch: { header?: string; sub_copy_text?: string; reference_link?: string },
  profileId: string
) {
  const update: Partial<Campaign> = {};
  if (patch.header !== undefined) {
    update.header = patch.header || null;
    update.h_count = countOf(patch.header);
  }
  if (patch.sub_copy_text !== undefined) {
    update.sub_copy_text = patch.sub_copy_text || null;
    update.s_count = countOf(patch.sub_copy_text);
  }
  if (patch.reference_link !== undefined) {
    update.reference_link = patch.reference_link || null;
  }
  // Diff first, for the same reason as the import: the old value is about
  // to be overwritten.
  const [prev] = await fetchCampaignsByIds([campaignId]);
  const changed = diffContentFields(
    { header: prev?.header ?? "", sub_copy_text: prev?.sub_copy_text ?? "",
      reference_link: prev?.reference_link ?? "" },
    { header: patch.header ?? prev?.header ?? "",
      sub_copy_text: patch.sub_copy_text ?? prev?.sub_copy_text ?? "",
      reference_link: patch.reference_link ?? prev?.reference_link ?? "" });

  await updateCampaign(campaignId, update);

  if (changed.length > 0) {
    const { error } = await supabase.from("content_change_sets").insert({
      campaign_id: campaignId, changed_fields: changed,
      changed_by: profileId, source: "PREVIEW_EDIT",
    });
    if (error && !/does not exist|schema cache/i.test(error.message)) throw error;
  }
  await log(campaignId, profileId, "CONTENT_PREVIEW_EDIT",
    `Content corrected copy in the import preview (${changed.join(", ") || "no change"}).`);
}

/**
 * Submits the imported batch to CRM. Uses the SAME submitContentRow the
 * single-row path uses, so the existing CRM review workflow is triggered
 * and nothing is bypassed.
 *
 * Per-row outcomes: one row failing must never abort the rest, and every
 * failure names its campaign.
 */
export async function bulkSendToCrm(
  campaigns: Campaign[], profileId: string,
  onProgress?: (done: number, total: number) => void
): Promise<BulkCalendarOutcome[]> {
  const outcomes: BulkCalendarOutcome[] = [];
  await inBatches(campaigns, async (c) => {
    const name = c.campaign_name ?? c.id;
    try {
      if (!(c.header ?? "").trim() || !(c.sub_copy_text ?? "").trim()) {
        throw new Error("Header and Sub Copy are both required before submitting.");
      }
      await submitContentRow(c.id, {
        header: c.header ?? "",
        sub_copy_text: c.sub_copy_text ?? "",
        reference_link: c.reference_link ?? "",
      }, profileId);
      outcomes.push({ campaignId: c.id, campaignName: name, ok: true });
    } catch (e) {
      outcomes.push({
        campaignId: c.id, campaignName: name, ok: false,
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }, onProgress);

  const ok = outcomes.filter((o) => o.ok).length;
  await log(null, profileId, "CONTENT_BULK_SEND_TO_CRM",
    `Content sent ${ok} of ${campaigns.length} imported rows to CRM review.`);
  return outcomes;
}

/** Re-reads the imported campaigns so the preview shows what was stored. */
export async function fetchCampaignsByIds(ids: string[]): Promise<Campaign[]> {
  const out: Campaign[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase
      .from("campaigns").select("*").in("id", ids.slice(i, i + 200));
    if (error) throw error;
    out.push(...((data ?? []) as Campaign[]));
  }
  return out;
}

/**
 * Records the export, so the audit trail covers the whole round trip.
 * `scope` is the human description — "pending rows" or "1 Oct → 10 Oct" —
 * because a row number meant nothing to anyone reading the log later.
 */
export const logExport = (
  count: number, mode: "pending" | "dates", scope: string, profileId: string
) =>
  log(null, profileId, "CONTENT_EXCEL_EXPORT",
    `Content exported ${count} rows to Excel (${mode === "pending" ? "pending rows" : scope}).`);

/* ───────────────────────── pending work + CRM diff ───────────────────────── */

/**
 * Campaigns assigned to Content that have NOT yet been submitted. This is
 * the primary export: Content thinks in terms of outstanding work, not row
 * numbers.
 */
export const pendingForContent = (campaigns: Campaign[]) =>
  campaigns.filter((c) =>
    c.content_status === "PENDING" || c.content_status === "NEEDS_CHANGES");

/*
 * The CRM-facing "Changed Fields" panel was REMOVED at the product owner's
 * request, along with `contentChangesForReview()` and
 * `acknowledgeContentChanges()`, which existed only to serve it.
 *
 * The diff CAPTURE above is deliberately kept: `content_change_sets` is
 * campaign edit history, written whenever Content imports or corrects copy.
 * Nothing reads it today, but deleting the writes would discard an audit
 * trail, and the brief was explicit about not removing underlying history.
 */
