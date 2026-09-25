"use client";

import type { DimensionRow } from "@/types/performance";
import { HorizontalRanking, Heatmap } from "./ChartsAdvanced";
import { rankByRevenue } from "@/lib/performanceInsights";
import { fmtInr, fmtPct } from "@/lib/performanceAnalysis";
import { Card, CardHead, Empty } from "./ui";

/** Section 4 — Category Intelligence: revenue ranking + a strength heatmap. */
export function CategoryIntelligence({ rows }: { rows: DimensionRow[] }) {
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => (b.revenue_inr ?? 0) - (a.revenue_inr ?? 0));
  const insight = rankByRevenue(rows);

  const heatmapRows = sorted.slice(0, 10).map((r) => ({
    label: r.dimension_value,
    values: [r.visits, r.orders, r.revenue_inr, r.cvr, r.rpv_inr],
  }));
  const heatmapCols = [
    { label: "Visits" }, { label: "Orders" },
    { label: "Revenue", format: fmtInr }, { label: "CVR", format: fmtPct },
    { label: "RPV", format: fmtInr },
  ];

  const scalingCandidates = rows
    .filter((r) => (r.cvr ?? 0) > 0 && (r.revenue_inr ?? 0) > 0)
    .sort((a, b) => (b.cvr ?? 0) - (a.cvr ?? 0))
    .slice(0, 2);

  return (
    <div>
      <h2 className="mb-3 font-display text-[16px] font-700 text-heading">Category Intelligence</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHead title="Revenue by Category" sub="Horizontal ranking, top 10" />
          <HorizontalRanking data={sorted.slice(0, 10).map((r) => ({ label: r.dimension_value, value: r.revenue_inr ?? 0 }))} />
        </Card>
        <Card>
          <CardHead title="Category Performance Heatmap" sub="Green = strong, red = weak, normalized per column" />
          <Heatmap rows={heatmapRows} columns={heatmapCols} />
        </Card>
      </div>

      {insight.best && (
        <Card className="mt-4">
          <CardHead title="Insight" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <InsightItem label="Highest revenue" value={insight.best.dimension_value} sub={fmtInr(insight.best.revenue_inr)} />
            <InsightItem label="Highest CVR" value={insight.bestCvr?.dimension_value ?? "—"} sub={fmtPct(insight.bestCvr?.cvr)} />
            <InsightItem label="Highest RPV" value={insight.bestRpv?.dimension_value ?? "—"} sub={fmtInr(insight.bestRpv?.rpv_inr)} />
            <InsightItem label="Weakest" value={insight.worst?.dimension_value ?? "—"} sub={fmtInr(insight.worst?.revenue_inr)} tone="danger" />
          </div>
          {scalingCandidates.length > 0 && (
            <p className="mt-4 border-t border-line pt-3 text-tiny text-body">
              <span className="font-medium text-heading">Scaling potential:</span>{" "}
              {scalingCandidates.map((c) => `${c.dimension_value} (${fmtPct(c.cvr)} CVR)`).join(", ")} — high conversion relative to current revenue share.
            </p>
          )}
        </Card>
      )}
    </div>
  );
}

function InsightItem({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "danger" }) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-wide text-faint">{label}</div>
      <div className={`mt-0.5 text-[14px] font-600 ${tone === "danger" ? "text-danger-700" : "text-heading"}`}>{value}</div>
      <div className="text-micro text-muted">{sub}</div>
    </div>
  );
}
