"use client";

import { useState } from "react";
import type { DimensionRow } from "@/types/performance";
import { HorizontalRanking, ScatterPlot } from "./ChartsAdvanced";
import { classifyCohort, median, rankByRevenue, type CohortClass } from "@/lib/performanceInsights";
import { fmtInr, fmtPct } from "@/lib/performanceAnalysis";
import { Card, CardHead, Pill, Tabs } from "./ui";

const CLASS_TONE: Record<CohortClass, "success" | "info" | "warning" | "neutral"> = {
  SCALE: "success", MAINTAIN: "info", RECOVER: "warning", DEPRIORITIZE: "neutral",
};
const CLASS_LABEL: Record<CohortClass, string> = {
  SCALE: "Scale", MAINTAIN: "Maintain", RECOVER: "Recover", DEPRIORITIZE: "Deprioritize",
};

/** Section 6 — Customer Intelligence: Segment ranking + Cohort classification. */
export function CustomerIntelligence({ segments, cohorts }: { segments: DimensionRow[]; cohorts: DimensionRow[] }) {
  const [tab, setTab] = useState("segments");
  if (segments.length === 0 && cohorts.length === 0) return null;

  const segSorted = [...segments].sort((a, b) => (b.revenue_inr ?? 0) - (a.revenue_inr ?? 0));
  const segInsight = rankByRevenue(segments);

  const medCvr = median(cohorts.map((c) => c.cvr ?? 0));
  const medRevenue = median(cohorts.map((c) => c.revenue_inr ?? 0));
  const classified = cohorts.map((c) => ({ row: c, cls: classifyCohort(c, medCvr, medRevenue) }));

  return (
    <div>
      <h2 className="mb-3 font-display text-[16px] font-700 text-heading">Customer Intelligence</h2>
      <Card pad={false}>
        <div className="px-5 pt-4">
          <Tabs active={tab} onChange={setTab} tabs={[
            { key: "segments", label: "Segments", count: segments.length },
            { key: "cohorts", label: "Cohorts", count: cohorts.length },
          ]} />
        </div>

        {tab === "segments" && segments.length > 0 && (
          <div className="p-5">
            <HorizontalRanking data={segSorted.slice(0, 10).map((r) => ({ label: r.dimension_value, value: r.revenue_inr ?? 0, sublabel: fmtPct(r.cvr) }))} />
            {segInsight.best && (
              <p className="mt-4 border-t border-line pt-3 text-tiny text-body">
                <span className="font-medium text-heading">{segInsight.best.dimension_value}</span> is the strongest segment at {fmtInr(segInsight.best.revenue_inr)},
                {segInsight.bestCvr && <> while <span className="font-medium text-heading">{segInsight.bestCvr.dimension_value}</span> converts best at {fmtPct(segInsight.bestCvr.cvr)}.</>}
              </p>
            )}
          </div>
        )}

        {tab === "cohorts" && cohorts.length > 0 && (
          <div className="p-5">
            <ScatterPlot
              data={cohorts.map((c) => ({ label: c.dimension_value, x: c.cvr ?? 0, y: c.revenue_inr ?? 0 }))}
              xLabel="CVR" yLabel="Revenue" xFormat={(v) => fmtPct(v)} yFormat={fmtInr}
            />
            <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3">
              {classified.map(({ row, cls }) => (
                <span key={row.dimension_value} className="flex items-center gap-1.5">
                  <Pill dot={false} label={row.dimension_value} tone={CLASS_TONE[cls]} />
                  <span className="text-[9px] text-faint">{CLASS_LABEL[cls]}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
