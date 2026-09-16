"use client";

import type { DimensionRow } from "@/types/performance";
import { fmtInr, fmtPct } from "@/lib/performanceAnalysis";
import { BarChart } from "./Charts";
import { Card, CardHead, TableCard, Empty } from "./ui";

/** One dimension table + its comparative bar chart — reused for all 7 identically-shaped sheets. */
export function DimensionTable({ title, dimensionLabel, rows }: {
  title: string; dimensionLabel: string; rows: DimensionRow[];
}) {
  if (rows.length === 0) {
    return <Card><Empty title={`No ${title} data`} hint="Upload this month's report to populate this table." /></Card>;
  }

  const sorted = [...rows].sort((a, b) => (b.revenue_inr ?? 0) - (a.revenue_inr ?? 0));
  const chartData = sorted.slice(0, 10).map((r) => ({ label: r.dimension_value, value: r.revenue_inr ?? 0 }));

  return (
    <Card>
      <CardHead title={title} sub={`Ranked by revenue · ${rows.length} ${dimensionLabel.toLowerCase()}${rows.length === 1 ? "" : "s"}`} />
      <BarChart data={chartData} height={160} />
      <div className="mt-4 overflow-x-auto rounded-lg border border-line">
        <table>
          <thead>
            <tr>
              <th>{dimensionLabel}</th><th className="text-right">Visits</th><th className="text-right">Orders</th>
              <th className="text-right">Revenue</th><th className="text-right">CVR</th>
              <th className="text-right">AOV</th><th className="text-right">RPV</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.id}>
                <td className="font-medium text-heading">{r.dimension_value}</td>
                <td className="text-right text-muted">{r.visits?.toLocaleString("en-IN") ?? "—"}</td>
                <td className="text-right text-muted">{r.orders?.toLocaleString("en-IN") ?? "—"}</td>
                <td className="text-right font-medium text-heading">{fmtInr(r.revenue_inr)}</td>
                <td className="text-right text-muted">{fmtPct(r.cvr)}</td>
                <td className="text-right text-muted">{fmtInr(r.aov_inr)}</td>
                <td className="text-right text-muted">{fmtInr(r.rpv_inr)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
