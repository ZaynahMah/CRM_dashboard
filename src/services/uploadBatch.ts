"use client";

import { supabase } from "@/lib/supabase";
import type { Campaign } from "@/types/campaign";

/**
 * Upload batches and "Reset last upload".
 *
 * Uploads are ADD-ONLY: `add_upload_batch()` inserts and nothing else, so an
 * upload can never change or remove a PN another team is working on.
 *
 * A reset undoes only the MOST RECENT batch of a stream, and only its
 * UNTOUCHED rows. "Untouched" is evaluated in Postgres by
 * `is_untouched_upload_row()`, conjunctively and fail-closed.
 */

export interface UploadBatchPreview {
  batch_id: string;
  file_name: string | null;
  uploaded_at: string;
  uploaded_name: string | null;
  total: number;
  untouched: number;
  touched: number;
}

/** SHA-256 of the file, so a repeat upload can be recognised. */
export async function fileSha256(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Has this exact file been uploaded before? Warning only, never a block. */
export async function previousUploadOfFile(
  sha: string
): Promise<{ created_at: string; file_name: string | null } | null> {
  const { data, error } = await supabase
    .from("upload_batches")
    .select("created_at, file_name")
    .eq("file_sha256", sha)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error || !data || data.length === 0) return null;
  return data[0];
}

export interface DayPreview {
  date: string;
  incoming: number;
  alreadyExist: number;
  isPast: boolean;
}

/**
 * Per-day preview before confirming.
 *
 * Duplicate matching is COUNT-BASED on date + time + slot + segment +
 * category, because several PNs legitimately share a slot. A row is counted
 * as "already exists" only once per existing row, so uploading the same file
 * twice shows everything as existing, while a genuine second PN in the same
 * slot still shows as new.
 */
export function previewByDay(
  rows: { launch_date?: string | null; launch_time?: string | null;
          slot_label?: string | null; pncc_segment_label?: string | null;
          category?: string | null }[],
  existing: Campaign[],
  today = new Date().toISOString().slice(0, 10)
): DayPreview[] {
  const key = (r: { launch_date?: string | null; launch_time?: string | null;
                    slot_label?: string | null; pncc_segment_label?: string | null;
                    category?: string | null }) =>
    [r.launch_date ?? "", r.launch_time ?? "", r.slot_label ?? "",
     r.pncc_segment_label ?? "", r.category ?? ""].join("|");

  // How many existing rows carry each key — the budget a new row consumes.
  const budget = new Map<string, number>();
  for (const c of existing) budget.set(key(c), (budget.get(key(c)) ?? 0) + 1);

  const byDay = new Map<string, DayPreview>();
  for (const r of rows) {
    const d = (r.launch_date ?? "").slice(0, 10);
    if (!d) continue;
    if (!byDay.has(d)) {
      byDay.set(d, { date: d, incoming: 0, alreadyExist: 0, isPast: d < today });
    }
    const day = byDay.get(d)!;
    const k = key(r);
    const left = budget.get(k) ?? 0;
    if (left > 0) { budget.set(k, left - 1); day.alreadyExist++; }
    else day.incoming++;
  }
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Uploads a batch. Add-only — nothing existing is changed or removed. */
export async function addUploadBatch(
  rows: Record<string, unknown>[], isCrmSelf: boolean,
  fileName: string, sha: string, byName: string
): Promise<string> {
  const { data, error } = await supabase.rpc("add_upload_batch", {
    p_rows: rows, p_is_crm_self: isCrmSelf,
    p_file_name: fileName, p_file_sha256: sha, p_by_name: byName.trim(),
  });
  if (error) {
    if (/does not exist|schema cache/i.test(error.message)) {
      throw new Error("Uploads are not set up yet — migration 32 has not been run.");
    }
    throw new Error(error.message);
  }
  return data as string;
}

/** What a reset would do. Changes nothing. */
export async function resetLastUploadPreview(
  isCrmSelf: boolean
): Promise<UploadBatchPreview | null> {
  const { data, error } = await supabase
    .rpc("reset_last_upload_preview", { p_is_crm_self: isCrmSelf });
  if (error) {
    if (/does not exist|schema cache/i.test(error.message)) return null;
    throw error;
  }
  const rows = (data ?? []) as UploadBatchPreview[];
  return rows[0] ?? null;
}

/** The exact rows a reset would remove, for the backup file. */
export async function untouchedRowsOfBatch(batchId: string): Promise<Campaign[]> {
  const { data, error } = await supabase
    .from("campaigns").select("*").eq("upload_batch_id", batchId)
    .order("id", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Campaign[];
}

/**
 * The backup, and its hash.
 *
 * Deterministic: rows ordered by id, a fixed column order, and `id` plus
 * `updated_at` per row — so the hash changes if anything about the set
 * changes, and the server can re-verify it inside the transaction.
 */
export function buildBackup(rows: Campaign[]): { csv: string; signature: string } {
  const ordered = [...rows].sort((a, b) => a.id.localeCompare(b.id));
  const cols = Object.keys(ordered[0] ?? {}).sort();
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [
    cols.join(","),
    ...ordered.map((r) => cols.map((c) => esc((r as unknown as Record<string, unknown>)[c])).join(",")),
  ].join("\n");
  const signature = ordered.map((r) => `${r.id}:${r.updated_at ?? ""}`).join("|");
  return { csv, signature };
}

export async function sha256Of(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function resetLastUpload(input: {
  isCrmSelf: boolean; batchId: string; rowIds: string[];
  backupSha: string; backupName: string; byName: string;
}): Promise<number> {
  const { data, error } = await supabase.rpc("reset_last_upload", {
    p_is_crm_self: input.isCrmSelf,
    p_batch_id: input.batchId,
    p_row_ids: input.rowIds,
    p_backup_sha: input.backupSha,
    p_backup_name: input.backupName,
    p_by_name: input.byName.trim(),
  });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}
