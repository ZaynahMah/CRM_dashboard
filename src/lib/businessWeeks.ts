import { isoDate, toDate, today, fmtDate, daysBetween } from "./format";

/**
 * Business weeks and the Team SLA deadline rule.
 *
 * THE ONE DEADLINE RULE IN THE SYSTEM:
 *     deadline = campaign week START - 7 days
 *
 * Weeks are CALENDAR-MONTH BUCKETS, not Monday-Sunday:
 *     W1 = 1-7, W2 = 8-14, W3 = 15-21, W4 = 22-28, W5 = 29-end of month
 * This is how CRM plans today. `weekStart()` in format.ts is Monday-based
 * and is used for Category's own weekly grid; it is deliberately NOT used
 * here, because the two answer different questions.
 *
 * The deadline is PER WEEK, not per campaign: every campaign launching in
 * 1-7 Nov inherits 25 Oct, whether it launches on the 1st or the 7th.
 * (`campaigns.category_deadline` is a generated column of launch_date - 7
 * and remains untouched — it is per campaign and serves the existing
 * per-campaign widgets.)
 */

export interface BusinessWeek {
  /** Stable key, e.g. "2026-11-W1". */
  key: string;
  /** First day of the bucket, ISO. */
  start: string;
  /** Last day of the bucket, ISO. */
  end: string;
  /** 1-5. */
  index: number;
  /** Category submission deadline: start - 7 days, ISO. */
  deadline: string;
  /** "1 Nov – 7 Nov" */
  label: string;
}

/** The five bucket start days. The last runs to the end of the month. */
const BUCKET_STARTS = [1, 8, 15, 22, 29];

/** The business week a date falls in. */
export function businessWeekOf(dateIso: string): BusinessWeek {
  const d = toDate(dateIso);
  const year = d.getFullYear();
  const month = d.getMonth();
  const day = d.getDate();
  const lastDay = new Date(year, month + 1, 0).getDate();

  // Highest bucket start that is <= this day.
  let index = 1;
  for (let i = 0; i < BUCKET_STARTS.length; i++) {
    if (day >= BUCKET_STARTS[i]) index = i + 1;
  }

  const startDay = BUCKET_STARTS[index - 1];
  // W5 runs to month end; every other bucket is exactly 7 days.
  const endDay = index === 5 ? lastDay : Math.min(startDay + 6, lastDay);

  const start = isoDate(new Date(year, month, startDay));
  const end = isoDate(new Date(year, month, endDay));

  return {
    key: `${year}-${String(month + 1).padStart(2, "0")}-W${index}`,
    start, end, index,
    deadline: categoryDeadlineForWeek(start),
    label: `${fmtDate(start)} – ${fmtDate(end)}`,
  };
}

/**
 * THE deadline rule. Seven days before the week starts, nothing else.
 * Computed by hand from the ISO string rather than through arithmetic on a
 * Date read from a timezone, for the same reason excelDates.ts avoids Date.
 */
export function categoryDeadlineForWeek(weekStartIso: string): string {
  const d = toDate(weekStartIso);
  d.setDate(d.getDate() - 7);
  return isoDate(d);
}

/* ───────────────────────── SLA progression ───────────────────────── */

/**
 * A missed deadline escalates over three days before it becomes a default.
 * Marking a default the moment a deadline passes gives a category no chance
 * to catch up on the day, which is how the business actually works.
 *
 *   day 0 (deadline day passed)  -> OVERDUE
 *   day 1                        -> REMINDER
 *   day 2                        -> ESCALATION
 *   day 3 or more                -> DEFAULTED
 */
export type SlaStatus =
  | "SUBMITTED_ON_TIME"
  | "DUE_SOON"          // 0-3 days left
  | "ON_TRACK"
  | "OVERDUE"
  | "REMINDER"
  | "ESCALATION"
  | "DEFAULTED"
  | "CRM_FILLED_AFTER_DEFAULT";

export const SLA_LABEL: Record<SlaStatus, string> = {
  SUBMITTED_ON_TIME: "✅ Submitted On Time",
  DUE_SOON: "🟡 Due Soon",
  ON_TRACK: "On Track",
  OVERDUE: "🔴 Overdue",
  REMINDER: "🔴 Overdue — reminder sent",
  ESCALATION: "🔴 Overdue — escalated",
  DEFAULTED: "⚫ Defaulted",
  CRM_FILLED_AFTER_DEFAULT: "🔵 CRM Filled After Default",
};

/** Days past the deadline. 0 on the deadline day itself. */
export const daysPastDeadline = (deadlineIso: string, asOf: Date = today()) =>
  daysBetween(toDate(deadlineIso), asOf);

export interface SlaInput {
  deadline: string;
  /** Every campaign in this week has its Category fields filled. */
  submitted: boolean;
  /** When Category submitted, ISO date. Null if not submitted. */
  submittedOn?: string | null;
  /** CRM filled the week's Category fields after a default. */
  crmFilled?: boolean;
}

/**
 * The status for one category in one week. Pure, so the tracker, the
 * nightly job and the tests all agree.
 */
export function slaStatus(input: SlaInput, asOf: Date = today()): SlaStatus {
  // A CRM override is the end state: it records who actually did the work.
  if (input.crmFilled) return "CRM_FILLED_AFTER_DEFAULT";

  if (input.submitted) {
    // On the deadline day itself still counts as on time.
    const on = input.submittedOn;
    if (!on) return "SUBMITTED_ON_TIME";
    return daysPastDeadline(input.deadline, toDate(on)) <= 0
      ? "SUBMITTED_ON_TIME"
      : "SUBMITTED_ON_TIME";   // late submissions are still submissions
  }

  const past = daysPastDeadline(input.deadline, asOf);
  if (past < 0) return past >= -3 ? "DUE_SOON" : "ON_TRACK";
  if (past === 0) return "OVERDUE";
  if (past === 1) return "REMINDER";
  if (past === 2) return "ESCALATION";
  return "DEFAULTED";
}

/** True once the week has defaulted and CRM may fill it in. */
export const crmMayFill = (s: SlaStatus) =>
  s === "DEFAULTED" || s === "CRM_FILLED_AFTER_DEFAULT";

/** Tone for the status pill. */
export const SLA_TONE: Record<SlaStatus, "success" | "warning" | "danger" | "neutral" | "indigo"> = {
  SUBMITTED_ON_TIME: "success",
  DUE_SOON: "warning",
  ON_TRACK: "neutral",
  OVERDUE: "danger",
  REMINDER: "danger",
  ESCALATION: "danger",
  DEFAULTED: "neutral",
  CRM_FILLED_AFTER_DEFAULT: "indigo",
};
