/** The Performance Analytics module — independent of the campaign/scheduling data model. */

export type SheetKey =
  | "category" | "remarketing_flow" | "segment" | "pn_type" | "cohort" | "occasion" | "tag";

export interface DimensionRow {
  id: string;
  sheet_key: SheetKey;
  month: string;
  dimension_value: string;
  visits: number | null;
  orders: number | null;
  revenue_inr: number | null;
  cvr: number | null;       // decimal, e.g. 0.0157 — multiply by 100 only at render time
  aov_inr: number | null;
  rpv_inr: number | null;
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

export interface UploadRecord {
  id: string;
  filename: string;
  month: string | null;
  sheets_found: string[];
  warnings: string[];
  uploaded_at: string;
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

/** Strict JSON contract the cross-cutting Total Analysis panel must return. */
export interface TotalAnalysis {
  headline: string;
  strongest_driver: string;
  biggest_risk: string;
  cross_cutting_insight: string;
  top_3_priorities: string[];
  portfolio_fatigue_check: string;
  last_month_scorecard: string;
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
