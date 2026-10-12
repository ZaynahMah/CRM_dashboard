"use client";

import { useCallback, useEffect, useState } from "react";
import {
  defaultRateByCategory, orgDefaultRate, defaultRateTrend,
  type DefaultRateRow, type OrgDefaultRate,
} from "@/services/categorySla";
import { Card, Pill, Empty, Loading } from "./ui";

/**
 * Default Rate % — Executive KPI reporting, placed directly below the
 * category submission deadlines on the SLA page.
 *
 * REPORTING ONLY. Nothing here writes to category_sla or changes a status;
 * it reads the SLA the existing logic produced and expresses it as a rate.
 *
 *     Default Rate % = defaulted campaign weeks / total campaign weeks x 100
 *
 * A week that defaulted still counts even if CRM later filled it — the
 * override records who did the work, it does not erase the miss.
 */

const THRESHOLD = 10;

export function ExecutiveDefaultRate() {
  const [rows, setRows] = useState<DefaultRateRow[]>([]);
  const [org, setOrg] = useState<OrgDefaultRate | null>(null);
  const [trend, setTrend] = useState<{ month: string; defaulted: number; total: number; default_rate: number | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [r, o, t] = await Promise.all([
        defaultRateByCategory(), orgDefaultRate(), defaultRateTrend(),
      ]);
      setRows(r); setOrg(o); setTrend(t);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Loading label="Loading default rates" />;
  if (error) return <Card><p className="text-tiny text-warning-700">{error}</p></Card>;

  const rate = (v: number | null) => (v === null ? "—" : `${v}%`);
  // Only categories with a rate can be ranked; a category with no weeks yet
  // is neither best nor worst.
  const ranked = rows.filter((r) => r.default_rate !== null);
  const best = [...ranked].sort((a, b) => (a.default_rate! - b.default_rate!)).slice(0, 3);
  const worst = [...ranked].sort((a, b) => (b.default_rate! - a.default_rate!)).slice(0, 3);
  const maxTrend = Math.max(10, ...trend.map((t) => Number(t.default_rate ?? 0)));

  return (
    <div className="space-y-5">
      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h3 className="font-display text-[15px] font-600 text-heading">Default Rate %</h3>
          <span className="text-micro text-faint">
            Defaulted campaign weeks ÷ total campaign weeks. Target under {THRESHOLD}%.
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-line px-3 py-2.5">
            <div className={`text-[22px] font-700 tabular-nums ${
              (org?.default_rate ?? 0) > THRESHOLD ? "text-danger-700" : "text-heading"}`}>
              {rate(org?.default_rate ?? null)}
            </div>
            <div className="mt-0.5 text-micro text-faint">Organisation default rate</div>
          </div>
          <div className="rounded-lg border border-line px-3 py-2.5">
            <div className="text-[22px] font-700 tabular-nums text-heading">{org?.defaulted_weeks ?? 0}</div>
            <div className="mt-0.5 text-micro text-faint">Defaulted weeks</div>
          </div>
          <div className="rounded-lg border border-line px-3 py-2.5">
            <div className="text-[22px] font-700 tabular-nums text-heading">{org?.total_weeks ?? 0}</div>
            <div className="mt-0.5 text-micro text-faint">Total campaign weeks</div>
          </div>
          <div className="rounded-lg border border-line px-3 py-2.5">
            <div className={`text-[22px] font-700 tabular-nums ${
              (org?.over_threshold ?? 0) > 0 ? "text-danger-700" : "text-heading"}`}>
              {org?.over_threshold ?? 0}
            </div>
            <div className="mt-0.5 text-micro text-faint">Categories over {THRESHOLD}%</div>
          </div>
        </div>
      </Card>

      <Card pad={false}>
        <div className="border-b border-line px-5 py-3.5">
          <h3 className="font-display text-[15px] font-600 text-heading">By category</h3>
        </div>
        {rows.length === 0 ? (
          <Empty title="No SLA history yet" hint="Default rates appear once campaign weeks have been evaluated." />
        ) : (
          <table className="w-full">
            <thead>
              <tr><th>Category</th><th>On Time</th><th>Overdue</th><th>Defaulted</th><th>Default Rate %</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.category}>
                  <td className="text-tiny font-medium text-heading">{r.category}</td>
                  <td className="text-tiny tabular-nums text-muted">{r.on_time}</td>
                  <td className="text-tiny tabular-nums text-muted">{r.overdue}</td>
                  <td className="text-tiny tabular-nums text-muted">{r.defaulted}</td>
                  <td>
                    <Pill dot={false} label={rate(r.default_rate)}
                      tone={(r.default_rate ?? 0) > THRESHOLD ? "danger"
                        : (r.default_rate ?? 0) > 0 ? "warning" : "success"} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <h3 className="mb-2 font-display text-[15px] font-600 text-heading">Best performing</h3>
          <p className="mb-3 text-micro text-faint">Lowest default rate.</p>
          {best.length === 0 ? <Empty title="No data" hint="" /> : (
            <ul className="space-y-1.5">
              {best.map((r) => (
                <li key={r.category} className="flex items-center justify-between text-tiny">
                  <span className="text-heading">{r.category}</span>
                  <Pill dot={false} label={rate(r.default_rate)} tone="success" />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h3 className="mb-2 font-display text-[15px] font-600 text-heading">Worst performing</h3>
          <p className="mb-3 text-micro text-faint">Highest default rate.</p>
          {worst.length === 0 ? <Empty title="No data" hint="" /> : (
            <ul className="space-y-1.5">
              {worst.map((r) => (
                <li key={r.category} className="flex items-center justify-between text-tiny">
                  <span className="text-heading">{r.category}</span>
                  <Pill dot={false} label={rate(r.default_rate)}
                    tone={(r.default_rate ?? 0) > THRESHOLD ? "danger" : "warning"} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <h3 className="mb-3 font-display text-[15px] font-600 text-heading">Default rate % by month</h3>
        {trend.length === 0 ? (
          <Empty title="No trend yet" hint="A month of SLA history is needed before a trend means anything." />
        ) : (
          <ul className="space-y-2">
            {trend.map((t) => (
              <li key={t.month} className="flex items-center gap-3">
                <span className="w-[72px] shrink-0 text-tiny text-muted">{t.month}</span>
                <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-[#F2F4F7]">
                  <div className={`h-full rounded-full ${
                    Number(t.default_rate ?? 0) > THRESHOLD ? "bg-danger-600" : "bg-indigo-600"}`}
                    style={{ width: `${(Number(t.default_rate ?? 0) / maxTrend) * 100}%` }} />
                </div>
                <span className="w-[96px] shrink-0 text-right text-tiny tabular-nums text-heading">
                  {rate(t.default_rate)} ({t.defaulted}/{t.total})
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
