"use client";

import type { Campaign } from "@/types/campaign";
import { stageOf, STAGE_LABEL, STAGE_ORDER } from "@/lib/workflow";

/**
 * A real funnel — the count of campaigns actually sitting in each stage
 * right now, derived stage-by-stage from real Supabase data. No thresholds,
 * no percentages, no dependence on the current date or days elapsed in a
 * month. Zero campaigns means every number here is exactly zero.
 */
export function MonthlyProgressBar({ campaigns }: { campaigns: Campaign[] }) {
  const counts = STAGE_ORDER.map((stage) => ({
    stage,
    count: campaigns.filter((c) => stageOf(c) === stage).length,
  }));
  const total = campaigns.length;

  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3.5 shadow-card">
      <div className="mb-2.5 flex items-center justify-between">
        <span className="text-[10px] font-600 uppercase tracking-wider text-faint">Workflow funnel</span>
        <span className="text-[10px] font-600 text-heading">{total} total campaign{total === 1 ? "" : "s"}</span>
      </div>

      {total === 0 ? (
        <p className="py-2 text-tiny text-muted">No campaigns yet — every stage is at zero until CRM uploads real data.</p>
      ) : (
        <div className="flex items-stretch gap-1">
          {counts.map(({ stage, count }) => (
            <div key={stage} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
              <div className={`flex h-9 w-full items-center justify-center rounded-lg text-[13px] font-700 ${
                count > 0 ? "bg-indigo-50 text-indigo-700" : "bg-[#F9FAFB] text-faint"}`}>
                {count}
              </div>
              <span className="text-center text-[9px] font-600 leading-tight text-faint">{STAGE_LABEL[stage]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
