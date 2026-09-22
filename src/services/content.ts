"use client";

import { supabase } from "@/lib/supabase";
import type { Campaign, ContentSubmission } from "@/types/campaign";
import { log, notify } from "./campaigns";

export async function getSubmission(campaignId: string) {
  const { data } = await supabase
    .from("content_submissions").select("*").eq("campaign_id", campaignId).maybeSingle();
  return (data ?? null) as ContentSubmission | null;
}

export async function saveDraft(campaignId: string, patch: Partial<ContentSubmission>) {
  const existing = await getSubmission(campaignId);
  if (existing) {
    const { error } = await supabase.from("content_submissions").update(patch).eq("id", existing.id);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("content_submissions").insert({ ...patch, campaign_id: campaignId, status: "PENDING" });
    if (error) throw error;
  }
}

/**
 * Content cannot write Category or CRM columns, so the status change runs
 * through a database function rather than a direct campaigns update.
 */
export async function submitContent(campaign: Campaign, patch: Partial<ContentSubmission>, userId: string) {
  await saveDraft(campaign.id, {
    ...patch, status: "SUBMITTED", submitted_by: userId,
    submitted_at: new Date().toISOString(),
  });
  const { error } = await supabase.rpc("submit_content", { p_campaign_id: campaign.id });
  if (error) throw error;
  await log(campaign.id, userId, "CONTENT_SUBMITTED", "Content submitted copy and creative.");
  await notify("CRM", "QC", "Final QC required",
    `${campaign.campaign_name} is ready for final QC.`, campaign.id);
}
