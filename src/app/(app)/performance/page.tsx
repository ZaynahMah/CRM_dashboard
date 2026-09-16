"use client";

import { useMemo, useState } from "react";
import { useSession } from "@/components/SessionProvider";
import { PerformanceUpload } from "@/components/PerformanceUpload";
import { TotalAnalysisPanel } from "@/components/TotalAnalysisPanel";
import { AIAnalysisCard } from "@/components/AIAnalysisCard";
import { DimensionVisual } from "@/components/DimensionVisual";
import { DimensionTable } from "@/components/DimensionTable";
import { TopPnLeaderboard } from "@/components/TopPnLeaderboard";
import { LineChart, BubbleChart } from "@/components/Charts";
import { Card, CardHead, Empty, PageHead, Pill, StatCard, StatGrid } from "@/components/ui";
import { Icon } from "@/components/icons";
import { fmtInr, fmtPct, momChange, parseMonthLabel } from "@/lib/performanceAnalysis";
import { SHEET_ORDER, SHEET_LABELS, EXPECTED_SHEETS } from "@/types/performance";
import type { DimensionRow, MonthlyKpiRow, UploadedPerformanceData } from "@/types/performance";

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

  // A bubble view across whichever dimension sheet has the most data this
  // month — Visits x Revenue, bubble size = Orders. Picked dynamically
  // rather than hardcoded to one sheet, since any month's file might have
  // richer data in a different table.
  const bubbleSource = useMemo(() => {
    let bestKey: (typeof SHEET_ORDER)[number] | null = null;
    let bestRows: DimensionRow[] = [];
    for (const key of SHEET_ORDER) {
      const rows = (data?.dimensions[key] ?? []).filter((r) => r.month === currentMonth);
      if (rows.length > bestRows.length) { bestKey = key; bestRows = rows; }
    }
    return bestKey && bestRows.length > 0 ? { title: SHEET_LABELS[bestKey].title, rows: bestRows } : null;
  }, [data, currentMonth]);

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
              ? "Upload this month's .xlsx report above to build out every visualization and insight on this page."
              : "Ask CRM to upload this month's report — this view is populated in their browser tab and isn't shared automatically."} />
        </Card>
      ) : (
        <>
          {/* ── 1. KPI cards ── */}
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

          {/* ── 2. Revenue trend — line chart with hover tooltips ── */}
          {trendSeries.length > 1 && (
            <Card>
              <CardHead title="Revenue trend" sub="₹ Lakhs, by month — hover any point for the exact figure" />
              <LineChart data={trendSeries} valueFormat={(v) => `₹${v}L`} />
            </Card>
          )}

          {/* ── 3. Bubble view — three metrics at once, whichever table has the richest data this month ── */}
          {bubbleSource && (
            <Card>
              <CardHead title={`${bubbleSource.title} — Visits vs Revenue vs Orders`}
                sub="Bubble size = orders. Hover any bubble for the exact numbers." />
              <BubbleChart
                data={bubbleSource.rows.map((r) => ({
                  label: r.dimension_value, x: r.visits ?? 0, y: r.revenue_inr ?? 0, size: r.orders ?? 0,
                }))}
                xLabel="Visits" yLabel="Revenue"
                valueFormat={{ x: (v) => v.toLocaleString("en-IN"), y: fmtInr, size: (v) => `${v.toLocaleString("en-IN")} orders` }}
              />
            </Card>
          )}

          {/* ── 4. Top 10 PN leaderboard ── */}
          <TopPnLeaderboard rows={data?.topPn ?? []} />

          {/* ── 5. Per-dimension: visual first, insight right after, compact table lower ── */}
          {SHEET_ORDER.map((key) => {
            const allRows = data?.dimensions[key] ?? [];
            const rowsThisMonth = currentMonth ? allRows.filter((r) => r.month === currentMonth) : allRows;
            if (rowsThisMonth.length === 0) return null;
            return (
              <div key={key} className="space-y-3">
                <DimensionVisual title={SHEET_LABELS[key].title} dimensionLabel={SHEET_LABELS[key].column} rows={rowsThisMonth} />
                {currentMonth && (
                  <AIAnalysisCard
                    sheetKey={key} sheetTitle={SHEET_LABELS[key].title} month={currentMonth}
                    currentRows={rowsThisMonth} historyRows={allRows}
                  />
                )}
                <DimensionTable rows={rowsThisMonth} />
              </div>
            );
          })}

          {/* ── 6. Overall AI Summary — the very last thing on the page ── */}
          {currentMonth && (
            <TotalAnalysisPanel month={currentMonth} tableSummaries={tableSummaries} lastMonthFocuses={[]} />
          )}
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
