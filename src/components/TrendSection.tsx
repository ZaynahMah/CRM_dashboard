"use client";

import type { MonthlyKpiRow } from "@/types/performance";
import { LineChart } from "./Charts";
import { lineChartInsight, sortedMonths } from "@/lib/performanceInsights";
import { fmtInr, fmtPct } from "@/lib/performanceAnalysis";
import { Card, CardHead, Pill } from "./ui";

/** Section 3 — Business Performance Trends: Revenue / Orders / CVR by month. */
export function TrendSection({ kpi }: { kpi: MonthlyKpiRow[] }) {
  const months = sortedMonths(kpi);
  if (months.length < 2) return null;

  const byMonth = (fn: (r: MonthlyKpiRow[]) => number) =>
    months.map((m) => ({ label: m, value: fn(kpi.filter((r) => r.month === m)) }));

  const revenueSeries = byMonth((rows) => rows.reduce((a, r) => a + (r.revenue_inr ?? 0), 0));
  const ordersSeries = byMonth((rows) => rows.reduce((a, r) => a + (r.orders ?? 0), 0));
  const cvrSeries = byMonth((rows) => {
    const visits = rows.reduce((a, r) => a + (r.visits ?? 0), 0);
    const orders = rows.reduce((a, r) => a + (r.orders ?? 0), 0);
    return visits > 0 ? orders / visits : 0;
  });

  const charts = [
    { title: "Revenue Trend by Month", series: revenueSeries, fmt: fmtInr, insight: lineChartInsight(revenueSeries) },
    { title: "Orders Trend by Month", series: ordersSeries, fmt: (v: number) => v.toLocaleString("en-IN"), insight: lineChartInsight(ordersSeries) },
    { title: "CVR Trend by Month", series: cvrSeries, fmt: (v: number) => fmtPct(v), insight: lineChartInsight(cvrSeries) },
  ];

  return (
    <div>
      <h2 className="mb-3 font-display text-[16px] font-700 text-heading">Business Performance Trends</h2>
      <div className="grid gap-4 lg:grid-cols-3">
        {charts.map((c) => (
          <Card key={c.title}>
            <CardHead title={c.title} />
            <LineChart data={c.series} valueFormat={c.fmt} />
            {c.insight && (
              <div className="mt-4 space-y-1.5 border-t border-line pt-3 text-tiny">
                <div className="flex justify-between"><span className="text-muted">Highest</span><span className="font-medium text-heading">{c.insight.highestMonth} · {c.fmt(c.insight.highestValue)}</span></div>
                <div className="flex justify-between"><span className="text-muted">Lowest</span><span className="font-medium text-heading">{c.insight.lowestMonth} · {c.fmt(c.insight.lowestValue)}</span></div>
                <div className="flex items-center justify-between">
                  <span className="text-muted">Trend</span>
                  <Pill dot={false} label={c.insight.direction === "up" ? "Upward" : c.insight.direction === "down" ? "Downward" : "Flat"}
                    tone={c.insight.direction === "up" ? "success" : c.insight.direction === "down" ? "danger" : "neutral"} />
                </div>
                <p className="pt-1 text-micro text-faint">{c.insight.notableChange}</p>
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
