"use client";

import { supabase } from "@/lib/supabase";
import type {
  ActivityLog, Campaign, ChangeRequest, ContentSubmission, CrmDecision, QcChecklist,
} from "@/types/campaign";

const TABLE = "campaigns";

export async function listCampaigns(filters: Record<string, string | boolean> = {}) {
  let q = supabase.from(TABLE).select("*").order("launch_date");
  Object.entries(filters).forEach(([k, v]) => { q = q.eq(k, v); });
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Campaign[];
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

export async function updateCampaign(id: string, patch: Partial<Campaign>) {
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
  await updateCampaign(campaign.id, { crm_status: "SENT_TO_CONTENT", content_status: "PENDING" });
  await log(campaign.id, userId, "SENT_TO_CONTENT", "CRM handed the campaign to Content.");
  await notify("CONTENT", "ASSIGNMENT", "New campaign assigned",
    `${campaign.campaign_name} needs copy and creative.`, campaign.id);
}

export async function saveQc(campaignId: string, patch: Partial<QcChecklist>) {
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

/** RULE 12 — only reachable once the checklist is complete. */
export async function markReady(campaign: Campaign, userId: string) {
  await updateCampaign(campaign.id, {
    qc_status: "PASSED", crm_status: "READY", production_status: "READY",
  });
  await log(campaign.id, userId, "READY_FOR_PRODUCTION", "Final QC passed. Marked ready for production.");
}

export async function pushToProduction(campaign: Campaign, userId: string) {
  await updateCampaign(campaign.id, { production_status: "PUSHED" });
  await log(campaign.id, userId, "PUSHED_TO_PRODUCTION", "Campaign pushed to production.");
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
