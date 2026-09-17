"use client";

import type { DimensionRow } from "@/types/performance";
import { HorizontalRanking, ScatterPlot } from "./ChartsAdvanced";
import { rankByRevenue } from "@/lib/performanceInsights";
import { fmtInr, fmtPct } from "@/lib/performanceAnalysis";
import { Card, CardHead } from "./ui";

/** Section 7 — PN Type Performance: which push formats convert, and at what volume. */
export function PnTypeSection({ rows }: { rows: DimensionRow[] }) {
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => (b.revenue_inr ?? 0) - (a.revenue_inr ?? 0));
  const insight = rankByRevenue(rows);
  const highVolumeLowCvr = rows.filter((r) => (r.visits ?? 0) > 0)
    .sort((a, b) => (b.visits ?? 0) - (a.visits ?? 0))
    .find((r) => insight.bestCvr && (r.cvr ?? 0) < (insight.bestCvr.cvr ?? 0) * 0.6);

  return (
    <div>
      <h2 className="mb-3 font-display text-[16px] font-700 text-heading">PN Type Performance</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHead title="Revenue by PN Type" sub="Ranked" />
          <HorizontalRanking data={sorted.map((r) => ({ label: r.dimension_value, value: r.revenue_inr ?? 0 }))} />
        </Card>
        <Card>
          <CardHead title="Revenue vs CVR" sub="Which formats convert well at scale" />
          <ScatterPlot data={rows.map((r) => ({ label: r.dimension_value, x: r.cvr ?? 0, y: r.revenue_inr ?? 0 }))}
            xLabel="CVR" yLabel="Revenue" xFormat={fmtPct} yFormat={fmtInr} />
        </Card>
      </div>
      {highVolumeLowCvr && (
        <Card className="mt-4">
          <div className="text-tiny text-body">
            <span className="font-medium text-heading">Business question:</span> {highVolumeLowCvr.dimension_value} carries{" "}
            {highVolumeLowCvr.visits?.toLocaleString("en-IN")} visits but only {fmtPct(highVolumeLowCvr.cvr)} CVR — well below{" "}
            {insight.bestCvr?.dimension_value}'s {fmtPct(insight.bestCvr?.cvr)}. Is this format being over-used relative to what it actually converts?
          </div>
        </Card>
      )}
    </div>
  );
}
