"use client";

import type { Campaign } from "@/types/campaign";
import type { Segment } from "@/types/targeting";
import { recommendFor, type Recommendation } from "@/data/mockRecommendations";

/**
 * The single boundary the future ML service will sit behind.
 * When the model ships, replace the body with a fetch to the scoring endpoint
 * and leave every caller untouched.
 */
export async function getRecommendation(
  campaign: Campaign,
  segments: Segment[] = []
): Promise<Recommendation> {
  return recommendFor(campaign, segments);
}

export const OVERRIDE_REASONS = [
  "Business Preference", "Brand Request", "Campaign Urgency",
  "Calendar Conflict", "Inventory", "Other",
];
