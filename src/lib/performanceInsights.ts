import type { DimensionRow, MonthlyKpiRow, TopPnRow } from "@/types/performance";
import { parseMonthLabel } from "./performanceAnalysis";

/**
 * Deterministic, real-number insight computation — "highest point," "best
 * category," "trend direction" and similar are just data analysis, not
 * generation, so they're computed directly here rather than burning a Gemini
 * call per section. Every value returned traces back to an exact number in
 * the uploaded data. The one place a real LLM call still happens is the
 * Executive AI Summary (services/geminiAnalysis.ts / TotalAnalysisPanel),
 * where genuine synthesis across sources is the point.
 */

export function sortedMonths(rows: { month: string }[]): string[] {
  return [...new Set(rows.map((r) => r.month))].sort(
    (a, b) => parseMonthLabel(a).sortKey - parseMonthLabel(b).sortKey
  );
}

export function trendDirection(values: number[]): "up" | "down" | "flat" {
  if (values.length < 2) return "flat";
  const first = values[0], last = values[values.length - 1];
  if (first === 0) return last > 0 ? "up" : "flat";
  const pct = ((last - first) / Math.abs(first)) * 100;
  if (pct > 3) return "up";
  if (pct < -3) return "down";
  return "flat";
}

export interface LineInsight {
  highestMonth: string; highestValue: number;
  lowestMonth: string; lowestValue: number;
  direction: "up" | "down" | "flat";
  notableChange: string;
}

export function lineChartInsight(series: { label: string; value: number }[]): LineInsight | null {
  if (series.length === 0) return null;
  const sorted = [...series].sort((a, b) => b.value - a.value);
  const highest = sorted[0], lowest = sorted[sorted.length - 1];
  const direction = trendDirection(series.map((s) => s.value));

  // Largest single month-over-month swing.
  let biggestSwing = { label: "", pct: 0 };
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1].value, cur = series[i].value;
    if (prev === 0) continue;
    const pct = ((cur - prev) / Math.abs(prev)) * 100;
    if (Math.abs(pct) > Math.abs(biggestSwing.pct)) biggestSwing = { label: series[i].label, pct };
  }
  const notableChange = biggestSwing.label
    ? `${biggestSwing.label} moved ${biggestSwing.pct >= 0 ? "+" : ""}${biggestSwing.pct.toFixed(1)}% vs the prior month`
    : "No significant single-month swing";

  return { highestMonth: highest.label, highestValue: highest.value, lowestMonth: lowest.label, lowestValue: lowest.value, direction, notableChange };
}

export interface RankedInsight {
  best: DimensionRow | null;
  worst: DimensionRow | null;
  bestCvr: DimensionRow | null;
  bestRpv: DimensionRow | null;
  top3: DimensionRow[];
  bottom3: DimensionRow[];
}

export function rankByRevenue(rows: DimensionRow[]): RankedInsight {
  const sorted = [...rows].sort((a, b) => (b.revenue_inr ?? 0) - (a.revenue_inr ?? 0));
  const byCvr = [...rows].sort((a, b) => (b.cvr ?? 0) - (a.cvr ?? 0));
  const byRpv = [...rows].sort((a, b) => (b.rpv_inr ?? 0) - (a.rpv_inr ?? 0));
  return {
    best: sorted[0] ?? null,
    worst: sorted[sorted.length - 1] ?? null,
    bestCvr: byCvr[0] ?? null,
    bestRpv: byRpv[0] ?? null,
    top3: sorted.slice(0, 3),
    bottom3: sorted.slice(-3).reverse(),
  };
}

/** Cohort classification: Scale / Maintain / Recover / Deprioritize, from real CVR + revenue medians. */
export type CohortClass = "SCALE" | "MAINTAIN" | "RECOVER" | "DEPRIORITIZE";

export function classifyCohort(row: DimensionRow, medianCvr: number, medianRevenue: number): CohortClass {
  const highCvr = (row.cvr ?? 0) >= medianCvr;
  const highRevenue = (row.revenue_inr ?? 0) >= medianRevenue;
  const highTraffic = (row.visits ?? 0) >= 0; // traffic context folded via revenue/cvr combination below
  if (highRevenue && highCvr) return "SCALE";
  if (highRevenue && !highCvr) return "MAINTAIN";
  if (!highRevenue && highCvr) return "MAINTAIN";
  if (!highRevenue && !highCvr && (row.visits ?? 0) > medianRevenue) return "RECOVER";
  return "DEPRIORITIZE";
}

export function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Opportunity Matrix quadrant classification: Revenue x CVR. */
export function classifyQuadrant(revenue: number, cvr: number, medianRevenue: number, medianCvr: number):
  "SCALE" | "OPTIMIZE" | "GROW" | "DEPRIORITIZE" {
  const highRevenue = revenue >= medianRevenue;
  const highCvr = cvr >= medianCvr;
  if (highRevenue && highCvr) return "SCALE";
  if (highRevenue && !highCvr) return "OPTIMIZE";
  if (!highRevenue && highCvr) return "GROW";
  return "DEPRIORITIZE";
}

export function topPnInsight(rows: TopPnRow[]) {
  if (rows.length === 0) return null;
  const byRevenue = [...rows].sort((a, b) => (b.revenue_inr ?? 0) - (a.revenue_inr ?? 0));
  const byCvr = [...rows].sort((a, b) => (b.cvr ?? 0) - (a.cvr ?? 0));
  const byRpv = [...rows].sort((a, b) => (b.rpv_inr ?? 0) - (a.rpv_inr ?? 0));
  return {
    highestRevenue: byRevenue[0], highestCvr: byCvr[0], mostEfficient: byRpv[0],
  };
}

export function momPct(current: number, previous: number | undefined): number | null {
  if (previous == null || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}
