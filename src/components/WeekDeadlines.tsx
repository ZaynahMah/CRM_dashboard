"use client";

import { useMemo } from "react";
import type { Campaign } from "@/types/campaign";
import { Pill } from "./ui";
import { fmtDate, isoDate, toDate } from "@/lib/format";
import { categoryDeadlineForWeek } from "@/lib/businessWeeks";
import { inWeek, inMonth, dedupeById } from "@/lib/campaignDate";

interface WeekBlock {
  weekLabel: string;
  weekStart: string;
  weekEnd: string;
  deadline: string;
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
     * ONGOING-MONTH GATE. Rows whose campaign date falls in the month being
     * shown. The week ranges below already confine results to this month,
     * so this is a belt-and-braces guard — and it makes the rule explicit
     * rather than incidental, which is what let the old bug hide.
     *
     * `monthStart` is passed in from the system clock, so this rolls into
     * November, December and January with no change.
     */
    const monthRows = inMonth(rows, monthStart);
    const monthHasData = monthRows.length > 0;
    const year = monthStart.getFullYear();
    const month = monthStart.getMonth();
    const lastDay = new Date(year, month + 1, 0).getDate();

    for (let d = 1; d <= lastDay; d += 7) {
      const ws = new Date(year, month, d);
      const we = new Date(year, month, Math.min(d + 6, lastDay));
      // THE one deadline rule: business week start minus 7 days. This used
      // to subtract 9 ("1 week + 2 days buffer"), which contradicted both
      // the generated column in the schema and lib/deadlines.ts — Category
      // was shown a deadline two days earlier than the database recorded.
      // There is now a single rule, in lib/businessWeeks.ts.
      const deadline = toDate(categoryDeadlineForWeek(isoDate(ws)));

      const wsIso = isoDate(ws);
      const weIso = isoDate(we);
      // Scoped by CAMPAIGN DATE (launch_date) — never by updated_at, a
      // review timestamp, an upload time or the deadline.
      const weekCampaigns = inWeek(monthRows, wsIso, weIso);

      /**
       * PRE-EXISTING definition, deliberately unchanged: a campaign counts
       * as filled when Brand and Offer are both present.
       *
       * Worth knowing: the app holds THREE different notions of a Category
       * submission being complete, and they disagree —
       *   here                      brand && offer                (2 fields)
       *   lib/categoryValidation    CATEGORY_REQUIRED             (6 fields)
       *   migration 24 SLA          category_status in LOCKED/SUBMITTED
       * This is the loosest of the three. It is kept as-is because changing
       * it would change every number in this table, which is a product
       * decision, not a bug fix.
       */
      const filled = weekCampaigns.filter((c) => c.brand && c.offer).length;
      const total = weekCampaigns.length;

      /**
       * Status depends on ACTUAL CAMPAIGN RECORDS, not on the calendar.
       *
       * The bug this replaces was `else if (deadline < t) status = "In
       * Progress"`, which made every week with a passed deadline look
       * active even with zero campaigns — producing the impossible
       * "0 campaigns · 0 / 0 · In Progress".
       *
       * A deadline says when input was DUE. Only a campaign row proves work
       * EXISTS. The two are separate concepts and the first must never
       * stand in for the second.
       */
      /**
       * The status invariant:
       *   total === 0                  -> Pending
       *   total > 0 && filled < total  -> In Progress
       *   total > 0 && filled === total-> Completed
       *
       * `filled` and the Completed mapping are BOTH pre-existing product
       * rules, carried over unchanged. See the note above `filled`.
       */
      let status: WeekBlock["status"] = "Pending";
      // Explicit guards, in the order the rules were stated.
      if (!monthHasData) {
        status = "Pending";              // no current-month input at all
      } else if (total === 0) {
        status = "Pending";              // nothing for THIS week
      } else if (filled < total) {
        status = "In Progress";
      } else {
        status = "Completed";
      }

      blocks.push({
        weekLabel: `${fmtDate(wsIso)} – ${fmtDate(weIso)}`,
        weekStart: wsIso,
        weekEnd: weIso,
        deadline: isoDate(deadline),
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
        <div className="text-[14px] font-600 text-heading">Category submission deadlines</div>
        <div className="mt-0.5 text-micro text-faint">Category must submit inputs one week before each campaign week</div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Campaign week</th>
            <th>Category deadline</th>
            <th>Campaigns</th>
            <th>Filled</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((w) => {
            const filled = w.campaigns.filter((c) => c.brand && c.offer).length;
            return (
              <tr key={w.weekStart}>
                <td className="font-medium text-heading">{w.weekLabel}</td>
                <td className="text-muted">{fmtDate(w.deadline)}</td>
                <td className="text-muted">{w.campaigns.length}</td>
                <td className="text-muted">{filled} / {w.campaigns.length}</td>
                <td><Pill label={w.status} tone={tones[w.status]} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
