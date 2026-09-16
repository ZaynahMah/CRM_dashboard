"use client";

import { supabase } from "@/lib/supabase";
import type { DimensionRow, MonthlyKpiRow, TopPnRow, UploadRecord, SheetKey } from "@/types/performance";
import { sortMonthlyKpi } from "@/lib/performanceAnalysis";

export async function listMonthlyKpi(): Promise<MonthlyKpiRow[]> {
  const { data } = await supabase.from("perf_monthly_kpi").select("*");
  return sortMonthlyKpi((data ?? []) as MonthlyKpiRow[]);
}

/** All history for one sheet, across every month ever uploaded — used for trend + trailing history. */
export async function listDimensionHistory(sheetKey: SheetKey): Promise<DimensionRow[]> {
  const { data } = await supabase.from("perf_dimension").select("*").eq("sheet_key", sheetKey);
  return (data ?? []) as DimensionRow[];
}

export async function listTopPn(): Promise<TopPnRow[]> {
  const { data } = await supabase.from("perf_top_pn").select("*").order("rank");
  return (data ?? []) as TopPnRow[];
}

export async function lastUpload(): Promise<UploadRecord | null> {
  const { data } = await supabase.from("perf_uploads").select("*").order("uploaded_at", { ascending: false }).limit(1).maybeSingle();
  return (data ?? null) as UploadRecord | null;
}

export async function getCachedAnalysis(scope: "table" | "total", sheetKey: string | null, month: string) {
  let q = supabase.from("perf_ai_cache").select("*").eq("scope", scope).eq("month", month).eq("filter_key", "default");
  q = sheetKey ? q.eq("sheet_key", sheetKey) : q.is("sheet_key", null);
  const { data } = await q.maybeSingle();
  return data?.analysis ?? null;
}

export async function setCachedAnalysis(scope: "table" | "total", sheetKey: string | null, month: string, analysis: unknown, model: string) {
  await supabase.from("perf_ai_cache").upsert({
    scope, sheet_key: sheetKey, month, filter_key: "default", analysis, model,
  }, { onConflict: "scope,sheet_key,month,filter_key" });
}
