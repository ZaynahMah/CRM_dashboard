"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Campaign } from "@/types/campaign";
import type { QcMap } from "@/lib/crmBuckets";
import {
  summariseLocally, EMPTY_SUMMARY, WORKFLOW_NODES, type WorkflowSummary,
} from "@/lib/monthlyWorkflow";

/**
 * The monthly workflow flowchart — one connected node per stage, showing how
 * many campaigns are sitting there right now and which team owns that step.
 *
 * THE DESIGN IS THE ORIGINAL, restored unchanged: circular count nodes,
 * connecting rules, team captions, the same sizes, colours and spacing.
 * Only the DATA SOURCE changed.
 *
 * Numbers come from `monthly_workflow_summary()` (migration 20), a SECURITY
 * DEFINER function covering the FULL table, so CRM, Category, Content and
 * Executive all see identical values. Counting client-side gave each role
 * different numbers, because migration 17 scopes reads per role.
 *
 * Content is the only production team; there is no Design node.
 *
 * `campaigns` is passed in for the fallback and because it changes whenever
 * realtime patches or reloads the list, which is what keeps these counts
 * live without a second subscription.
 */
export function MonthlyWorkflow({ campaigns, qc }: { campaigns: Campaign[]; qc?: QcMap }) {
  const [summary, setSummary] = useState<WorkflowSummary>(EMPTY_SUMMARY);
  const [scoped, setScoped] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc("monthly_workflow_summary");
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as WorkflowSummary | null;
      if (!row) throw new Error("empty summary");
      setSummary(row);
      setScoped(false);
    } catch {
      // Migration 20 not applied, or the call failed. Fall back to the rows
      // this role can read rather than showing nothing, and say so.
      setSummary(summariseLocally(campaigns, qc ?? {}));
      setScoped(true);
    }
  }, [campaigns, qc]);

  useEffect(() => { load(); }, [load]);

  const counts = WORKFLOW_NODES.map((n) => ({ ...n, count: summary[n.key] }));
  const total = summary.total;

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
            {counts.map(({ key, label, team, count }, i) => (
              <div key={key} className="flex flex-1 items-start">
                <div className="flex flex-1 flex-col items-center gap-2">
                  <div className={`flex h-14 w-14 items-center justify-center rounded-full border-2 text-[18px] font-700 transition-colors ${
                    count > 0 ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-line bg-[#F9FAFB] text-faint"}`}>
                    {count}
                  </div>
                  <div className="text-center">
                    <div className="text-[11px] font-600 leading-tight text-heading">{label}</div>
                    <div className="mt-0.5 text-[9px] font-medium uppercase tracking-wide text-faint">{team}</div>
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

      {/* Only appears when the shared summary is unavailable, so the normal
          view is byte-for-byte the original. Styled as the existing
          empty-state line rather than as a new banner. */}
      {scoped && total > 0 && (
        <p className="mt-3 text-tiny text-muted">
          Showing only the campaigns visible to your role — the shared summary is
          unavailable. Ask an admin to apply database migration 20.
        </p>
      )}
    </div>
  );
}
