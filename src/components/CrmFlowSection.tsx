"use client";

import type { DimensionRow } from "@/types/performance";
import { HorizontalRanking } from "./ChartsAdvanced";
import { rankByRevenue } from "@/lib/performanceInsights";
import { fmtInr, fmtPct } from "@/lib/performanceAnalysis";
import { Card, CardHead } from "./ui";

/** Section 5 — CRM Flow Performance: which remarketing flows actually drive revenue. */
export function CrmFlowSection({ rows }: { rows: DimensionRow[] }) {
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => (b.revenue_inr ?? 0) - (a.revenue_inr ?? 0));
  const insight = rankByRevenue(rows);

  return (
    <div>
      <h2 className="mb-3 font-display text-[16px] font-700 text-heading">CRM Flow Performance</h2>
      <Card>
        <CardHead title="Revenue by Remarketing Flow" sub="Ranked, top 10" />
        <HorizontalRanking data={sorted.slice(0, 10).map((r) => ({ label: r.dimension_value, value: r.revenue_inr ?? 0, sublabel: fmtPct(r.cvr) }))} />
        {insight.best && (
          <p className="mt-4 border-t border-line pt-3 text-tiny text-body">
            <span className="font-medium text-heading">{insight.best.dimension_value}</span> leads with {fmtInr(insight.best.revenue_inr)} in revenue at {fmtPct(insight.best.cvr)} CVR.
            {insight.worst && insight.worst.dimension_value !== insight.best.dimension_value && (
              <> <span className="font-medium text-heading">{insight.worst.dimension_value}</span> trails at {fmtInr(insight.worst.revenue_inr)} — worth reviewing whether it's under-triggered or genuinely low-intent.</>
            )}
          </p>
        )}
      </Card>
    </div>
  );
}
