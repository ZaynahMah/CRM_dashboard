export type CampaignOrigin = "CATEGORY_REQUEST" | "CRM_PLANNED";
export type CategoryStatus = "EMPTY" | "DRAFT" | "SUBMITTED" | "LOCKED";
export type CrmStatus =
  | "NOT_STARTED" | "AWAITING_REVIEW" | "IN_PLANNING"
  | "SENT_TO_CONTENT" | "FINAL_QC" | "READY";
export type ContentStatus = "NOT_ASSIGNED" | "PENDING" | "SUBMITTED" | "NEEDS_CHANGES";
export type QcStatus = "PENDING" | "IN_PROGRESS" | "PASSED";
export type ProductionStatus = "NOT_READY" | "READY" | "PUSHED" | "BLOCKED";
export type Priority = "LOW" | "NORMAL" | "HIGH" | "CRITICAL";

import type { PushChannel } from "./targeting";

export interface Campaign {
  id: string;
  campaign_name: string;
  campaign_origin: CampaignOrigin;
  category: string | null;
  sub_category: string | null;
  brand: string | null;
  offer: string | null;
  offer_details: string | null;
  campaign_type: string | null;
  brief: string | null;
  product_collection: string | null;
  business_objective: string | null;
  landing: string | null;
  reference_link: string | null;
  additional_notes: string | null;
  calendar_slot_id: string | null;
  launch_date: string;
  launch_time: string | null;
  priority: Priority;
  audience: string | null;
  segment_1: string | null;
  segment_2: string | null;
  cohort: string | null;
  campaign_id_ext: string | null;
  cid: string | null;
  tracking_code: string | null;
  category_status: CategoryStatus;
  crm_status: CrmStatus;
  content_status: ContentStatus;
  qc_status: QcStatus;
  production_status: ProductionStatus;
  is_emergency: boolean;
  emergency_reason: string | null;
  business_deadline: string | null;
  emergency_score: number | null;
  category_deadline: string;

  // Operational push fields, from the live CRM sheet
  channel: PushChannel;
  segment_id: string | null;
  segment_2_id: string | null;
  push_tag: string | null;
  group_id: string | null;
  collapse_id: string | null;
  global_limit: boolean;
  sound: boolean;
  pn_template: string | null;
  access_type: string | null;
  offer_construct: string | null;
  expected_reach: number | null;

  // PN CC fields
  pncc_segment_label: string | null;
  pncc_segment_name: string | null;
  pncc_category_code: string | null;
  slot_type: string;
  date_time_brief: string | null;
  expected_cvr: string | null;
  expected_rpv: string | null;
  creative_requirements: string | null;
  creative_link: string | null;
  submitted_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CrmDecision {
  id: string;
  campaign_id: string;
  recommended_date: string | null;
  recommended_time: string | null;
  recommended_audience: string | null;
  recommended_cohort: string | null;
  confidence: number | null;
  recommendation_reason: string | null;
  selected_date: string | null;
  selected_time: string | null;
  selected_audience: string | null;
  selected_cohort: string | null;
  is_manual_override: boolean;
  override_reason: string | null;
  crm_notes: string | null;
}

export interface ContentSubmission {
  id: string;
  campaign_id: string;
  header: string | null;
  sub_copy: string | null;
  cta: string | null;
  pn_copy: string | null;
  creative_asset_url: string | null;
  creative_notes: string | null;
  header_character_count: number;
  sub_copy_character_count: number;
  status: ContentStatus;
  submitted_by: string | null;
  submitted_at: string | null;
}

export interface QcChecklist {
  id: string;
  campaign_id: string;
  category_verified: boolean;
  brand_verified: boolean;
  offer_verified: boolean;
  landing_verified: boolean;
  date_verified: boolean;
  time_verified: boolean;
  audience_verified: boolean;
  creative_verified: boolean;
  copy_verified: boolean;
  tracking_verified: boolean;
  completed_at: string | null;
}

export interface ChangeRequest {
  id: string;
  campaign_id: string;
  requested_by: string | null;
  field_name: string;
  current_value: string | null;
  requested_value: string | null;
  reason: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  created_at: string;
}

export interface ActivityLog {
  id: string;
  campaign_id: string | null;
  user_id: string | null;
  action: string;
  description: string | null;
  created_at: string;
}

export interface AppNotification {
  id: string;
  user_id: string | null;
  target_role: string | null;
  campaign_id: string | null;
  type: string;
  title: string;
  message: string | null;
  is_read: boolean;
  created_at: string;
}
