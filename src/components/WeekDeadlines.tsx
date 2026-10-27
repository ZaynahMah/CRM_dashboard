"use client";

import { useMemo } from "react";
import type { Campaign } from "@/types/campaign";
import { Pill } from "./ui";
import { fmtDate, isoDate, toDate, today } from "@/lib/format";
import { weekDeadlineRange } from "@/lib/deadlines";
import { isDefaulted } from "@/lib/crmBuckets";
import { inWeek, dedupeById } from "@/lib/campaignDate";
import { planningWindow, planningWeeks, withinPlanningWindow } from "@/lib/planningWindow";

interface WeekBlock {
  weekLabel: string;
  weekStart: string;
  weekEnd: string;
  deadline: { first: string; last: string } | null;
  campaigns: Campaign[];
  status: "Completed" | "In Progress" | "Pending";
}

/**
 * Category submission deadlines.
 *
 * SOURCE OF TRUTH: `campaigns` comes from `useCampaigns()` -> `listCampaigns()`,
 * which reads the `campaigns` table in full (paged past the 1,000-row API
 * cap). These are real CRM input rows — not a sheet, not an upload record.
 *
 * A row counts for a week when ITS CAMPAIGN DATE (`launch_date`) falls
 * inside that week. Nothing else is accepted as evidence of submission: not
 * a file-modified date, not an upload timestamp, not `updated_at`, not
 * `submitted_at`, not the deadline, and not the current date.
 */
export function WeekDeadlines({ campaigns, monthStart }: {
  campaigns: Campaign[];
  monthStart: Date;
}) {
  const weeks = useMemo(() => {
    const blocks: WeekBlock[] = [];
    // The same campaign can arrive from several imports; counting it twice
    // inflates every total below.
    const rows = dedupeById(campaigns);

    /**
     * The planning window: first of the current month through the 14th of
     * the next. Campaigns are placed by CAMPAIGN DATE, so a PN submitted in
     * October for November appears in its November week.
     *
     * Week buckets are generated FROM the window, so the count follows the
     * dates rather than a hard-coded number.
     */
    const todayIso = isoDate(today());
    const win = planningWindow(monthStart);
    const windowRows = withinPlanningWindow(rows, win);
    const monthHasData = windowRows.length > 0;

    for (const week of planningWeeks(win)) {
      const weekCampaigns = inWeek(windowRows, week.start, week.end);

      /**
       * PRE-EXISTING definition, deliberately unchanged: a campaign counts
       * as filled when Brand and Offer are both present.
       */
      const filled = weekCampaigns.filter((c) => c.brand && c.offer).length;
      const total = weekCampaigns.length;

      /**
       * Status depends on ACTUAL CAMPAIGN RECORDS, not on the calendar.
       * A deadline says when input was DUE; only a campaign row proves work
       * EXISTS. Zero campaigns is never "In Progress".
       */
      let status: WeekBlock["status"] = "Pending";
      if (!monthHasData) status = "Pending";
      else if (total === 0) status = "Pending";
      else if (filled < total) status = "In Progress";
      else status = "Completed";

      // (d) Only weeks that have not finished: end date today or later.
      // This hides rows; nothing is deleted or archived.
      if (week.end < todayIso) continue;

      blocks.push({
        weekLabel: week.label,
        weekStart: week.start,
        weekEnd: week.end,
        // (b) Deadlines are per PN, so a week shows the RANGE its PNs span.
        deadline: weekDeadlineRange(weekCampaigns.map((c) => c.launch_date)),
        campaigns: weekCampaigns,
        status,
      });
    }

    return blocks;
  }, [campaigns, monthStart]);

  const tones = { Completed: "success", "In Progress": "warning", Pending: "neutral" } as const;

  return (
    <div className="rounded-xl border border-line bg-surface shadow-card">
      <div className="border-b border-line px-5 py-3.5">
        <div className="text-[14px] font-600 text-heading">Deadlines for submission</div>
        <div className="mt-0.5 text-micro text-faint">Each PN is due 7 days before its campaign date.</div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Campaign week</th>
            <th>Category deadline</th>
            <th>Campaigns</th>
            <th>Filled</th>
            <th>Defaulted</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((w) => {
            const filled = w.campaigns.filter((c) => c.brand && c.offer).length;
            const defaulted = w.campaigns.filter(isDefaulted).length;
            return (
              <tr key={w.weekStart}>
                <td className="font-medium text-heading">{w.weekLabel}</td>
                <td className="whitespace-nowrap text-muted">
                  {w.deadline
                    ? w.deadline.first === w.deadline.last
                      ? fmtDate(w.deadline.first)
                      : `${fmtDate(w.deadline.first)} – ${fmtDate(w.deadline.last)}`
                    : "—"}
                </td>
                <td className="text-muted">{w.campaigns.length}</td>
                <td className="text-muted">{filled} / {w.campaigns.length}</td>
                <td className={defaulted > 0 ? "font-medium text-danger-700" : "text-muted"}>
                  {defaulted}
                </td>
                <td><Pill label={w.status} tone={tones[w.status]} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
