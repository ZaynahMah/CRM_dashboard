"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "@/components/SessionProvider";
import { PerformanceUpload } from "@/components/PerformanceUpload";
import { TotalAnalysisPanel } from "@/components/TotalAnalysisPanel";
import { AIAnalysisCard } from "@/components/AIAnalysisCard";
import { DimensionTable } from "@/components/DimensionTable";
import { TopPnLeaderboard } from "@/components/TopPnLeaderboard";
import { LineChart } from "@/components/Charts";
import { Button, Card, CardHead, Empty, Loading, PageHead, StatCard, StatGrid } from "@/components/ui";
import { Icon } from "@/components/icons";
import {
  listMonthlyKpi, listDimensionHistory, listTopPn, lastUpload,
} from "@/services/performanceData";
import { fmtInr, fmtPct, momChange, parseMonthLabel } from "@/lib/performanceAnalysis";
import { SHEET_ORDER, SHEET_LABELS } from "@/types/performance";
import type { DimensionRow, MonthlyKpiRow, TopPnRow, UploadRecord, SheetKey } from "@/types/performance";

export default function PerformancePage() {
  const { profile } = useSession();
  const [kpi, setKpi] = useState<MonthlyKpiRow[]>([]);
  const [dimensionData, setDimensionData] = useState<Partial<Record<SheetKey, DimensionRow[]>>>({});
  const [topPn, setTopPn] = useState<TopPnRow[]>([]);
  const [upload, setUpload] = useState<UploadRecord | null>(null);
  const [loading, setLoading] = useState(true);

  const loadAll = async () => {
    setLoading(true);
    const [kpiRows, topRows, uploadRow, ...dims] = await Promise.all([
      listMonthlyKpi(), listTopPn(), lastUpload(),
      ...SHEET_ORDER.map((k) => listDimensionHistory(k)),
    ]);
    setKpi(kpiRows); setTopPn(topRows); setUpload(uploadRow);
    const dimMap: Partial<Record<SheetKey, DimensionRow[]>> = {};
    SHEET_ORDER.forEach((k, i) => { dimMap[k] = dims[i]; });
    setDimensionData(dimMap);
    setLoading(false);
  };

  useEffect(() => { loadAll(); }, []);

  const currentMonth = useMemo(() => {
    if (upload?.month) return upload.month;
    return kpi.length ? kpi[kpi.length - 1].month : null;
  }, [upload, kpi]);

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

  // Per-table summaries for the Total Analysis panel's cross-cutting prompt.
  const tableSummaries = useMemo(() => SHEET_ORDER.map((key) => {
    const rows = (dimensionData[key] ?? []).filter((r) => r.month === currentMonth);
    const sorted = [...rows].sort((a, b) => (b.revenue_inr ?? 0) - (a.revenue_inr ?? 0));
    return {
      table: SHEET_LABELS[key].title,
      top3: sorted.slice(0, 3),
      bottom3: sorted.slice(-3).reverse(),
    };
  }), [dimensionData, currentMonth]);

  if (!profile) return null;
  if (profile.role !== "CRM" && profile.role !== "EXECUTIVE") {
    return <Card><Empty title="Not available" hint="The Performance view is available to CRM and Executive accounts." /></Card>;
  }
  if (loading) return <Loading label="Loading performance data" />;

  const hasAnyData = kpi.length > 0 || Object.values(dimensionData).some((v) => (v?.length ?? 0) > 0);

  return (
    <div className="space-y-6">
      <PageHead
        eyebrow="Monthly report · Prototype, dummy data"
        title="Performance"
        sub={upload ? `Last updated ${new Date(upload.uploaded_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} from ${upload.filename}` : "Upload a monthly report to populate this view."}
      />

      {profile.role === "CRM" && <PerformanceUpload profileId={profile.id} onDone={loadAll} />}

      {!hasAnyData ? (
        <Card><Empty title="No performance data yet" hint="Upload this month's .xlsx report above to build out every card, chart and AI analysis on this page." /></Card>
      ) : (
        <>
          {currentMonth && (
            <TotalAnalysisPanel month={currentMonth} tableSummaries={tableSummaries} lastMonthFocuses={[]} />
          )}

          {/* Executive KPI strip */}
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

          {/* Revenue trend */}
          {trendSeries.length > 1 && (
            <Card>
              <CardHead title="Revenue trend" sub="₹ Lakhs, by month, across all uploaded history" />
              <LineChart data={trendSeries} />
            </Card>
          )}

          {/* Top 10 PN leaderboard */}
          <TopPnLeaderboard rows={topPn} />

          {/* Per-table sections: table + chart, then its AI Analysis card right below */}
          {SHEET_ORDER.map((key) => {
            const allRows = dimensionData[key] ?? [];
            const rowsThisMonth = currentMonth ? allRows.filter((r) => r.month === currentMonth) : [];
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
