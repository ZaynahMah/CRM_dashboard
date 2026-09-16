"use client";

import * as XLSX from "xlsx";
import type { SheetKey, UploadedPerformanceData, MonthlyKpiRow, DimensionRow, TopPnRow } from "@/types/performance";
import { SHEET_LABELS, EXPECTED_SHEETS } from "@/types/performance";

const DIMENSION_METRIC_COLS = ["Visits", "Orders", "Revenue_INR", "CVR", "AOV_INR", "RPV_INR"];

function findSheet(wb: XLSX.WorkBook, targetName: string): XLSX.WorkSheet | null {
  const target = targetName.trim().toLowerCase();
  const match = wb.SheetNames.find((n) => n.trim().toLowerCase() === target);
  return match ? wb.Sheets[match] : null;
}
function readSheetRows(ws: XLSX.WorkSheet): Record<string, unknown>[] {
  return XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });
}
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
 * Parses the uploaded workbook entirely client-side and returns fully-typed,
 * ready-to-render data — nothing is sent anywhere, nothing is persisted.
 * A page refresh loses it; re-upload to get it back. That's intentional.
 */
export function parseWorkbook(buffer: ArrayBuffer, filename: string): UploadedPerformanceData {
  const wb = XLSX.read(buffer, { type: "array" });
  const sheetsFound: string[] = [];
  const warnings: string[] = [];

  const hasAnyExpectedSheet = EXPECTED_SHEETS.some((name) => findSheet(wb, name));
  if (!hasAnyExpectedSheet) {
    throw new Error(
      "This file doesn't match the expected CRM Performance format — none of the required sheets " +
      "(Monthly_KPI, Category_Performance, etc.) were found. Check you're uploading the right file."
    );
  }

  // ---- Monthly_KPI ----
  const monthlyKpi: MonthlyKpiRow[] = [];
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
      if (statusRaw !== "Partial") currentMonth = month;
    });
    if (monthlyKpi.length && !currentMonth) currentMonth = monthlyKpi[monthlyKpi.length - 1].month;
  } else {
    warnings.push("Monthly_KPI sheet not found — the executive KPI strip and trend chart will be empty.");
  }

  // ---- the seven identically-shaped dimension sheets ----
  const dimensions: Partial<Record<SheetKey, DimensionRow[]>> = {};
  for (const { key, column } of DIMENSION_SHEETS) {
    const sourceSheetName = SHEET_LABELS[key].sourceSheet;
    const ws = findSheet(wb, sourceSheetName);
    if (!ws) {
      warnings.push(`${sourceSheetName} sheet not found — ${SHEET_LABELS[key].title} will be empty.`);
      continue;
    }
    sheetsFound.push(sourceSheetName);
    const rows = readSheetRows(ws);
    const parsed = rows
      .map((r) => {
        const month = str(col(r, "Month"));
        const dimVal = str(col(r, column));
        if (!month || !dimVal) return null;
        return {
          id: `${key}:${month}:${dimVal}`,
          sheet_key: key,
          month, dimension_value: dimVal,
          visits: num(col(r, "Visits")), orders: num(col(r, "Orders")),
          revenue_inr: num(col(r, "Revenue_INR")), cvr: num(col(r, "CVR")),
          aov_inr: num(col(r, "AOV_INR")), rpv_inr: num(col(r, "RPV_INR")),
        } as DimensionRow;
      })
      .filter((r): r is DimensionRow => r !== null);
    dimensions[key] = parsed;
    if (parsed.length === 0) {
      warnings.push(`${sourceSheetName} had no usable rows (missing Month or ${column} values).`);
    }
  }

  // ---- Top 10 Performing PN — no Month column, always the current month ----
  const topPn: TopPnRow[] = [];
  const topSheet = findSheet(wb, "top 10 performing PN");
  if (topSheet) {
    sheetsFound.push("top 10 performing PN");
    readSheetRows(topSheet).forEach((r, i) => {
      const name = str(col(r, "PN name"));
      if (!name) return;
      topPn.push({
        id: `pn:${i}:${name}`, pn_name: name, rank: i + 1,
        visits: num(col(r, "Visits")), orders: num(col(r, "Orders")),
        revenue_inr: num(col(r, "Revenue_INR")), cvr: num(col(r, "CVR")),
        aov_inr: num(col(r, "AOV_INR")), rpv_inr: num(col(r, "RPV_INR")),
      });
    });
    if (topPn.length === 0) warnings.push("No data available for this month in the Top 10 Performing PN sheet.");
  } else {
    warnings.push('"top 10 performing PN" sheet not found — the leaderboard will be empty.');
  }

  return {
    filename, uploadedAt: new Date().toISOString(), currentMonth,
    monthlyKpi, dimensions, topPn, sheetsFound, warnings,
  };
}
