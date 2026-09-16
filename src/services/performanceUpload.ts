"use client";

import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import type { SheetKey } from "@/types/performance";
import { SHEET_LABELS } from "@/types/performance";

export interface ParsedUploadResult {
  monthlyKpi: Record<string, unknown>[];
  dimensions: Partial<Record<SheetKey, Record<string, unknown>[]>>;
  topPn: Record<string, unknown>[];
  sheetsFound: string[];
  warnings: string[];
  currentMonth: string | null;
}

const DIMENSION_METRIC_COLS = ["Visits", "Orders", "Revenue_INR", "CVR", "AOV_INR", "RPV_INR"];

function findSheet(wb: XLSX.WorkBook, targetName: string): XLSX.WorkSheet | null {
  const target = targetName.trim().toLowerCase();
  const match = wb.SheetNames.find((n) => n.trim().toLowerCase() === target);
  return match ? wb.Sheets[match] : null;
}

function readSheetRows(ws: XLSX.WorkSheet): Record<string, unknown>[] {
  return XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });
}

/** Case/whitespace-tolerant column lookup — matches by exact name after trim+lowercase. */
function col(row: Record<string, unknown>, name: string): unknown {
  const target = name.trim().toLowerCase();
  const key = Object.keys(row).find((k) => k.trim().toLowerCase() === target);
  return key ? row[key] : null;
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}
function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

const DIMENSION_SHEETS: { key: SheetKey; column: string }[] = [
  { key: "category", column: "Category" },
  { key: "remarketing_flow", column: "Remarketing Flow" },
  { key: "segment", column: "Segment" },
  { key: "pn_type", column: "PN Type" },
  { key: "cohort", column: "Cohort" },
  { key: "occasion", column: "Occasion" },
  { key: "tag", column: "Tag" },
];

/**
 * Parses the uploaded workbook per the exact spec: sheets matched by name
 * (case-insensitive), columns matched by exact header. Never throws on a
 * missing sheet/column — collects a warning instead, so one bad sheet
 * doesn't take down the whole upload (per the brief's "clear inline warning
 * on that specific card" rule).
 */
