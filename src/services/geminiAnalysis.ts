"use client";

import { supabase } from "@/lib/supabase";
import type { DimensionAnalysisInput } from "@/lib/performanceAnalysis";
import type { TableAnalysis, TotalAnalysis } from "@/types/performance";

/**
 * In-session cache only — a plain module-level Map. It survives switching
 * tabs/re-renders within the same page load (so "Regenerate analysis" is a
 * deliberate action, not something that fires on every render), but resets
 * completely on a page refresh, matching the rest of this module's design:
 * nothing persists anywhere, by choice.
 */
const sessionCache = new Map<string, unknown>();
const cacheKey = (scope: string, sheetKey: string | null, month: string) => `${scope}:${sheetKey ?? ""}:${month}`;

async function callRoute(body: Record<string, unknown>): Promise<{ analysis: unknown; model: string } | { error: string }> {
  try {
    // The route requires a valid Supabase session. Sending the access token
    // the client already holds is what proves it — without this header the
    // route returns 401 and never reaches Gemini.
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      return { error: "Your session has expired. Please sign in again." };
    }

    const res = await fetch("/api/performance-analysis", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) return { error: json.error ?? "Analysis request failed." };
    return json;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Network error calling the analysis service." };
  }
}

/** Reads the in-session cache first unless force=true (the "Regenerate analysis" button path). */
export async function getTableAnalysis(
  sheetKey: string,
  input: DimensionAnalysisInput,
  lastFocus: string | undefined,
  force = false
): Promise<{ analysis: TableAnalysis | null; error?: string }> {
  const key = cacheKey("table", sheetKey, input.month);
  if (!force && sessionCache.has(key)) return { analysis: sessionCache.get(key) as TableAnalysis };

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
  sessionCache.set(key, result.analysis);
  return { analysis: result.analysis as TableAnalysis };
}

export async function getTotalAnalysis(
  month: string,
  tableSummaries: unknown,
  lastMonthFocuses: unknown,
  force = false
): Promise<{ analysis: TotalAnalysis | null; error?: string }> {
  const key = cacheKey("total", null, month);
  if (!force && sessionCache.has(key)) return { analysis: sessionCache.get(key) as TotalAnalysis };

  const result = await callRoute({ scope: "total", month, tableSummaries, lastMonthFocuses });
  if ("error" in result) return { analysis: null, error: result.error };
  sessionCache.set(key, result.analysis);
  return { analysis: result.analysis as TotalAnalysis };
}
