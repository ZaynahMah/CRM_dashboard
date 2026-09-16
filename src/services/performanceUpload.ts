"use client";

import * as XLSX from "xlsx";
import type { SheetKey, UploadedPerformanceData, MonthlyKpiRow, DimensionRow, TopPnRow } from "@/types/performance";
import { SHEET_LABELS, EXPECTED_SHEETS } from "@/types/performance";
import { resolveColumns, pick, normalizeMonthValue, type FieldKey } from "@/lib/columnMatch";

function findSheet(wb: XLSX.WorkBook, targetName: string): XLSX.WorkSheet | null {
  const target = targetName.trim().toLowerCase();
  const match = wb.SheetNames.find((n) => n.trim().toLowerCase() === target);
  return match ? wb.Sheets[match] : null;
}
function readSheetRows(ws: XLSX.WorkSheet): Record<string, unknown>[] {
  return XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });
}
function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[,%]/g, ""));
  return Number.isFinite(n) ? n : null;
}
function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

const METRIC_FIELDS: FieldKey[] = ["visits", "orders", "revenue", "cvr", "aov", "rpv"];

const DIMENSION_SHEETS: { key: SheetKey; field: FieldKey }[] = [
  { key: "category", field: "category" },
  { key: "remarketing_flow", field: "remarketingFlow" },
  { key: "segment", field: "segment" },
  { key: "pn_type", field: "pnType" },
  { key: "cohort", field: "cohort" },
  { key: "occasion", field: "occasion" },
  { key: "tag", field: "tag" },
];

/**
 * Parses the uploaded workbook entirely client-side and returns fully-typed,
 * ready-to-render data — nothing is sent anywhere, nothing is persisted.
 * Columns are matched by meaning (see lib/columnMatch.ts), not by exact
 * header text, since real exports rarely use the literal spec wording.
 */
export function parseWorkbook(buffer: ArrayBuffer, filename: string): UploadedPerformanceData {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
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
    const rows = readSheetRows(kpiSheet);
    const headers = rows.length ? Object.keys(rows[0]) : [];
    const map = resolveColumns(headers, ["month", "platform", "periodStatus", ...METRIC_FIELDS]);

    if (!map.month) {
      warnings.push('Monthly_KPI: could not find a Month-like column (tried "Month", "Reporting Month", "Period", etc.) — the executive KPI strip and trend chart will be empty.');
    } else {
      rows.forEach((r) => {
        const month = normalizeMonthValue(pick(r, map, "month"));
        if (!month) return;
        const statusRaw = str(pick(r, map, "periodStatus")) ?? "Complete";
        monthlyKpi.push({
          month,
          platform: str(pick(r, map, "platform")) ?? "All",
          period_status: statusRaw === "Partial" ? "Partial" : "Complete",
          visits: num(pick(r, map, "visits")),
          orders: num(pick(r, map, "orders")),
          revenue_inr: num(pick(r, map, "revenue")),
          cvr: num(pick(r, map, "cvr")),
          aov_inr: num(pick(r, map, "aov")),
          rpv_inr: num(pick(r, map, "rpv")),
        });
        if (statusRaw !== "Partial") currentMonth = month;
      });
      if (monthlyKpi.length && !currentMonth) currentMonth = monthlyKpi[monthlyKpi.length - 1].month;
      if (rows.length && monthlyKpi.length === 0) {
        warnings.push("Monthly_KPI: found the Month column but no rows produced a usable value — check the column mapping shown isn't picking up a blank column.");
      }
    }
  } else {
    warnings.push("Monthly_KPI sheet not found — the executive KPI strip and trend chart will be empty.");
  }

  // ---- the seven identically-shaped dimension sheets ----
  const dimensions: Partial<Record<SheetKey, DimensionRow[]>> = {};
  for (const { key, field } of DIMENSION_SHEETS) {
    const sourceSheetName = SHEET_LABELS[key].sourceSheet;
    const ws = findSheet(wb, sourceSheetName);
    if (!ws) {
      warnings.push(`${sourceSheetName} sheet not found — ${SHEET_LABELS[key].title} will be empty.`);
      continue;
    }
    sheetsFound.push(sourceSheetName);

    const rows = readSheetRows(ws);
    const headers = rows.length ? Object.keys(rows[0]) : [];
    const map = resolveColumns(headers, ["month", field, ...METRIC_FIELDS]);

    const missing: string[] = [];
    if (!map.month) missing.push("Month");
    if (!map[field]) missing.push(SHEET_LABELS[key].column);

    if (missing.length > 0) {
      warnings.push(
        `${sourceSheetName}: couldn't find a ${missing.join(" or ")}-like column among [${headers.join(", ")}]. ` +
        `Rename the header(s) to something recognizable (e.g. "Month", "${SHEET_LABELS[key].column}") or tell me the actual header names and I'll add them as aliases.`
      );
      dimensions[key] = [];
      continue;
    }

    const parsed = rows
      .map((r) => {
        const month = normalizeMonthValue(pick(r, map, "month"));
        const dimVal = str(pick(r, map, field));
        if (!month || !dimVal) return null;
        return {
          id: `${key}:${month}:${dimVal}`,
          sheet_key: key,
          month, dimension_value: dimVal,
          visits: num(pick(r, map, "visits")), orders: num(pick(r, map, "orders")),
          revenue_inr: num(pick(r, map, "revenue")), cvr: num(pick(r, map, "cvr")),
          aov_inr: num(pick(r, map, "aov")), rpv_inr: num(pick(r, map, "rpv")),
        } as DimensionRow;
      })
      .filter((r): r is DimensionRow => r !== null);

    dimensions[key] = parsed;
    if (parsed.length === 0) {
      warnings.push(`${sourceSheetName}: found Month and ${SHEET_LABELS[key].column} columns, but no row had both values filled in.`);
    }
  }

  // ---- Top 10 Performing PN — no Month column, always the current month ----
  const topPn: TopPnRow[] = [];
  const topSheet = findSheet(wb, "top 10 performing PN");
  if (topSheet) {
    sheetsFound.push("top 10 performing PN");
    const rows = readSheetRows(topSheet);
    const headers = rows.length ? Object.keys(rows[0]) : [];
    const map = resolveColumns(headers, ["pnName", ...METRIC_FIELDS]);

    if (!map.pnName) {
      warnings.push(`"top 10 performing PN": couldn't find a name-like column among [${headers.join(", ")}] (tried "PN name", "Campaign", "Push Name", etc.).`);
    } else {
      rows.forEach((r, i) => {
        const name = str(pick(r, map, "pnName"));
        if (!name) return;
        topPn.push({
          id: `pn:${i}:${name}`, pn_name: name, rank: i + 1,
          visits: num(pick(r, map, "visits")), orders: num(pick(r, map, "orders")),
          revenue_inr: num(pick(r, map, "revenue")), cvr: num(pick(r, map, "cvr")),
          aov_inr: num(pick(r, map, "aov")), rpv_inr: num(pick(r, map, "rpv")),
        });
      });
      if (topPn.length === 0) warnings.push("No data available for this month in the Top 10 Performing PN sheet.");
    }
  } else {
    warnings.push('"top 10 performing PN" sheet not found — the leaderboard will be empty.');
  }

  return {
    filename, uploadedAt: new Date().toISOString(), currentMonth,
    monthlyKpi, dimensions, topPn, sheetsFound, warnings,
  };
}
