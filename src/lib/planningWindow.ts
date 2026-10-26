import { isoDate, toDate, today, fmtDate } from "./format";
import { businessWeekOf } from "./businessWeeks";
import { campaignDateIso } from "./campaignDate";

/**
 * The default planning window.
 *
 *   START = first day of the CURRENT month
 *   END   = 14th of the NEXT month
 *
 * Deliberately NOT "today + 14 days": the point is full current-month
 * context plus forward visibility into next month's first fortnight, so
 * November submissions are visible while October is still being worked.
 *
 * Fully dynamic — nothing is hard-coded to a month or a year, and the
 * December → January boundary rolls correctly.
 *
 * This is a DISPLAY window. Campaigns outside it are not deleted, blocked
 * or rescheduled; they simply are not in this default view and remain
 * reachable from All Campaigns.
 */

export interface PlanningWindow {
  start: string;   // ISO, first of current month
  end: string;     // ISO, 14th of next month
  label: string;   // "1 Oct → 14 Nov"
}

export function planningWindow(asOf: Date = today()): PlanningWindow {
  const y = asOf.getFullYear();
  const m = asOf.getMonth();
  // new Date(y, 12, 14) rolls to January of y+1 on its own, so the year
  // boundary needs no special case.
  const start = isoDate(new Date(y, m, 1));
  const end = isoDate(new Date(y, m + 1, 14));
  return { start, end, label: `${fmtDate(start)} → ${fmtDate(end)}` };
}

/** Is a campaign date inside the window? Inclusive at both ends. */
export function inPlanningWindow(
  dateIso: string | null | undefined, w: PlanningWindow = planningWindow()
): boolean {
  const d = campaignDateIso(dateIso);
  return d !== null && d >= w.start && d <= w.end;
}

/**
 * Campaigns placed by their CAMPAIGN DATE (`launch_date`), never by
 * created_at, submitted_at or updated_at. A PN submitted on 26 October for
 * 5 November belongs to November.
 */
export function withinPlanningWindow<T extends { launch_date?: string | null }>(
  rows: T[], w: PlanningWindow = planningWindow()
): T[] {
  return rows.filter((r) => inPlanningWindow(r.launch_date, w));
}

export interface PlanningWeek {
  key: string;
  label: string;
  start: string;
  end: string;
}

/**
 * Every business-week bucket needed to COVER the window — however many that
 * is. No fixed count: depending on where the month starts and ends this
 * yields roughly six to eight buckets, and the requirement is coverage, not
 * a particular number.
 *
 * Buckets are the existing calendar weeks (1-7, 8-14, 15-21, 22-28,
 * 29-end), so this view and the SLA agree on what a week is.
 */
export function planningWeeks(w: PlanningWindow = planningWindow()): PlanningWeek[] {
  const out: PlanningWeek[] = [];
  const seen = new Set<string>();
  const cursor = toDate(w.start);
  const last = toDate(w.end);

  // Walk day by day and collect each distinct bucket. Simple, and immune to
  // month-length and year-boundary arithmetic mistakes.
  while (isoDate(cursor) <= isoDate(last)) {
    const bw = businessWeekOf(isoDate(cursor));
    if (!seen.has(bw.key)) {
      seen.add(bw.key);
      out.push({ key: bw.key, label: bw.label, start: bw.start, end: bw.end });
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}
