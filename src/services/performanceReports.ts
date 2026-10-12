"use client";

import { supabase } from "@/lib/supabase";
import { parseWorkbook } from "./performanceUpload";
import type {
  UploadedPerformanceData, DimensionRow, MonthlyKpiRow, TopPnRow, SheetKey,
} from "@/types/performance";

/**
 * Persistence for the Executive performance report.
 *
 * The workbook used to be parsed in the browser and held in React state, so
 * a refresh, a logout, a new deploy or a second Executive lost it entirely.
 * Now BOTH halves are stored: the original file in Supabase Storage, and
 * the parsed metrics in tables. The dashboard reads the metrics and NEVER
 * reparses — the file is kept so the source can always be downloaded.
 *
 * Deliberately separate from the campaign reset: nothing here is a child of
 * `campaigns`, so a reset cannot cascade into a performance report.
 */

export const BUCKET = "performance-reports";

export interface ReportSummary {
  id: string;
  file_name: string;
  storage_path: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
  is_current: boolean;
  sheets_found: string[];
  sheet_count: number;
  warnings: string[];
  current_month: string | null;
  row_count: number;
  /** Display name resolved from profiles, when available. */
  uploaded_by_name?: string | null;
}

const PENDING =
  "Performance storage is not set up yet — contact your admin. " +
  "Migration 23 and the `performance-reports` storage bucket are required.";

/** A missing table, function or bucket rather than a real failure. */
function isSetupPending(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null;
  const code = err?.code ?? "";
  const msg = (err?.message ?? "").toLowerCase();
  return code === "PGRST202" || code === "42P01" || code === "42703"
    || msg.includes("schema cache") || msg.includes("does not exist")
    || msg.includes("bucket not found");
}

export class SetupPendingError extends Error {
  constructor() { super(PENDING); this.name = "SetupPendingError"; }
}

/* ───────────────────────── read ───────────────────────── */

/** Every upload, newest first. The version-history list. */
export async function listReports(): Promise<ReportSummary[]> {
  try {
    const { data, error } = await supabase
      .from("performance_reports")
      .select("*, profiles:uploaded_by(display_name)")
      .order("uploaded_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map((r) => {
      const row = r as ReportSummary & { profiles?: { display_name?: string } | null };
      return { ...row, uploaded_by_name: row.profiles?.display_name ?? null };
    });
  } catch (e) {
    if (isSetupPending(e)) throw new SetupPendingError();
    throw e;
  }
}

/**
 * Loads the current report's parsed metrics back into the exact shape the
 * dashboard already consumes, so no chart or panel had to change.
 *
 * Returns null when no report has been uploaded yet — distinct from a
 * setup problem, which throws.
 */
export async function loadCurrentReport(): Promise<
  { report: ReportSummary; data: UploadedPerformanceData } | null
> {
  let report: ReportSummary | null = null;
  try {
    const { data, error } = await supabase
      .from("performance_reports")
      .select("*, profiles:uploaded_by(display_name)")
      .eq("is_current", true)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const row = data as ReportSummary & { profiles?: { display_name?: string } | null };
    report = { ...row, uploaded_by_name: row.profiles?.display_name ?? null };
  } catch (e) {
    if (isSetupPending(e)) throw new SetupPendingError();
    throw e;
  }

  const [kpi, dims, top] = await Promise.all([
    supabase.from("performance_monthly_kpi").select("*").eq("report_id", report.id),
    supabase.from("performance_dimensions").select("*").eq("report_id", report.id),
    supabase.from("performance_top_pn").select("*").eq("report_id", report.id)
      .order("rank", { ascending: true }),
  ]);
  if (kpi.error) throw kpi.error;
  if (dims.error) throw dims.error;
  if (top.error) throw top.error;

  // Regroup the flat dimension rows back into the per-sheet map the UI uses.
  const dimensions: Partial<Record<SheetKey, DimensionRow[]>> = {};
  for (const r of (dims.data ?? []) as (DimensionRow & { sheet_key: SheetKey })[]) {
    (dimensions[r.sheet_key] ??= []).push(r);
  }

  return {
    report,
    data: {
      filename: report.file_name,
      uploadedAt: report.uploaded_at,
      currentMonth: report.current_month,
      monthlyKpi: (kpi.data ?? []) as MonthlyKpiRow[],
      dimensions,
      topPn: (top.data ?? []) as TopPnRow[],
      sheetsFound: report.sheets_found ?? [],
      warnings: report.warnings ?? [],
    },
  };
}

