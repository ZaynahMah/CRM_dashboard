"use client";

import { supabase } from "@/lib/supabase";
import type { Campaign } from "@/types/campaign";
import type { BulkCalendarOutcome } from "./campaigns";

/**
 * CRM sends a PN back to Content for a fix.
 *
 * Everything happens inside `send_back_to_content()` (migration 31):
 * `qc_status` is reset there because `enforce_column_ownership()` blocks it
 * from the client, and the status change, reason, counter, notification and
 * activity row must land together or not at all.
 *
 * `content_status = 'NEEDS_CHANGES'` is REUSED. Every queue already routes
 * it; nothing had ever written it.
 */

export interface SendBackInput {
  reason: string;
  /** Who is doing it. Shared team logins make this the only real identity. */
  byName: string;
  /** Optional: which field Content should look at. */
  field?: string | null;
}

/** May this PN be sent back? Mirrors the function's own guards. */
export function canSendBack(c: Campaign): { ok: boolean; reason?: string } {
  if (c.calendar_status === "UPDATED") {
    return { ok: false, reason: "Already on the calendar — remove it first." };
  }
  if (c.content_status !== "SUBMITTED") {
    return { ok: false, reason: "Content has not submitted this PN." };
  }
  return { ok: true };
}

/** True when sending back will also reset a passed QC, so CRM can confirm. */
export const willResetQc = (c: Campaign) => c.qc_status === "PASSED";

export async function sendBackToContent(
  campaignId: string, input: SendBackInput
): Promise<Campaign> {
  const { data, error } = await supabase.rpc("send_back_to_content", {
    p_campaign_id: campaignId,
    p_reason: input.reason.trim(),
    p_by_name: input.byName.trim(),
    p_field: input.field?.trim() || null,
  });
  if (error) {
    if (/does not exist|schema cache/i.test(error.message)) {
      throw new Error("Send back is not set up yet — migration 31 has not been run.");
    }
    throw new Error(error.message);
  }
  return data as Campaign;
}

/**
 * Bulk send-back. PARTIAL by design, like every other bulk action here:
 * eligible PNs go back and the rest are reported with the reason, rather
 * than failing the whole batch.
 *
 * One call per PN, so each gets its own counter increment, notification and
 * activity row.
 */
export async function bulkSendBackToContent(
  campaigns: Campaign[], input: SendBackInput
): Promise<BulkCalendarOutcome[]> {
  const outcomes: BulkCalendarOutcome[] = [];
  for (const c of campaigns) {
    const label = `${c.campaign_name} · ${c.launch_date ?? "no date"} · slot ${
      c.slot_label ?? c.slot_number ?? "—"}`;
    const gate = canSendBack(c);
    if (!gate.ok) {
      outcomes.push({ campaignId: c.id, ok: false, campaignName: label,
        reason: gate.reason });
      continue;
    }
    try {
      await sendBackToContent(c.id, input);
      outcomes.push({ campaignId: c.id, ok: true, campaignName: c.campaign_name });
    } catch (e) {
      outcomes.push({ campaignId: c.id, ok: false, campaignName: label,
        reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return outcomes;
}

/** Remembered per browser so the name is typed once, not every time. */
const NAME_KEY = "cliq.sendBack.name";
export const rememberedName = () => {
  try { return localStorage.getItem(NAME_KEY) ?? ""; } catch { return ""; }
};
export const rememberName = (n: string) => {
  try { localStorage.setItem(NAME_KEY, n.trim()); } catch { /* ignore */ }
};
