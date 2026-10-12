"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "@/components/SessionProvider";
import { PerformanceUpload } from "@/components/PerformanceUpload";
import { ExecutiveScorecard } from "@/components/ExecutiveScorecard";
import { TotalAnalysisPanel } from "@/components/TotalAnalysisPanel";
import { TrendSection } from "@/components/TrendSection";
import { CategoryIntelligence } from "@/components/CategoryIntelligence";
import { CrmFlowSection } from "@/components/CrmFlowSection";
import { CustomerIntelligence } from "@/components/CustomerIntelligence";
import { PnTypeSection } from "@/components/PnTypeSection";
import { OpportunityMatrix } from "@/components/OpportunityMatrix";
import { TopLeaderboard } from "@/components/TopLeaderboard";
import { Card, Empty, PageHead, Pill } from "@/components/ui";
import { SHEET_LABELS, SHEET_ORDER, EXPECTED_SHEETS } from "@/types/performance";
import { PerformanceReportMeta } from "@/components/PerformanceReportMeta";
import { PerformanceReportHistory } from "@/components/PerformanceReportHistory";
import { loadCurrentReport, listReports, type ReportSummary } from "@/services/performanceReports";
import type { UploadedPerformanceData } from "@/types/performance";

export default function PerformancePage() {
  const { profile } = useSession();
  /**
   * The report now LOADS FROM THE DATABASE. It used to live only in this
   * state, so a refresh, a logout, a new deploy or a second Executive lost
   * it. The metrics are read back already parsed — the workbook is never
   * reparsed on a page load.
   */
  const [data, setData] = useState<UploadedPerformanceData | null>(null);
  const [report, setReport] = useState<ReportSummary | null>(null);
  const [history, setHistory] = useState<ReportSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [setupMsg, setSetupMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setSetupMsg(null);
    try {
      const [current, all] = await Promise.all([loadCurrentReport(), listReports()]);
      setData(current?.data ?? null);
      setReport(current?.report ?? null);
      setHistory(all);
    } catch (e) {
      // Migration 23 or the storage bucket missing: say so plainly instead
      // of showing an empty dashboard that looks like missing data.
      setSetupMsg(e instanceof Error ? e.message : String(e));
      setData(null); setReport(null); setHistory([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const currentMonth = data?.currentMonth ?? null;

  const currentDimensions = useMemo(() => {
    if (!data) return {};
    const out: typeof data.dimensions = {};
    for (const key of SHEET_ORDER) {
      out[key] = (data.dimensions[key] ?? []).filter((r) => r.month === currentMonth);
    }
    return out;
  }, [data, currentMonth]);

  const tableSummaries = useMemo(() => SHEET_ORDER.map((key) => {
    const rows = currentDimensions[key] ?? [];
    const sorted = [...rows].sort((a, b) => (b.revenue_inr ?? 0) - (a.revenue_inr ?? 0));
    return { table: SHEET_LABELS[key].title, top3: sorted.slice(0, 3), bottom3: sorted.slice(-3).reverse() };
  }), [currentDimensions]);

  if (!profile) return null;
  if (profile.role !== "CRM" && profile.role !== "EXECUTIVE") {
    return <Card><Empty title="Not available" hint="The Performance view is available to CRM and Executive accounts." /></Card>;
  }
  // Only EXECUTIVE may upload or restore; everyone with access may view.
  const canUpload = profile.role === "EXECUTIVE";

  const missingSheets = data ? EXPECTED_SHEETS.filter((s) => !data.sheetsFound.some((f) => f.toLowerCase() === s.toLowerCase())) : [];
  const hasAnyData = data && (data.monthlyKpi.length > 0 || Object.values(data.dimensions).some((v) => (v?.length ?? 0) > 0));

  return (
    <div className="space-y-8">
      <PageHead title="Performance" sub="Executive business intelligence — visual first, tables only where they earn their place." />

      {canUpload && <PerformanceUpload profileId={profile.id} onUploaded={load} />}

      {setupMsg && (
        <Card><p className="text-tiny text-warning-700">{setupMsg}</p></Card>
      )}

      {report && <PerformanceReportMeta report={report} />}

      <PerformanceReportHistory reports={history} canManage={canUpload} onChanged={load} />

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
            <p className="mt-2 text-micro text-warning-700">Not found in this file: {missingSheets.join(", ")}</p>
          )}
        </Card>
      )}

      {!hasAnyData ? (
        <Card>
          <Empty title="No performance data loaded"
            hint={canUpload
              ? "Upload this month's .xlsx report above. It is stored permanently, so it stays after a refresh, a logout or a new deploy, and every role sees the same figures."
              : loading
                ? "Loading the latest stored report..."
                : "No report has been uploaded yet. An Executive account uploads it, and it is then visible to everyone."} />
        </Card>
      ) : (
        <>
          {/* 1 — Executive Scorecard */}
          <ExecutiveScorecard kpi={data!.monthlyKpi} />

          {/* 2 — Executive AI Summary */}
          {currentMonth && <TotalAnalysisPanel month={currentMonth} tableSummaries={tableSummaries} lastMonthFocuses={[]} />}

          {/* 3 — Business Performance Trends */}
          <TrendSection kpi={data!.monthlyKpi} />

          {/* 4 — Category Intelligence */}
          <CategoryIntelligence rows={currentDimensions.category ?? []} />

          {/* 5 — CRM Flow Performance */}
          <CrmFlowSection rows={currentDimensions.remarketing_flow ?? []} />

          {/* 6 — Customer Intelligence (Segments + Cohorts) */}
          <CustomerIntelligence segments={currentDimensions.segment ?? []} cohorts={currentDimensions.cohort ?? []} />

          {/* 7 — PN Type Performance */}
          <PnTypeSection rows={currentDimensions.pn_type ?? []} />

          {/* 8 — Opportunity Matrix */}
          <OpportunityMatrix dimensions={currentDimensions} />

          {/* 9 — Top Campaign Leaderboard */}
          <TopLeaderboard rows={data!.topPn} />
        </>
      )}
    </div>
  );
}
