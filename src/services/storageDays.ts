"use client";

import { supabase } from "@/lib/supabase";

/**
 * Storage: deleting a finished day (migration 40).
 *
 * Every rule lives in Postgres — CRM-only, every PN on the calendar, the
 * signature matching the backup. This module only reads status and calls
 * the function; it can never widen what the database permits.
 */

export interface DayStatus {
  launch_date: string;
  total_pns: number;
  on_calendar: number;
  blocking: number;
  still_with_category: number;
  still_with_content: number;
  pending_crm: number;
  eligible: boolean;
}

export interface Blocker {
  id: string;
  campaign_name: string;
  slot_label: string | null;
  category_status: string;
  content_status: string;
  qc_status: string;
}

export interface DayAudit {
  id: string;
  launch_date: string;
  performed_name: string;
  campaigns_removed: number;
  children_removed: Record<string, number> | null;
  created_at: string;
}

/** Every day that has PNs, with its counts. */
export async function listDays(): Promise<string[]> {
  const { data, error } = await supabase
    .from("campaigns").select("launch_date").order("launch_date", { ascending: true });
  if (error) throw error;
  const seen = new Set<string>();
  for (const r of (data ?? []) as { launch_date: string | null }[]) {
    if (r.launch_date) seen.add(r.launch_date);
  }
  return [...seen];
}

const friendly = (e: { message?: string } | null) => {
  const m = e?.message ?? "";
  if (/does not exist|schema cache/i.test(m)) {
    return new Error("Storage is not set up yet — migration 40 has not been run.");
  }
  return new Error(m || "The request failed.");
};

export async function dayStatus(day: string): Promise<DayStatus | null> {
  const { data, error } = await supabase.rpc("day_delete_status", { p_day: day });
  if (error) throw friendly(error);
  const rows = (data ?? []) as DayStatus[];
  return rows[0] ?? null;
}

export async function dayBlockers(day: string): Promise<Blocker[]> {
  const { data, error } = await supabase.rpc("day_delete_blockers", { p_day: day });
  if (error) throw friendly(error);
  return (data ?? []) as Blocker[];
}

export interface BackupResult {
  day: string;
  sha: string;
  counts: Record<string, number>;
  fileName: string;
  backup: unknown;
}

/** Generates the backup server-side and hands the browser the file. */
export async function downloadDayBackup(day: string): Promise<BackupResult> {
  const res = await fetch("/api/day-backup", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ day }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Backup failed (${res.status}).`);

  const blob = new Blob([JSON.stringify(body.backup, null, 2)],
    { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = body.fileName; a.click();
  URL.revokeObjectURL(url);
  return body as BackupResult;
}

/**
 * Deletes one day. The signature from the backup is presented back; the
 * function recomputes it inside the transaction and refuses on any
 * difference.
 */
export async function deleteDay(
  day: string, backupSha: string, backupName: string, byName: string
): Promise<number> {
  const { data, error } = await supabase.rpc("delete_finished_day", {
    p_day: day,
    p_backup_sha: backupSha,
    p_backup_name: backupName,
    p_by_name: byName.trim(),
  });
  if (error) throw friendly(error);
  return Number(data ?? 0);
}

export async function listDeleteAudit(): Promise<DayAudit[]> {
  const { data, error } = await supabase
    .from("day_delete_audit").select("*")
    .order("created_at", { ascending: false }).limit(50);
  if (error) {
    if (/does not exist/i.test(error.message)) return [];
    throw error;
  }
  return (data ?? []) as DayAudit[];
}

const NAME_KEY = "cliq.storage.name";
export const rememberedStorageName = () => {
  try { return localStorage.getItem(NAME_KEY) ?? ""; } catch { return ""; }
};
export const rememberStorageName = (n: string) => {
  try { localStorage.setItem(NAME_KEY, n.trim()); } catch { /* ignore */ }
};
