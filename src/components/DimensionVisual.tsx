"use client";

import type { DimensionRow } from "@/types/performance";
import { fmtInr } from "@/lib/performanceAnalysis";
import { BarChart, PieChart } from "./Charts";
import { Card, CardHead, Empty } from "./ui";

/** The primary visual for one dimension sheet: ranked bar + revenue-share pie, side by side. */
export function DimensionVisual({ title, dimensionLabel, rows }: {
  title: string; dimensionLabel: string; rows: DimensionRow[];
}) {
  if (rows.length === 0) {
    return <Card><Empty title={`No ${title} data`} hint="Upload this month's report to populate this view." /></Card>;
  }

  const sorted = [...rows].sort((a, b) => (b.revenue_inr ?? 0) - (a.revenue_inr ?? 0));
  const top = sorted.slice(0, 10);
  const barData = top.map((r) => ({ label: r.dimension_value, value: r.revenue_inr ?? 0 }));
  const pieData = top.slice(0, 6).map((r) => ({ label: r.dimension_value, value: r.revenue_inr ?? 0 }));

  return (
    <Card>
      <CardHead title={title} sub={`Ranked by revenue · ${rows.length} ${dimensionLabel.toLowerCase()}${rows.length === 1 ? "" : "s"}`} />
      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <BarChart data={barData} height={180} valueFormat={fmtInr} />
        <PieChart data={pieData} valueFormat={fmtInr} />
      </div>
    </Card>
  );
}
