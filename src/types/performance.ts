/** The Performance Analytics module — entirely in-session, no backend persistence by design. */

export type SheetKey =
  | "category" | "remarketing_flow" | "segment" | "pn_type" | "cohort" | "occasion" | "tag";

export interface DimensionRow {
  id: string;               // synthetic, deterministic — not a DB key
  sheet_key: SheetKey;
  month: string;
  dimension_value: string;
  visits: number | null;
  orders: number | null;
  revenue_inr: number | null;
  cvr: number | null;       // decimal, e.g. 0.0157 — multiply by 100 only at render time
  aov_inr: number | null;
  rpv_inr: number | null;
  /** Any other numeric/text columns found in the sheet that don't map to a
   *  known metric — preserved rather than dropped, per "don't discard values". */
  extra?: Record<string, string | number | null>;
}

export interface MonthlyKpiRow {
  month: string;
  platform: string;
  period_status: "Complete" | "Partial";
  visits: number | null;
  orders: number | null;
  revenue_inr: number | null;
  cvr: number | null;
  aov_inr: number | null;
  rpv_inr: number | null;
}

export interface TopPnRow {
  id: string;
  pn_name: string;
  visits: number | null;
  orders: number | null;
  revenue_inr: number | null;
  cvr: number | null;
  aov_inr: number | null;
  rpv_inr: number | null;
  rank: number;
}

/** Everything one upload produces, held entirely in page state — nothing is written anywhere. */
export interface UploadedPerformanceData {
  filename: string;
  uploadedAt: string;
  currentMonth: string | null;
  monthlyKpi: MonthlyKpiRow[];
  dimensions: Partial<Record<SheetKey, DimensionRow[]>>;
  topPn: TopPnRow[];
  sheetsFound: string[];
  warnings: string[];
}

/** Strict JSON contract every per-table Gemini call must return. */
export interface TableAnalysis {
  pattern: string;
  risk_or_loophole: string;
  focus_next_month: string;
  estimated_impact: string;
  confidence: "High" | "Medium" | "Low";
  last_month_check?: string;
}

/** Strict JSON contract the Executive AI Summary (Section 2) must return. */
export interface TotalAnalysis {
  headline: string;
  working: { best_category: string; best_segment: string; best_cohort: string;
             best_remarketing_flow: string; best_pn_type: string; best_occasion: string };
  risks: { weakest_category: string; weakest_audience: string; weakest_campaign_type: string };
  opportunities: { scale: string; optimize: string; revenue_growth: string };
  recommendations: string[]; // exactly 3
  confidence: "High" | "Medium" | "Low";
}

export const SHEET_LABELS: Record<SheetKey, { title: string; column: string; sourceSheet: string }> = {
  category:          { title: "Category Performance",     column: "Category",          sourceSheet: "Category_Performance" },
  remarketing_flow:  { title: "Remarketing Flow",          column: "Remarketing Flow",  sourceSheet: "Remarketing_Flow" },
  segment:           { title: "Segment Performance",       column: "Segment",           sourceSheet: "Segment_Performance" },
  pn_type:           { title: "PN Type Performance",       column: "PN Type",           sourceSheet: "PN_Type_Performance" },
  cohort:            { title: "Cohort Performance",        column: "Cohort",            sourceSheet: "Cohort_Performance" },
  occasion:          { title: "Occasion Performance",      column: "Occasion",          sourceSheet: "Occasion_Performance" },
  tag:               { title: "Tag Performance",           column: "Tag",               sourceSheet: "Tag_Performance" },
};

export const SHEET_ORDER: SheetKey[] = [
  "category", "remarketing_flow", "segment", "pn_type", "cohort", "occasion", "tag",
];

export const EXPECTED_SHEETS = [
  "Monthly_KPI", "Category_Performance", "Remarketing_Flow", "Segment_Performance",
  "PN_Type_Performance", "Cohort_Performance", "Occasion_Performance", "Tag_Performance",
  "top 10 performing PN",
];
