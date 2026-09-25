"use client";

import * as XLSX from "xlsx";
import type { SheetKey, UploadedPerformanceData, MonthlyKpiRow, DimensionRow, TopPnRow } from "@/types/performance";
import { SHEET_LABELS, EXPECTED_SHEETS } from "@/types/performance";
import { resolveColumns, pick, normalizeMonthValue, inferDimensionColumn, normalizePercentColumn, type FieldKey } from "@/lib/columnMatch";
import { profileSheet } from "@/lib/sheetProfile";

function findSheet(wb: XLSX.WorkBook, targetName: string): XLSX.WorkSheet | null {
  const target = targetName.trim().toLowerCase();
  const match = wb.SheetNames.find((n) => n.trim().toLowerCase() === target);
  return match ? wb.Sheets[match] : null;
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
 * Parses the uploaded workbook entirely client-side. Every sheet goes through
 * profileSheet() first, which finds the real header row (skipping merged
 * title rows and blank rows) rather than assuming row 1 is the header — that
 * was the actual cause of every "__EMPTY" column-not-found failure. Column
 * meaning is then resolved by alias matching, falling back to inferring the
 * dimension column from data shape if no name matches, and the month field
 * is optional per row: if a sheet has no month-like column at all, every row
 * is grouped under the workbook's detected current month instead of being
 * rejected outright.
 */
export function parseWorkbook(buffer: ArrayBuffer, filename: string): UploadedPerformanceData {
  // cellDates is OFF — raw numeric serials are decoded safely by normalizeMonthValue
  // via lib/columnMatch.ts, avoiding the same timezone bug fixed in the CRM upload.
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
    const { headers, rows } = profileSheet(kpiSheet);
    const map = resolveColumns(headers, ["month", "platform", "periodStatus", ...METRIC_FIELDS]);

    if (!map.month) {
      warnings.push(`Monthly_KPI: no Month-like column found among [${headers.join(", ")}]. The executive KPI strip and trend chart will be empty.`);
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
      if (monthlyKpi.length) {
        const cvrValues = normalizePercentColumn(monthlyKpi.map((r) => r.cvr));
        monthlyKpi.forEach((r, i) => { r.cvr = cvrValues[i]; });
      }
      if (!currentMonth && monthlyKpi.length) currentMonth = monthlyKpi[monthlyKpi.length - 1].month;
      if (rows.length && monthlyKpi.length === 0) {
        warnings.push("Monthly_KPI: found a Month column but no row produced a usable value.");
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

    const { headers, rows } = profileSheet(ws);
    if (rows.length === 0) {
      warnings.push(`${sourceSheetName}: could not locate a real header row with data beneath it (only title/blank rows were found).`);
      dimensions[key] = [];
      continue;
    }

    let map = resolveColumns(headers, ["month", field, ...METRIC_FIELDS]);
    const usedHeaders = new Set(Object.values(map));

    // Dimension column missing by name? Infer it from data shape instead of rejecting the sheet.
    let dimHeaderInferred = false;
    if (!map[field]) {
      const inferred = inferDimensionColumn(headers, rows, usedHeaders);
      if (inferred) { map = { ...map, [field]: inferred }; dimHeaderInferred = true; usedHeaders.add(inferred); }
    }

    // Month missing entirely? Don't reject the sheet — bucket every row under
    // the workbook's detected current month (or a literal fallback).
    const monthMissing = !map.month;
    const fallbackMonth = currentMonth ?? "This upload";
    if (monthMissing) {
      warnings.push(`${sourceSheetName}: no Month column found — all rows are shown under "${fallbackMonth}" rather than split by month.`);
    }
    if (dimHeaderInferred) {
      warnings.push(`${sourceSheetName}: used "${map[field]}" as the ${SHEET_LABELS[key].column} column (no column literally named "${SHEET_LABELS[key].column}" was found).`);
    }

    if (!map[field]) {
      warnings.push(`${sourceSheetName}: couldn't find or infer a ${SHEET_LABELS[key].column}-like column among [${headers.join(", ")}]. This table will be empty — tell me the actual column name and I'll map it directly.`);
      dimensions[key] = [];
      continue;
    }

    // Any header not already claimed by a known field is preserved verbatim per row.
    const knownHeaders = new Set(Object.values(map));
    const extraHeaders = headers.filter((h) => !knownHeaders.has(h));

    const parsed = rows
      .map((r) => {
        const month = monthMissing ? fallbackMonth : normalizeMonthValue(pick(r, map, "month"));
        const dimVal = str(pick(r, map, field));
        if (!month || !dimVal) return null;
        const extra: Record<string, string | number | null> = {};
        extraHeaders.forEach((h) => {
          const v = r[h];
          if (v === null || v === undefined || String(v).trim() === "") return;
          extra[h] = typeof v === "number" ? v : str(v);
        });
        return {
          id: `${key}:${month}:${dimVal}`,
          sheet_key: key,
          month, dimension_value: dimVal,
          visits: num(pick(r, map, "visits")), orders: num(pick(r, map, "orders")),
          revenue_inr: num(pick(r, map, "revenue")), cvr: num(pick(r, map, "cvr")),
          aov_inr: num(pick(r, map, "aov")), rpv_inr: num(pick(r, map, "rpv")),
          extra: Object.keys(extra).length ? extra : undefined,
        } as DimensionRow;
      })
      .filter((r): r is DimensionRow => r !== null);

    if (parsed.length) {
      const cvrValues = normalizePercentColumn(parsed.map((r) => r.cvr));
      parsed.forEach((r, i) => { r.cvr = cvrValues[i]; });
    }

    dimensions[key] = parsed;
    if (parsed.length === 0) {
      warnings.push(`${sourceSheetName}: found the header row but no row had both a month and a ${SHEET_LABELS[key].column} value filled in.`);
    }
  }

  // ---- Top 10 Performing PN — no Month column, always the current month ----
  const topPn: TopPnRow[] = [];
  const topSheet = findSheet(wb, "top 10 performing PN");
  if (topSheet) {
    sheetsFound.push("top 10 performing PN");
    const { headers, rows } = profileSheet(topSheet);
    let map = resolveColumns(headers, ["pnName", ...METRIC_FIELDS]);

    if (!map.pnName) {
      const inferred = inferDimensionColumn(headers, rows, new Set(Object.values(map)));
      if (inferred) map = { ...map, pnName: inferred };
    }

    if (!map.pnName) {
      warnings.push(`"top 10 performing PN": couldn't find or infer a name-like column among [${headers.join(", ")}].`);
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
