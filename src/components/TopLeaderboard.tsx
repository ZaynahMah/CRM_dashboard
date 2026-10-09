"use client";

import { useState } from "react";
import type { TopPnRow } from "@/types/performance";
import { fmtInr, fmtPct } from "@/lib/performanceAnalysis";
import { topPnInsight } from "@/lib/performanceInsights";
import { Card, CardHead, Empty, Pill } from "./ui";

type SortKey = "revenue_inr" | "orders" | "cvr" | "rpv_inr";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "revenue_inr", label: "Revenue" }, { key: "orders", label: "Orders" },
  { key: "cvr", label: "CVR" }, { key: "rpv_inr", label: "RPV" },
];

/** Section 10 — Top Campaign Leaderboard: a curated, sortable ranking (not a raw data dump). */
export function TopLeaderboard({ rows }: { rows: TopPnRow[] }) {
  const [sortBy, setSortBy] = useState<SortKey>("revenue_inr");
  if (rows.length === 0) return null;

  const sorted = [...rows].sort((a, b) => (b[sortBy] ?? 0) - (a[sortBy] ?? 0));
  const insight = topPnInsight(rows);

  return (
    <div>
      <h2 className="mb-3 font-display text-[16px] font-700 text-heading">Top Campaign Leaderboard</h2>
      <Card pad={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
          <CardHead title="Top Performing Campaigns" sub="Sort by any metric" />
          <div className="flex gap-1 rounded-lg border border-line bg-surface p-1">
            {SORTS.map((s) => (
              <button key={s.key} onClick={() => setSortBy(s.key)}
                className={`rounded-md px-2.5 py-1 text-micro font-medium transition-colors ${
                  sortBy === s.key ? "bg-indigo-600 text-white" : "text-muted hover:bg-[#F9FAFB]"}`}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="divide-y divide-line px-5 pb-2 pt-3">
          {sorted.slice(0, 10).map((r, i) => (
            <div key={r.id} className="flex items-center gap-4 py-3">
              <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg text-tiny font-700 ${
                i === 0 ? "bg-indigo-600 text-white" : i < 3 ? "bg-indigo-100 text-indigo-700" : "bg-[#F2F4F7] text-muted"}`}>
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-heading">{r.pn_name}</span>
              <span className="hidden text-tiny text-muted sm:block">{r.orders?.toLocaleString("en-IN") ?? "—"} orders</span>
              <span className="w-24 text-right text-[13.5px] font-600 text-heading">{fmtInr(r.revenue_inr)}</span>
              <Pill dot={false} label={fmtPct(r.cvr)} tone="neutral" />
            </div>
          ))}
        </div>

        {insight && (
          <div className="grid gap-3 border-t border-line px-5 py-4 sm:grid-cols-3">
            <LeaderStat label="Highest revenue" name={insight.highestRevenue.pn_name} value={fmtInr(insight.highestRevenue.revenue_inr)} />
            <LeaderStat label="Highest CVR" name={insight.highestCvr.pn_name} value={fmtPct(insight.highestCvr.cvr)} />
            <LeaderStat label="Most efficient (RPV)" name={insight.mostEfficient.pn_name} value={fmtInr(insight.mostEfficient.rpv_inr)} />
          </div>
        )}
      </Card>
    </div>
  );
}

function LeaderStat({ label, name, value }: { label: string; name: string; value: string }) {
  return (
    <div className="rounded-lg bg-[#F9FAFB] px-3 py-2.5">
      <div className="text-[10px] font-medium uppercase tracking-wide text-faint">{label}</div>
      <div className="mt-0.5 truncate text-tiny font-600 text-heading">{name}</div>
      <div className="text-micro text-muted">{value}</div>
    </div>
  );
}
