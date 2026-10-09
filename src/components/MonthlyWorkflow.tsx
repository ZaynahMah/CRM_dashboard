"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Campaign } from "@/types/campaign";
import type { QcMap } from "@/lib/crmBuckets";
import {
  summariseLocally, WORKFLOW_ROWS, EMPTY_SUMMARY, type WorkflowSummary,
} from "@/lib/monthlyWorkflow";
import { Card, Pill } from "./ui";

/**
 * "Monthly workflow — per team". ONE component, shown in the main view of
 * every login, so CRM, Category, Content and Executive see IDENTICAL
 * numbers.
 *
 * The numbers come from `monthly_workflow_summary()` (migration 20), a
 * SECURITY DEFINER function covering the FULL table. Counting client-side
 * would give each role different totals, because migration 17 scopes reads
 * per role — that is the bug this fixes.
 *
 * `campaigns` is passed in only for the fallback and to retrigger the fetch
 * when realtime changes something; the displayed numbers come from the RPC
 * whenever it is available.
 */
export function MonthlyWorkflow({ campaigns, qc }: { campaigns: Campaign[]; qc?: QcMap }) {
  const [summary, setSummary] = useState<WorkflowSummary>(EMPTY_SUMMARY);
  const [scoped, setScoped] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc("monthly_workflow_summary");
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as WorkflowSummary | null;
      if (!row) throw new Error("empty summary");
      setSummary(row);
      setScoped(false);
    } catch {
      // Migration 20 not applied yet, or the call failed. Fall back to the
      // rows this role can read and say so, rather than showing nothing.
      setSummary(summariseLocally(campaigns, qc ?? {}));
      setScoped(true);
    }
    setLoaded(true);
  }, [campaigns, qc]);

  // `campaigns` changes whenever realtime patches or reloads the list, so
  // depending on it keeps these counts live without a second subscription.
  useEffect(() => { load(); }, [load]);

  const max = Math.max(1, ...WORKFLOW_ROWS.map((r) => summary[r.key]));

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="font-display text-[15px] font-600 text-heading">
          Monthly workflow — per team
        </h3>
        <Pill dot={false} label={`${summary.total} PNs`} tone="indigo" />
        {summary.emergencies > 0 && (
          <Pill dot={false} label={`${summary.emergencies} emergency`} tone="danger" />
        )}
        <span className="ml-auto text-micro text-faint">
          {summary.category_led} Category-led · {summary.crm_self} CRM Self
        </span>
      </div>

      {scoped && loaded && (
        <p className="mb-3 rounded-lg bg-warning-50 px-3 py-2 text-micro text-warning-700">
          Showing only the campaigns visible to your role — the shared summary is
          unavailable. Ask an admin to apply database migration 20.
        </p>
      )}

      <ul className="space-y-1.5">
        {WORKFLOW_ROWS.map((r) => {
          const n = summary[r.key];
          return (
            <li key={r.key} className="flex items-center gap-3">
              <span className="w-[170px] shrink-0 text-tiny text-muted">{r.label}</span>
              <span className="w-[68px] shrink-0 text-micro text-faint">{r.team}</span>
              <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[#F2F4F7]">
                <div className="h-full rounded-full bg-indigo-600"
                  style={{ width: `${(n / max) * 100}%` }} />
              </div>
              <span className="w-8 shrink-0 text-right text-tiny font-medium tabular-nums text-heading">
                {n}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
