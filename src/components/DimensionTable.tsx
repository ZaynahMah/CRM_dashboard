"use client";

import { useMemo, useState } from "react";
import type { DimensionRow } from "@/types/performance";
import { fmtInr, fmtPct } from "@/lib/performanceAnalysis";

/**
 * A compact, collapsible detail table — the chart above (DimensionVisual)
 * carries the primary visual weight, so this stays small and low on the page.
 */
export function DimensionTable({ rows }: { rows: DimensionRow[] }) {
  const [expanded, setExpanded] = useState(false);
  const sorted = [...rows].sort((a, b) => (b.revenue_inr ?? 0) - (a.revenue_inr ?? 0));

  const extraColumns = useMemo(() => {
    const keys = new Set<string>();
    rows.forEach((r) => Object.keys(r.extra ?? {}).forEach((k) => keys.add(k)));
    return [...keys];
  }, [rows]);

  if (rows.length === 0) return null;
  const visible = expanded ? sorted : sorted.slice(0, 5);

  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <div className="overflow-x-auto">
        <table className="text-tiny">
          <thead>
            <tr>
              <th>Name</th><th className="text-right">Visits</th><th className="text-right">Orders</th>
              <th className="text-right">Revenue</th><th className="text-right">CVR</th>
              <th className="text-right">AOV</th><th className="text-right">RPV</th>
              {extraColumns.map((c) => <th key={c} className="text-right">{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.id}>
                <td className="font-medium text-heading">{r.dimension_value}</td>
                <td className="text-right text-muted">{r.visits?.toLocaleString("en-IN") ?? "—"}</td>
                <td className="text-right text-muted">{r.orders?.toLocaleString("en-IN") ?? "—"}</td>
                <td className="text-right font-medium text-heading">{fmtInr(r.revenue_inr)}</td>
                <td className="text-right text-muted">{fmtPct(r.cvr)}</td>
                <td className="text-right text-muted">{fmtInr(r.aov_inr)}</td>
                <td className="text-right text-muted">{fmtInr(r.rpv_inr)}</td>
                {extraColumns.map((c) => <td key={c} className="text-right text-muted">{r.extra?.[c] ?? "—"}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length > 5 && (
        <button onClick={() => setExpanded(!expanded)}
          className="w-full border-t border-line bg-[#F9FAFB] py-2 text-micro font-medium text-indigo-700 hover:bg-indigo-50">
          {expanded ? "Show fewer rows" : `Show all ${sorted.length} rows`}
        </button>
      )}
    </div>
  );
}