/* ───────────────────────── write ───────────────────────── */

/** Metrics are inserted in batches; a month of data can be thousands of rows. */
const INSERT_BATCH = 500;

async function insertBatched(table: string, rows: Record<string, unknown>[]) {
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const { error } = await supabase.from(table).insert(rows.slice(i, i + INSERT_BATCH));
    if (error) throw error;
  }
}

/**
 * Parses the workbook ONCE, stores the original file, writes the metrics,
 * and makes the new report current.
 *
 * Order matters: the file and the metrics are written BEFORE the report
 * becomes current, so a failure part-way leaves the previous report active
 * rather than pointing the dashboard at a half-written one.
 */
export async function uploadPerformanceReport(
  file: File, profileId: string
): Promise<{ report: ReportSummary; data: UploadedPerformanceData }> {
  const buffer = await file.arrayBuffer();
  const parsed = parseWorkbook(buffer, file.name);

  const rowCount =
    parsed.monthlyKpi.length + parsed.topPn.length +
    Object.values(parsed.dimensions).reduce((n, rows) => n + (rows?.length ?? 0), 0);

  let reportId: string;
  try {
    const { data, error } = await supabase
      .from("performance_reports")
      .insert({
        file_name: file.name,
        uploaded_by: profileId,
        is_current: false,          // promoted only once everything landed
        sheets_found: parsed.sheetsFound,
        sheet_count: parsed.sheetsFound.length,
        warnings: parsed.warnings,
        current_month: parsed.currentMonth,
        row_count: rowCount,
      })
      .select()
      .single();
    if (error) throw error;
    reportId = (data as { id: string }).id;
  } catch (e) {
    if (isSetupPending(e)) throw new SetupPendingError();
    throw e;
  }

  // ---- the original workbook ----
  // A storage failure must not lose the metrics, so it is recorded and
  // surfaced rather than aborting the upload.
  const path = `${reportId}/${file.name}`;
  let storagePath: string | null = null;
  let storageWarning: string | null = null;
  try {
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
      upsert: true,
      contentType: file.type
        || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    if (error) throw error;
    storagePath = path;
  } catch (e) {
    storageWarning =
      "The metrics were saved, but the original file could not be stored: " +
      ((e as { message?: string })?.message ?? String(e));
  }

  // ---- the parsed metrics ----
  await insertBatched("performance_monthly_kpi",
    parsed.monthlyKpi.map((r) => ({ ...r, report_id: reportId })));

  const dimRows = Object.entries(parsed.dimensions).flatMap(([sheet_key, rows]) =>
    (rows ?? []).map((r) => ({
      report_id: reportId, sheet_key, month: r.month,
      dimension_value: r.dimension_value, visits: r.visits, orders: r.orders,
      revenue_inr: r.revenue_inr, cvr: r.cvr, aov_inr: r.aov_inr,
      rpv_inr: r.rpv_inr, extra: r.extra ?? null,
    })));
  await insertBatched("performance_dimensions", dimRows);

  await insertBatched("performance_top_pn",
    parsed.topPn.map((r) => ({
      report_id: reportId, pn_name: r.pn_name, rank: r.rank, visits: r.visits,
      orders: r.orders, revenue_inr: r.revenue_inr, cvr: r.cvr,
      aov_inr: r.aov_inr, rpv_inr: r.rpv_inr,
    })));

  if (storagePath || storageWarning) {
    const warnings = storageWarning
      ? [...parsed.warnings, storageWarning] : parsed.warnings;
    await supabase.from("performance_reports")
      .update({ storage_path: storagePath, warnings })
      .eq("id", reportId);
  }

  // ---- promote, last ----
  const { error: promoteErr } = await supabase
    .rpc("set_current_performance_report", { p_report_id: reportId });
  if (promoteErr) throw promoteErr;

  const loaded = await loadCurrentReport();
  if (!loaded) throw new Error("The report was saved but could not be read back.");
  return loaded;
}

/** Makes an older version current again. Metrics are already stored. */
export async function restoreReport(reportId: string) {
  const { error } = await supabase
    .rpc("set_current_performance_report", { p_report_id: reportId });
  if (error) {
    if (isSetupPending(error)) throw new SetupPendingError();
    throw error;
  }
}

/** A short-lived link to download the original workbook. */
export async function reportDownloadUrl(storagePath: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(BUCKET).createSignedUrl(storagePath, 300);
  if (error) return null;
  return data?.signedUrl ?? null;
}
