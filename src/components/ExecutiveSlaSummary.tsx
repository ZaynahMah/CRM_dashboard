"use client";

import { Card, Pill, Empty } from "./ui";
import type { SlaSummary } from "@/services/categorySla";

/**
 * Executive view of the Category SLA — a NEW component. The existing
 * Executive dashboard was not modified; this is added alongside it.
 *
 * Counts come from `category_sla_summary()`, a SECURITY DEFINER function
 * spanning every row, so every role sees the same figures.
 */
export function ExecutiveSlaSummary({ summary, trend, offenders }: {
  summary: SlaSummary;
  trend: { month: string; on_time: number; total: number; on_time_pct: number }[];
  offenders: { category: string; missed: number; defaults: number; total: number }[];
}) {
  const cards = [
    { label: "Categories On Time", value: summary.on_time,          tone: "success" as const },
    { label: "Categories Due Soon", value: summary.due_soon,        tone: "warning" as const },
    { label: "Categories Overdue",  value: summary.overdue,         tone: "danger" as const },
    { label: "Defaults Created",    value: summary.defaults_created, tone: "neutral" as const },
    { label: "CRM Overrides",       value: summary.crm_overrides,   tone: "indigo" as const },
  ];

  const maxPct = Math.max(100, ...trend.map((t) => Number(t.on_time_pct ?? 0)));

  return (
    <div className="space-y-5">
      <Card>
        <h3 className="mb-3 font-display text-[15px] font-600 text-heading">Category SLA Summary</h3>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {cards.map((c) => (
            <div key={c.label} className="rounded-lg border border-line px-3 py-2.5">
              <div className="text-[22px] font-700 tabular-nums text-heading">{c.value}</div>
              <div className="mt-0.5 text-micro text-faint">{c.label}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h3 className="mb-3 font-display text-[15px] font-600 text-heading">On-time % by month</h3>
        {trend.length === 0 ? (
          <Empty title="No trend yet" hint="A month of SLA history is needed before a trend means anything." />
        ) : (
          <ul className="space-y-2">
            {trend.map((t) => (
              <li key={t.month} className="flex items-center gap-3">
                <span className="w-[72px] shrink-0 text-tiny text-muted">{t.month}</span>
                <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-[#F2F4F7]">
                  <div className="h-full rounded-full bg-success-600"
                    style={{ width: `${(Number(t.on_time_pct ?? 0) / maxPct) * 100}%` }} />
                </div>
                <span className="w-[86px] shrink-0 text-right text-tiny tabular-nums text-heading">
                  {Number(t.on_time_pct ?? 0)}% ({t.on_time}/{t.total})
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card pad={false}>
        <div className="border-b border-line px-5 py-3.5">
          <h3 className="font-display text-[15px] font-600 text-heading">Top offenders</h3>
          <p className="text-micro text-faint">Categories with the most missed deadlines.</p>
        </div>
        {offenders.length === 0 ? (
          <Empty title="No missed deadlines" hint="Every category has submitted on time so far." />
        ) : (
          <table className="w-full">
            <thead><tr><th>Category</th><th>Missed</th><th>Defaults</th><th>Weeks</th></tr></thead>
            <tbody>
              {offenders.map((o) => (
                <tr key={o.category}>
                  <td className="text-tiny font-medium text-heading">{o.category}</td>
                  <td><Pill dot={false} label={String(o.missed)} tone="danger" /></td>
                  <td className="text-tiny tabular-nums text-muted">{o.defaults}</td>
                  <td className="text-tiny tabular-nums text-muted">{o.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
