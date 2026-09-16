import type { DimensionRow, MonthlyKpiRow } from "@/types/performance";

/**
 * Everything Gemini is NOT allowed to do itself: outlier detection, confidence
 * tagging, and trend assembly happen here in code first, so the model only
 * ever sees a small, pre-filtered, already-reasoned-about payload — never the
 * raw table. This is what the brief calls "the pipeline."
 */

export interface OutlierFlag {
  dimension_value: string;
  metric: "revenue_inr" | "cvr" | "rpv_inr";
  z_score: number;
  value: number;
}

export interface ConfidenceTag {
  dimension_value: string;
  confidence: "Low" | "Medium" | "High";
  orders: number;
}

export interface DimensionAnalysisInput {
  sheetTitle: string;
  month: string;
  rows: DimensionRow[];
  outliers: OutlierFlag[];
  topPerformers: DimensionRow[];
  bottomPerformers: DimensionRow[];
  confidenceTags: ConfidenceTag[];
  trailingHistory: Record<string, DimensionRow[]>; // dimension_value -> up to 3 prior months, oldest first
  overlapDataAvailable: false; // the workbook carries no user-level data, so true overlap can never be computed —
  // always false; the prompt is told this explicitly rather than being left to infer/guess.
}

function mean(nums: number[]) { return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0; }
function stddev(nums: number[], m: number) {
  if (nums.length < 2) return 0;
  return Math.sqrt(mean(nums.map((n) => (n - m) ** 2)));
}

function zScores(rows: DimensionRow[], key: "revenue_inr" | "cvr" | "rpv_inr"): Map<string, number> {
  const vals = rows.map((r) => r[key] ?? 0);
  const m = mean(vals);
  const sd = stddev(vals, m);
  const out = new Map<string, number>();
  if (sd === 0) return out;
  rows.forEach((r) => out.set(r.dimension_value, ((r[key] ?? 0) - m) / sd));
  return out;
}

/** Orders <50 = Low, 50–500 = Medium, >500 = High — the exact thresholds from the brief. */
export function confidenceFor(orders: number | null): "Low" | "Medium" | "High" {
  const o = orders ?? 0;
  if (o < 50) return "Low";
  if (o <= 500) return "Medium";
  return "High";
}

const Z_THRESHOLD = 1.5;

export function buildDimensionAnalysisInput(
  sheetTitle: string,
  month: string,
  currentRows: DimensionRow[],
  historyRows: DimensionRow[] // all months for this sheet, used to pull trailing history
): DimensionAnalysisInput {
  const revenueZ = zScores(currentRows, "revenue_inr");
  const cvrZ = zScores(currentRows, "cvr");
  const rpvZ = zScores(currentRows, "rpv_inr");

  const outliers: OutlierFlag[] = [];
  currentRows.forEach((r) => {
    const rz = revenueZ.get(r.dimension_value) ?? 0;
    const cz = cvrZ.get(r.dimension_value) ?? 0;
    const pz = rpvZ.get(r.dimension_value) ?? 0;
    if (Math.abs(rz) >= Z_THRESHOLD) outliers.push({ dimension_value: r.dimension_value, metric: "revenue_inr", z_score: rz, value: r.revenue_inr ?? 0 });
    if (Math.abs(cz) >= Z_THRESHOLD) outliers.push({ dimension_value: r.dimension_value, metric: "cvr", z_score: cz, value: r.cvr ?? 0 });
    if (Math.abs(pz) >= Z_THRESHOLD) outliers.push({ dimension_value: r.dimension_value, metric: "rpv_inr", z_score: pz, value: r.rpv_inr ?? 0 });
  });

  const sortedByRevenue = [...currentRows].sort((a, b) => (b.revenue_inr ?? 0) - (a.revenue_inr ?? 0));
  const topPerformers = sortedByRevenue.slice(0, 3);
  const bottomPerformers = sortedByRevenue.slice(-3).reverse();

  const confidenceTags: ConfidenceTag[] = currentRows.map((r) => ({
    dimension_value: r.dimension_value,
    confidence: confidenceFor(r.orders),
    orders: r.orders ?? 0,
  }));

  // Trailing 3 months per dimension, oldest first, excluding the current month itself.
  const sortedMonths = [...new Set(historyRows.map((r) => r.month))]
    .filter((m) => m !== month)
    .sort((a, b) => parseMonthLabel(a).sortKey - parseMonthLabel(b).sortKey);
  const priorMonths = sortedMonths.slice(-3);

  const trailingHistory: Record<string, DimensionRow[]> = {};
  currentRows.forEach((r) => {
    trailingHistory[r.dimension_value] = priorMonths
      .map((m) => historyRows.find((h) => h.month === m && h.dimension_value === r.dimension_value))
      .filter((x): x is DimensionRow => Boolean(x));
  });

  return {
    sheetTitle, month, rows: currentRows, outliers, topPerformers, bottomPerformers,
    confidenceTags, trailingHistory, overlapDataAvailable: false,
  };
}

/**
 * Best-effort chronological ordering for free-text month labels like
 * "Aug 2026", "August 2026", "2026-08", "08/2026". Falls back to 0 (keeps
 * original order) if nothing parses — ingestion stays tolerant per the brief,
 * this is only used for trend sorting, never for validation/rejection.
 */
const MONTHS = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
export function parseMonthLabel(label: string): { sortKey: number; label: string } {
  const clean = label.trim().toLowerCase();
  const iso = clean.match(/^(\d{4})-(\d{1,2})$/);
  if (iso) return { sortKey: parseInt(iso[1]) * 12 + parseInt(iso[2]), label };
  const slash = clean.match(/^(\d{1,2})\/(\d{4})$/);
  if (slash) return { sortKey: parseInt(slash[2]) * 12 + parseInt(slash[1]), label };
  const named = clean.match(/^([a-z]{3,})[a-z]*\.?\s*[-,]?\s*'?(\d{2,4})$/);
  if (named) {
    const mi = MONTHS.findIndex((m) => named[1].startsWith(m));
    let year = parseInt(named[2]);
    if (year < 100) year += 2000;
    if (mi >= 0) return { sortKey: year * 12 + mi, label };
  }
  return { sortKey: 0, label };
}

/** ₹ compact formatting — applied only at render time, never mutates stored values. */
export function fmtInr(n: number | null | undefined): string {
  if (n == null) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_00_00_000) return `₹${(n / 1_00_00_000).toFixed(2)} Cr`;
  if (abs >= 1_00_000) return `₹${(n / 1_00_000).toFixed(2)} L`;
  if (abs >= 1_000) return `₹${(n / 1_000).toFixed(1)}K`;
  return `₹${n.toFixed(0)}`;
}

export function fmtPct(decimal: number | null | undefined): string {
  if (decimal == null) return "—";
  return `${(decimal * 100).toFixed(2)}%`;
}

export function momChange(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

/** Sort a monthly KPI history list chronologically using the same tolerant parser. */
export function sortMonthlyKpi(rows: MonthlyKpiRow[]): MonthlyKpiRow[] {
  return [...rows].sort((a, b) => parseMonthLabel(a.month).sortKey - parseMonthLabel(b.month).sortKey);
}
