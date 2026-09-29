"use client";

import { supabase } from "@/lib/supabase";
import type { PnccSegment, PnccCategory, ApprovedPair, FixedTimeSlot } from "@/types/pncc";

export async function listPnccSegments() {
  const { data } = await supabase.from("pncc_segments").select("*").eq("is_active", true).order("condition_label");
  return (data ?? []) as PnccSegment[];
}

export async function listPnccCategories() {
  const { data } = await supabase.from("pncc_categories").select("*").order("label");
  return (data ?? []) as PnccCategory[];
}

export async function listApprovedPairs() {
  const { data } = await supabase.from("approved_pairs").select("*").order("segment_label").order("category_code");
  return (data ?? []) as ApprovedPair[];
}

export async function listFixedTimeSlots() {
  const { data } = await supabase.from("fixed_time_slots").select("*").order("slot_index");
  return (data ?? []) as FixedTimeSlot[];
}

/** Get categories that are valid for a given segment label. */
export function validCategoriesForSegment(pairs: ApprovedPair[], segmentLabel: string): string[] {
  return [...new Set(pairs.filter((p) => p.segment_label === segmentLabel).map((p) => p.category_code))];
}

/** Check if a segment+category pair is approved. */
export function isPairApproved(pairs: ApprovedPair[], segmentLabel: string, categoryCode: string): boolean {
  return pairs.some((p) => p.segment_label === segmentLabel && p.category_code === categoryCode);
}

/** Get unique time strings from the fixed slots. */
export function uniqueTimes(slots: FixedTimeSlot[]): string[] {
  return [...new Set(slots.map((s) => s.slot_time))];
}

/** Count how many slots exist at a given time. */
export function slotsAtTime(slots: FixedTimeSlot[], time: string): number {
  return slots.filter((s) => s.slot_time === time).length;
}
