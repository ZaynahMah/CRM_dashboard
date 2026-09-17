export type PushChannel = "PN" | "WHATSAPP" | "EMAIL" | "SMS" | "APP_INBOX" | "WEB_PUSH";

export interface Segment {
  id: string;
  moe_name: string;
  ct_name: string | null;
  display_name: string;
  segment_family: "Predominance" | "Behaviour" | "Lifecycle" | "Location" | "Search" | "Value" | "Email";
  gender: "WOMEN" | "MEN" | "ALL" | null;
  catalogue_codes: string | null;
  definition: string | null;
  base_count: number | null;
  platform: string | null;
  is_active: boolean;
}

export interface SegmentExclusion { id: number; label: string; rationale: string | null }
export interface Cohort { id: number; name: string; definition: string; exclusion: string | null }
export interface OfferFactor {
  id: number; factor: string; why_it_matters: string;
  offer_implication: string; is_priority: boolean;
}
export interface OfferPlaybookEntry { id: number; customer_segment: string; typical_offer: string }
export interface PushTag { id: number; tag: string; label: string; group_id: string }
export interface Channel { code: PushChannel; label: string; revenue_share: number; notes: string | null }

export const CHANNEL_LABEL: Record<PushChannel, string> = {
  PN: "Push notification",
  WHATSAPP: "WhatsApp",
  EMAIL: "Email",
  SMS: "SMS",
  APP_INBOX: "App inbox",
  WEB_PUSH: "Web push",
};

/** PN template list is still an open question with the CRM team — these are the four in use. */
export const PN_TEMPLATES = ["Basic", "Bezel", "Timer", "Coloured BG"];
export const ACCESS_TYPES = ["onetime", "earlyaccess"];
