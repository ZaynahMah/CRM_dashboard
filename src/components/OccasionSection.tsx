"use client";

import type { DimensionRow } from "@/types/performance";
import { RadarChart, HorizontalRanking } from "./ChartsAdvanced";
import { rankByRevenue } from "@/lib/performanceInsights";
import { fmtInr, fmtPct } from "@/lib/performanceAnalysis";
import { Card, CardHead } from "./ui";

/** Section 8 — Occasion Performance: multi-metric radar + revenue ranking. */
export function OccasionSection({ rows }: { rows: DimensionRow[] }) {
  if (rows.length === 0) return null;
  const top = [...rows].sort((a, b) => (b.revenue_inr ?? 0) - (a.revenue_inr ?? 0)).slice(0, 6);
  const insight = rankByRevenue(rows);

  const maxRevenue = Math.max(...top.map((r) => r.revenue_inr ?? 0), 1);
  const maxCvr = Math.max(...top.map((r) => r.cvr ?? 0), 0.0001);
  const maxRpv = Math.max(...top.map((r) => r.rpv_inr ?? 0), 1);

  return (
    <div>
      <h2 className="mb-3 font-display text-[16px] font-700 text-heading">Occasion Performance</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHead title="Revenue / CVR / RPV by Occasion" sub="Normalized, top 6 occasions" />
          <RadarChart
            axes={top.map((r) => r.dimension_value)}
            series={[
              { name: "Revenue", color: "#6438E8", values: top.map((r) => (r.revenue_inr ?? 0) / maxRevenue) },
              { name: "CVR", color: "#12B76A", values: top.map((r) => (r.cvr ?? 0) / maxCvr) },
              { name: "RPV", color: "#F79009", values: top.map((r) => (r.rpv_inr ?? 0) / maxRpv) },
            ]}
          />
        </Card>
        <Card>
          <CardHead title="Revenue by Occasion" sub="Ranked" />
          <HorizontalRanking data={top.map((r) => ({ label: r.dimension_value, value: r.revenue_inr ?? 0 }))} />
        </Card>
      </div>
      {insight.best && (
        <Card className="mt-4">
          <div className="text-tiny text-body">
            <span className="font-medium text-heading">Business question:</span> {insight.best.dimension_value} drives {fmtInr(insight.best.revenue_inr)} in revenue
            at {fmtPct(insight.best.cvr)} CVR. Are occasion-specific creatives being planned far enough ahead to capture this consistently, or is it reactive?
          </div>
        </Card>
      )}
    </div>
  );
}
