"use client";

import { supabase } from "@/lib/supabase";

/**
 * Input-change alerts.
 *
 * Alerts are created by the DATABASE (migration 35's AFTER UPDATE trigger),
 * never from here, so no write path can skip one. This module only READS
 * them and acknowledges through a SECURITY DEFINER function.
 */

export interface ChangeAlert {
  id: string;
  campaign_id: string | null;
  title: string;
  message: string | null;
  priority: string;
  group_key: string | null;
  field_label: string | null;
  old_value: string | null;
  new_value: string | null;
  changed_by_name: string | null;
  source_team: string | null;
  batch_id: string | null;
  created_at: string;
  acknowledged_at: string | null;
}

/**
 * Supplies the typed name, and a batch id when a bulk path has one, for the
 * current transaction. The trigger reads both.
 *
 * Postgres session settings set with `is_local = true` last only for the
 * transaction, and Supabase pools connections — so this must be called
 * immediately before the write it describes.
 */
export async function setEditContext(actorName: string, batchId?: string) {
  const { error } = await supabase.rpc("set_edit_context", {
    p_actor_name: actorName.trim(),
    p_batch_id: batchId ?? null,
  });
  // A failure here must never block the edit: the alert then records
  // "name not provided" rather than the save failing.
  if (error && !/does not exist|schema cache/i.test(error.message)) {
    console.warn("[setEditContext]", error.message);
  }
}

/** Unacknowledged red alerts for CRM, newest first. */
export async function openRedAlerts(limit = 100): Promise<ChangeAlert[]> {
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .eq("priority", "RED")
    .is("acknowledged_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    // Migration 35 not run yet: show nothing rather than breaking the home.
    if (/does not exist|schema cache|column/i.test(error.message)) return [];
    throw error;
  }
  return (data ?? []) as ChangeAlert[];
}

/** CRM marks one alert reviewed, with a typed name. */
export async function acknowledgeAlert(id: string, byName: string) {
  const { error } = await supabase.rpc("acknowledge_alert", {
    p_notification_id: id, p_by_name: byName.trim(),
  });
  if (error) throw new Error(error.message);
}

/** Campaign ids that currently carry an unacknowledged red alert. */
export function flaggedCampaignIds(alerts: ChangeAlert[]): Set<string> {
  return new Set(alerts.map((a) => a.campaign_id).filter((v): v is string => !!v));
}
