"use client";

import { useMemo, useState } from "react";
import { useSession } from "@/components/SessionProvider";
import { PerformanceUpload } from "@/components/PerformanceUpload";
import { TotalAnalysisPanel } from "@/components/TotalAnalysisPanel";
import { AIAnalysisCard } from "@/components/AIAnalysisCard";
import { DimensionTable } from "@/components/DimensionTable";
import { TopPnLeaderboard } from "@/components/TopPnLeaderboard";
import { LineChart } from "@/components/Charts";
import { Card, CardHead, Empty, PageHead, Pill, StatCard, StatGrid } from "@/components/ui";
import { Icon } from "@/components/icons";
import { fmtInr, fmtPct, momChange, parseMonthLabel } from "@/lib/performanceAnalysis";
import { SHEET_ORDER, SHEET_LABELS, EXPECTED_SHEETS } from "@/types/performance";
import type { MonthlyKpiRow, UploadedPerformanceData } from "@/types/performance";

export default function PerformancePage() {
  const { profile } = useSession();
  const [data, setData] = useState<UploadedPerformanceData | null>(null);

  const currentMonth = data?.currentMonth ?? null;
  const kpi = data?.monthlyKpi ?? [];
  const currentKpi = kpi.filter((r) => r.month === currentMonth);

  const previousMonthLabel = useMemo(() => {
    if (!currentMonth) return null;
    const months = [...new Set(kpi.map((r) => r.month))]
      .sort((a, b) => parseMonthLabel(a).sortKey - parseMonthLabel(b).sortKey);
    const idx = months.indexOf(currentMonth);
    return idx > 0 ? months[idx - 1] : null;
  }, [kpi, currentMonth]);
  const previousKpi = kpi.filter((r) => r.month === previousMonthLabel);

  const totalCurrent = aggregateKpi(currentKpi);
  const totalPrevious = aggregateKpi(previousKpi);

  const trendSeries = useMemo(() => {
    const byMonth = new Map<string, { visits: number; revenue: number }>();
    kpi.forEach((r) => {
      const cur = byMonth.get(r.month) ?? { visits: 0, revenue: 0 };
      cur.visits += r.visits ?? 0; cur.revenue += r.revenue_inr ?? 0;
      byMonth.set(r.month, cur);
    });
    const months = [...byMonth.keys()].sort((a, b) => parseMonthLabel(a).sortKey - parseMonthLabel(b).sortKey);
    return months.map((m) => ({ label: m, value: Math.round((byMonth.get(m)?.revenue ?? 0) / 100000) }));
  }, [kpi]);

  const tableSummaries = useMemo(() => SHEET_ORDER.map((key) => {
    const rows = (data?.dimensions[key] ?? []).filter((r) => r.month === currentMonth);
    const sorted = [...rows].sort((a, b) => (b.revenue_inr ?? 0) - (a.revenue_inr ?? 0));
    return { table: SHEET_LABELS[key].title, top3: sorted.slice(0, 3), bottom3: sorted.slice(-3).reverse() };
  }), [data, currentMonth]);

  if (!profile) return null;
  if (profile.role !== "CRM" && profile.role !== "EXECUTIVE") {
    return <Card><Empty title="Not available" hint="The Performance view is available to CRM and Executive accounts." /></Card>;
  }

  const missingSheets = data ? EXPECTED_SHEETS.filter((s) => !data.sheetsFound.some((f) => f.toLowerCase() === s.toLowerCase())) : [];
  const hasAnyData = data && (kpi.length > 0 || Object.values(data.dimensions).some((v) => (v?.length ?? 0) > 0));

  return (
    <div className="space-y-6">
      <PageHead title="Performance" />

      {profile.role === "CRM" && <PerformanceUpload onParsed={setData} />}

      {data && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-tiny text-muted">
              <span className="font-medium text-heading">Loaded:</span> {data.filename} ·{" "}
              {new Date(data.uploadedAt).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })}
              {data.currentMonth && <> · month detected: <span className="font-medium text-heading">{data.currentMonth}</span></>}
            </div>
            <Pill label={`${data.sheetsFound.length} of ${EXPECTED_SHEETS.length} sheets found`}
              tone={missingSheets.length === 0 ? "success" : "warning"} />
          </div>
          {missingSheets.length > 0 && (
            <p className="mt-2 text-micro text-warning-700">
              Not found in this file: {missingSheets.join(", ")} — check these sheet names match exactly.
            </p>
          )}
        </Card>
      )}

      {!hasAnyData ? (
        <Card>
          <Empty title="No performance data loaded"
            hint={profile.role === "CRM"
              ? "Upload this month's .xlsx report above to build out every card, chart and AI analysis on this page."
              : "Ask CRM to upload this month's report — this view is populated in their browser tab and isn't shared automatically."} />
        </Card>
      ) : (
        <>
          {currentMonth && (
            <TotalAnalysisPanel month={currentMonth} tableSummaries={tableSummaries} lastMonthFocuses={[]} />
          )}

          {currentKpi.length > 0 && (
            <StatGrid>
              <StatCard label="Revenue" value={fmtInr(totalCurrent.revenue)} tone="indigo" icon={Icon.rupee(14)}
                delta={deltaLabel(momChange(totalCurrent.revenue, totalPrevious.revenue))} />
              <StatCard label="Orders" value={totalCurrent.orders.toLocaleString("en-IN")} tone="info" icon={Icon.list(14)}
                delta={deltaLabel(momChange(totalCurrent.orders, totalPrevious.orders))} />
              <StatCard label="CVR" value={fmtPct(totalCurrent.cvr)} tone="success" icon={Icon.target(14)}
                delta={deltaLabel(momChange(totalCurrent.cvr, totalPrevious.cvr))} />
              <StatCard label="RPV" value={fmtInr(totalCurrent.rpv)} tone="warning" icon={Icon.chart(14)}
                delta={deltaLabel(momChange(totalCurrent.rpv, totalPrevious.rpv))} />
            </StatGrid>
          )}

          {trendSeries.length > 1 && (
            <Card>
              <CardHead title="Revenue trend" sub="₹ Lakhs, by month — from the Monthly_KPI sheet's own history" />
              <LineChart data={trendSeries} />
            </Card>
          )}

          <TopPnLeaderboard rows={data?.topPn ?? []} />

          {SHEET_ORDER.map((key) => {
            const allRows = data?.dimensions[key] ?? [];
            const rowsThisMonth = currentMonth ? allRows.filter((r) => r.month === currentMonth) : allRows;
            return (
              <div key={key} className="space-y-3">
                <DimensionTable title={SHEET_LABELS[key].title} dimensionLabel={SHEET_LABELS[key].column} rows={rowsThisMonth} />
                {currentMonth && (
                  <AIAnalysisCard
                    sheetKey={key} sheetTitle={SHEET_LABELS[key].title} month={currentMonth}
                    currentRows={rowsThisMonth} historyRows={allRows}
                  />
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

function aggregateKpi(rows: MonthlyKpiRow[]) {
  const visits = rows.reduce((a, r) => a + (r.visits ?? 0), 0);
  const orders = rows.reduce((a, r) => a + (r.orders ?? 0), 0);
  const revenue = rows.reduce((a, r) => a + (r.revenue_inr ?? 0), 0);
  const cvr = visits > 0 ? orders / visits : null;
  const rpv = visits > 0 ? revenue / visits : null;
  return { visits, orders, revenue, cvr, rpv };
}

function deltaLabel(pct: number | null): string | undefined {
  if (pct == null) return undefined;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}% MoM`;
}
