"use client";

import { getCachedAnalysis, setCachedAnalysis } from "./performanceData";
import type { DimensionAnalysisInput } from "@/lib/performanceAnalysis";
import type { TableAnalysis, TotalAnalysis } from "@/types/performance";

async function callRoute(body: Record<string, unknown>): Promise<{ analysis: unknown; model: string } | { error: string }> {
  try {
    const res = await fetch("/api/performance-analysis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) return { error: json.error ?? "Analysis request failed." };
    return json;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Network error calling the analysis service." };
  }
}

/** Reads the cache first unless force=true (the "Regenerate analysis" button path). */
export async function getTableAnalysis(
  sheetKey: string,
  input: DimensionAnalysisInput,
  lastFocus: string | undefined,
  force = false
): Promise<{ analysis: TableAnalysis | null; error?: string }> {
  if (!force) {
    const cached = await getCachedAnalysis("table", sheetKey, input.month);
    if (cached) return { analysis: cached as TableAnalysis };
  }
  const result = await callRoute({
    scope: "table",
    sheetTitle: input.sheetTitle,
    month: input.month,
    outliers: input.outliers,
    topPerformers: input.topPerformers,
    bottomPerformers: input.bottomPerformers,
    confidenceTags: input.confidenceTags,
    trailingHistory: input.trailingHistory,
    lastFocus,
  });
  if ("error" in result) return { analysis: null, error: result.error };
  await setCachedAnalysis("table", sheetKey, input.month, result.analysis, result.model);
  return { analysis: result.analysis as TableAnalysis };
}

export async function getTotalAnalysis(
  month: string,
  tableSummaries: unknown,
  lastMonthFocuses: unknown,
  force = false
): Promise<{ analysis: TotalAnalysis | null; error?: string }> {
  if (!force) {
    const cached = await getCachedAnalysis("total", null, month);
    if (cached) return { analysis: cached as TotalAnalysis };
  }
  const result = await callRoute({ scope: "total", month, tableSummaries, lastMonthFocuses });
  if ("error" in result) return { analysis: null, error: result.error };
  await setCachedAnalysis("total", null, month, result.analysis, result.model);
  return { analysis: result.analysis as TotalAnalysis };
}
