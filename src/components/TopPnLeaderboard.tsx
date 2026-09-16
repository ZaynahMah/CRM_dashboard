"use client";

import type { TopPnRow } from "@/types/performance";
import { fmtInr, fmtPct } from "@/lib/performanceAnalysis";
import { Card, CardHead, Empty, Pill } from "./ui";

export function TopPnLeaderboard({ rows }: { rows: TopPnRow[] }) {
  if (rows.length === 0) {
    return <Card><Empty title="No data available for this month" hint="The Top 10 Performing PN sheet was empty or not found in the last upload." /></Card>;
  }
  return (
    <Card pad={false}>
      <div className="px-5 pt-5"><CardHead title="Top 10 Performing PN" sub="Pre-ranked leaderboard, current month" /></div>
      <div className="divide-y divide-line">
        {rows.map((r) => (
          <div key={r.id} className="flex items-center gap-4 px-5 py-3">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-indigo-50 text-tiny font-700 text-indigo-700">
              {r.rank}
            </span>
            <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-heading">{r.pn_name}</span>
            <span className="hidden text-tiny text-muted sm:block">{r.orders?.toLocaleString("en-IN") ?? "—"} orders</span>
            <span className="text-[13.5px] font-600 text-heading">{fmtInr(r.revenue_inr)}</span>
            <Pill dot={false} label={fmtPct(r.cvr)} tone="neutral" />
          </div>
        ))}
      </div>
    </Card>
  );
}
