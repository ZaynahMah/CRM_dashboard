"use client";

import { supabase } from "@/lib/supabase";
import type {
  Channel, Cohort, OfferFactor, OfferPlaybookEntry, PushTag, Segment, SegmentExclusion,
} from "@/types/targeting";

export async function listSegments() {
  const { data, error } = await supabase
    .from("segments").select("*").eq("is_active", true)
    .order("base_count", { ascending: false, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as Segment[];
}

export async function listExclusions() {
  const { data } = await supabase.from("segment_exclusions").select("*").order("id");
  return (data ?? []) as SegmentExclusion[];
}

export async function listCohorts() {
  const { data } = await supabase.from("cohorts").select("*").order("id");
  return (data ?? []) as Cohort[];
}

export async function listOfferFactors() {
  const { data } = await supabase
    .from("offer_factors").select("*").order("is_priority", { ascending: false }).order("id");
  return (data ?? []) as OfferFactor[];
}

export async function listPlaybook() {
  const { data } = await supabase.from("offer_playbook").select("*").order("id");
  return (data ?? []) as OfferPlaybookEntry[];
}

export async function listPushTags() {
  const { data } = await supabase.from("push_tags").select("*").order("group_id").order("tag");
  return (data ?? []) as PushTag[];
}

export async function listChannels() {
  const { data } = await supabase
    .from("channels").select("*").order("revenue_share", { ascending: false });
  return (data ?? []) as Channel[];
}
