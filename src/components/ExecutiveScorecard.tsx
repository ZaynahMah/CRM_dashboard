"use client";

import type { MonthlyKpiRow } from "@/types/performance";
import { fmtInr, fmtPct, momChange } from "@/lib/performanceAnalysis";
import { trendDirection, sortedMonths } from "@/lib/performanceInsights";
import { Card, Pill } from "./ui";
import { Icon } from "./icons";

function aggregate(rows: MonthlyKpiRow[]) {
  const visits = rows.reduce((a, r) => a + (r.visits ?? 0), 0);
  const orders = rows.reduce((a, r) => a + (r.orders ?? 0), 0);
  const revenue = rows.reduce((a, r) => a + (r.revenue_inr ?? 0), 0);
  const cvr = visits > 0 ? orders / visits : null;
  const aov = orders > 0 ? revenue / orders : null;
  const rpv = visits > 0 ? revenue / visits : null;
  return { visits, orders, revenue, cvr, aov, rpv };
}

/** Section 1 — Executive Scorecard: 6 KPI cards with MoM deltas + a computed narrative. */
export function ExecutiveScorecard({ kpi }: { kpi: MonthlyKpiRow[] }) {
  const months = sortedMonths(kpi);
  const currentMonth = months[months.length - 1];
  const previousMonth = months[months.length - 2];
  const current = aggregate(kpi.filter((r) => r.month === currentMonth));
  const previous = previousMonth ? aggregate(kpi.filter((r) => r.month === previousMonth)) : null;

  const revenueByMonth = months.map((m) => aggregate(kpi.filter((r) => r.month === m)).revenue);
  const cvrByMonth = months.map((m) => aggregate(kpi.filter((r) => r.month === m)).cvr ?? 0);
  const revenueDir = trendDirection(revenueByMonth);
  const cvrDir = trendDirection(cvrByMonth);

  const bestMonthIdx = revenueByMonth.indexOf(Math.max(...revenueByMonth));
  const worstMonthIdx = revenueByMonth.indexOf(Math.min(...revenueByMonth));

  const cards: { label: string; value: string; delta: number | null; icon: React.ReactNode }[] = [
    { label: "Total Revenue", value: fmtInr(current.revenue), delta: previous ? momChange(current.revenue, previous.revenue) : null, icon: Icon.rupee(15) },
    { label: "Total Visits", value: current.visits.toLocaleString("en-IN"), delta: previous ? momChange(current.visits, previous.visits) : null, icon: Icon.users(15) },
    { label: "Total Orders", value: current.orders.toLocaleString("en-IN"), delta: previous ? momChange(current.orders, previous.orders) : null, icon: Icon.list(15) },
    { label: "Average CVR", value: fmtPct(current.cvr), delta: previous ? momChange(current.cvr ?? 0, previous.cvr ?? 0) : null, icon: Icon.target(15) },
    { label: "Average AOV", value: fmtInr(current.aov), delta: previous ? momChange(current.aov ?? 0, previous.aov ?? 0) : null, icon: Icon.chart(15) },
    { label: "Average RPV", value: fmtInr(current.rpv), delta: previous ? momChange(current.rpv ?? 0, previous.rpv ?? 0) : null, icon: Icon.spark(15) },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {cards.map((c) => (
          <Card key={c.label} className="min-w-0">
            <div className="flex items-center gap-2 text-faint">{c.icon}<span className="truncate text-micro text-muted">{c.label}</span></div>
            <div className="mt-2.5 truncate font-display text-[20px] font-700 text-heading">{c.value}</div>
            {c.delta != null && (
              <div className={`mt-1 text-micro font-medium ${c.delta >= 0 ? "text-success-700" : "text-danger-700"}`}>
                {c.delta >= 0 ? "+" : ""}{c.delta.toFixed(1)}% MoM
              </div>
            )}
          </Card>
        ))}
      </div>

      {months.length > 0 && (
        <Card pad={false} className="overflow-hidden">
          <div className="flex items-center gap-2 border-b border-line bg-[#F9FAFB] px-4 py-2.5">
            <span className="text-indigo-600">{Icon.spark(13)}</span>
            <span className="text-tiny font-600 text-heading">Scorecard summary</span>
          </div>
          <div className="grid gap-3 px-4 py-3.5 sm:grid-cols-2">
            <div className="flex items-center gap-2">
              <Pill dot={false} label={revenueDir === "up" ? "Revenue trending up" : revenueDir === "down" ? "Revenue trending down" : "Revenue flat"}
                tone={revenueDir === "up" ? "success" : revenueDir === "down" ? "danger" : "neutral"} />
            </div>
            <div className="flex items-center gap-2">
              <Pill dot={false} label={cvrDir === "up" ? "Conversion improving" : cvrDir === "down" ? "Conversion declining" : "Conversion flat"}
                tone={cvrDir === "up" ? "success" : cvrDir === "down" ? "danger" : "neutral"} />
            </div>
            {months[bestMonthIdx] && (
              <p className="text-tiny text-body sm:col-span-2">
                <span className="font-medium text-heading">Best performing month:</span> {months[bestMonthIdx]} ({fmtInr(revenueByMonth[bestMonthIdx])} revenue)
                {months.length > 2 && months[worstMonthIdx] !== months[bestMonthIdx] && (
                  <> · <span className="font-medium text-heading">Weakest month:</span> {months[worstMonthIdx]} ({fmtInr(revenueByMonth[worstMonthIdx])})</>
                )}
              </p>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
