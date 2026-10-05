"use client";

import type { Campaign } from "@/types/campaign";
import { stageOf, STAGE_LABEL, STAGE_ORDER, type Stage } from "@/lib/workflow";

/** Which team owns each stage — this is what makes it a flowchart of the
 * actual handoff, not just a row of numbers. */
const STAGE_TEAM: Record<Stage, string> = {
  AWAITING_CATEGORY: "CRM",
  CATEGORY_SUBMITTED: "Category",
  CRM_REVIEW: "CRM",
  CRM_PROCESSING: "CRM",
  PRODUCTION_PENDING: "Content + Design",
  PRODUCTION_SUBMITTED: "CRM",
  FINAL_QC: "CRM",
  READY: "Finalized",
  BLOCKED: "CRM",
};

/**
 * The monthly workflow flowchart — one connected node per stage, showing
 * exactly how many real campaigns are sitting there right now and which
 * team owns that step. Every count is a live filter over real Supabase
 * data (see lib/workflow.ts stageOf()) — no thresholds, no dependence on
 * the date. Zero campaigns means every node reads zero.
 */
export function MonthlyProgressBar({ campaigns }: { campaigns: Campaign[] }) {
  const counts = STAGE_ORDER.map((stage) => ({
    stage,
    count: campaigns.filter((c) => stageOf(c) === stage).length,
  }));
  const total = campaigns.length;

  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-card sm:p-5">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-[11px] font-600 uppercase tracking-wider text-faint">Monthly workflow — per team</span>
        <span className="text-[11px] font-600 text-heading">{total} total campaign{total === 1 ? "" : "s"}</span>
      </div>

      {total === 0 ? (
        <p className="py-3 text-tiny text-muted">No campaigns yet — every stage below is at zero until CRM uploads a real input file.</p>
      ) : (
        <div className="overflow-x-auto pb-1">
          <div className="flex min-w-[720px] items-start">
            {counts.map(({ stage, count }, i) => (
              <div key={stage} className="flex flex-1 items-start">
                <div className="flex flex-1 flex-col items-center gap-2">
                  <div className={`flex h-14 w-14 items-center justify-center rounded-full border-2 text-[18px] font-700 transition-colors ${
                    count > 0 ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-line bg-[#F9FAFB] text-faint"}`}>
                    {count}
                  </div>
                  <div className="text-center">
                    <div className="text-[11px] font-600 leading-tight text-heading">{STAGE_LABEL[stage]}</div>
                    <div className="mt-0.5 text-[9px] font-medium uppercase tracking-wide text-faint">{STAGE_TEAM[stage]}</div>
                  </div>
                </div>
                {i < counts.length - 1 && (
                  <div className={`mt-7 h-[2px] flex-1 ${count > 0 ? "bg-indigo-300" : "bg-line"}`} />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
