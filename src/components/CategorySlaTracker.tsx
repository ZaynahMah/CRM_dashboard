"use client";

import { useState } from "react";
import type { SlaRow } from "@/services/categorySla";
import { recordCrmOverride, recalculateSla } from "@/services/categorySla";
import { SLA_LABEL, SLA_TONE, crmMayFill, type SlaStatus } from "@/lib/businessWeeks";
import { Button, Card, Pill, Empty } from "./ui";
import { fmtDate } from "@/lib/format";

/**
 * "Team SLA & Defaults" — the per-week detail table, kept for the CRM
 * override action. The dashboard cards live in TeamSlaDashboard.tsx.
 *
 * One row per category per business week: who submitted on time, who is due
 * soon, who is overdue, and who has defaulted. A default never blocks
 * anything; it records that the deadline passed and lets CRM proceed while
 * saying plainly that CRM, not Category, did the work.
 */
export function CategorySlaTracker({ rows, isCrm, onChanged }: {
  rows: SlaRow[];
  /** Only CRM may record a default override. */
  isCrm: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const override = async (id: string) => {
    setBusy(id); setError(null);
    try { await recordCrmOverride(id); onChanged(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setBusy(null);
  };

  const refresh = async () => {
    setBusy("all"); setError(null);
    try { await recalculateSla(); onChanged(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setBusy(null);
  };

  return (
    <Card pad={false}>
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3.5">
        <h3 className="font-display text-[15px] font-600 text-heading">Team SLA &amp; Defaults</h3>
        <span className="text-micro text-faint">
          Deadline is the campaign week start minus 7 days
        </span>
        <div className="ml-auto">
          <Button size="sm" variant="ghost" disabled={busy !== null} onClick={refresh}>
            {busy === "all" ? "Recalculating..." : "Recalculate"}
          </Button>
        </div>
      </div>

      {error && (
        <p className="border-b border-line bg-danger-50 px-5 py-2 text-tiny text-danger-700">{error}</p>
      )}

      {rows.length === 0 ? (
        <Empty title="No SLA data yet"
          hint="Press Recalculate once campaigns exist, or wait for the nightly run." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px]">
            <thead>
              <tr>
                <th>Category</th><th>Campaign Week</th><th>Deadline</th>
                <th>PNs</th><th>Status</th><th className="text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const status = r.status as SlaStatus;
                return (
                  <tr key={r.id}>
                    <td className="text-tiny font-medium text-heading">{r.category}</td>
                    <td className="whitespace-nowrap text-tiny text-muted">
                      {fmtDate(r.week_start)} – {fmtDate(r.week_end)}
                    </td>
                    <td className="whitespace-nowrap text-tiny text-muted">{fmtDate(r.deadline)}</td>
                    <td className="text-tiny tabular-nums text-muted">
                      {r.submitted_count} / {r.pn_count}
                    </td>
                    <td>
                      <Pill dot={false} label={SLA_LABEL[status] ?? r.status}
                        tone={SLA_TONE[status] ?? "neutral"} />
                    </td>
                    <td className="text-right">
                      {/* CRM may fill only once a week has actually defaulted —
                          not while it is merely overdue or escalated. */}
                      {isCrm && crmMayFill(status) && !r.crm_filled_at && (
                        <Button size="sm" variant="ghost" disabled={busy === r.id}
                          onClick={() => override(r.id)}>
                          {busy === r.id ? "Recording..." : "CRM filled this"}
                        </Button>
                      )}
                      {r.crm_filled_at && (
                        <span className="text-micro text-faint">
                          CRM filled {fmtDate(r.crm_filled_at.slice(0, 10))}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