export function parseWorkbook(buffer: ArrayBuffer): ParsedUploadResult {
  const wb = XLSX.read(buffer, { type: "array" });
  const sheetsFound: string[] = [];
  const warnings: string[] = [];

  // Reject outright if this doesn't look like the expected workbook at all.
  const hasAnyExpectedSheet = ["Monthly_KPI", ...DIMENSION_SHEETS.map((d) => SHEET_LABELS[d.key].sourceSheet)]
    .some((name) => findSheet(wb, name));
  if (!hasAnyExpectedSheet) {
    throw new Error(
      "This file doesn't match the expected CRM Performance format — none of the required sheets " +
      "(Monthly_KPI, Category_Performance, etc.) were found. Check you're uploading the right file."
    );
  }

  // ---- Monthly_KPI ----
  const monthlyKpi: Record<string, unknown>[] = [];
  const kpiSheet = findSheet(wb, "Monthly_KPI");
  let currentMonth: string | null = null;
  if (kpiSheet) {
    sheetsFound.push("Monthly_KPI");
    readSheetRows(kpiSheet).forEach((r) => {
      const month = str(col(r, "Month"));
      if (!month) return;
      const statusRaw = str(col(r, "Period_Status")) ?? "Complete";
      monthlyKpi.push({
        month,
        platform: str(col(r, "Platform")) ?? "All",
        period_status: statusRaw === "Partial" ? "Partial" : "Complete",
        visits: num(col(r, "Visits")),
        orders: num(col(r, "Orders")),
        revenue_inr: num(col(r, "Revenue_INR")),
        cvr: num(col(r, "CVR")),
        aov_inr: num(col(r, "AOV_INR")),
        rpv_inr: num(col(r, "RPV_INR")),
      });
      if (statusRaw !== "Partial") currentMonth = month; // last complete month = "current"
    });
    if (monthlyKpi.length && !currentMonth) currentMonth = String(monthlyKpi[monthlyKpi.length - 1].month);
  } else {
    warnings.push("Monthly_KPI sheet not found — the executive KPI strip and trend chart will show the last successful upload.");
  }

  // ---- the seven identically-shaped dimension sheets ----
  const dimensions: Partial<Record<SheetKey, Record<string, unknown>[]>> = {};
  for (const { key, column } of DIMENSION_SHEETS) {
    const sourceSheetName = SHEET_LABELS[key].sourceSheet;
    const ws = findSheet(wb, sourceSheetName);
    if (!ws) {
      warnings.push(`${sourceSheetName} sheet not found — showing last successful upload for ${SHEET_LABELS[key].title}.`);
      continue;
    }
    sheetsFound.push(sourceSheetName);
    const rows = readSheetRows(ws);
    const missingCols = DIMENSION_METRIC_COLS.filter((c) => !rows.length || col(rows[0], c) === undefined && !(c in (rows[0] ?? {})));
    const parsed = rows
      .map((r) => {
        const month = str(col(r, "Month"));
        const dimVal = str(col(r, column));
        if (!month || !dimVal) return null;
        return {
          month, dimension_value: dimVal,
          visits: num(col(r, "Visits")), orders: num(col(r, "Orders")),
          revenue_inr: num(col(r, "Revenue_INR")), cvr: num(col(r, "CVR")),
          aov_inr: num(col(r, "AOV_INR")), rpv_inr: num(col(r, "RPV_INR")),
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
    dimensions[key] = parsed;
    if (parsed.length === 0) {
      warnings.push(`${sourceSheetName} had no usable rows (missing Month or ${column} values).`);
    }
  }

  // ---- Top 10 Performing PN — no Month column, always reflects current month ----
  const topPn: Record<string, unknown>[] = [];
  const topSheet = findSheet(wb, "top 10 performing PN");
  if (topSheet) {
    sheetsFound.push("top 10 performing PN");
    const rows = readSheetRows(topSheet);
    rows.forEach((r, i) => {
      const name = str(col(r, "PN name"));
      if (!name) return;
      topPn.push({
        pn_name: name, rank: i + 1,
        visits: num(col(r, "Visits")), orders: num(col(r, "Orders")),
        revenue_inr: num(col(r, "Revenue_INR")), cvr: num(col(r, "CVR")),
        aov_inr: num(col(r, "AOV_INR")), rpv_inr: num(col(r, "RPV_INR")),
      });
    });
  } else {
    warnings.push("\"top 10 performing PN\" sheet not found — the leaderboard card will show last month's data.");
  }
  if (topSheet && topPn.length === 0) {
    warnings.push("No data available for this month in the Top 10 Performing PN sheet.");
  }

  return { monthlyKpi, dimensions, topPn, sheetsFound, warnings, currentMonth };
}

/**
 * Writes a parsed workbook to Supabase. Dimension and Monthly_KPI rows upsert
 * on their natural keys, so history accumulates across uploads automatically
 * and re-uploading the same month simply refreshes it — never duplicates.
 * Top 10 PN has no natural key across months (it's always "now"), so it's
 * fully replaced every upload, per the spec.
 */
export async function saveUpload(
  parsed: ParsedUploadResult,
  filename: string,
  userId: string
): Promise<{ warnings: string[] }> {
  const warnings = [...parsed.warnings];

  if (parsed.monthlyKpi.length > 0) {
    const { error } = await supabase.from("perf_monthly_kpi")
      .upsert(parsed.monthlyKpi, { onConflict: "month,platform" });
    if (error) warnings.push(`Monthly_KPI save failed: ${error.message}`);
  }

  for (const [sheetKey, rows] of Object.entries(parsed.dimensions)) {
    if (!rows || rows.length === 0) continue;
    const payload = rows.map((r) => ({ ...r, sheet_key: sheetKey }));
    const { error } = await supabase.from("perf_dimension")
      .upsert(payload, { onConflict: "sheet_key,month,dimension_value" });
    if (error) warnings.push(`${SHEET_LABELS[sheetKey as SheetKey].sourceSheet} save failed: ${error.message}`);
  }

  if (parsed.topPn.length > 0) {
    await supabase.from("perf_top_pn").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    const { error } = await supabase.from("perf_top_pn").insert(parsed.topPn);
    if (error) warnings.push(`Top 10 PN save failed: ${error.message}`);
  }

  await supabase.from("perf_uploads").insert({
    filename, month: parsed.currentMonth, uploaded_by: userId,
    sheets_found: parsed.sheetsFound, warnings,
  });

  return { warnings };
}
