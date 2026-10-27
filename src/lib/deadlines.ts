import { toDate, isoDate, today, daysBetween } from "./format";
import type { Campaign } from "@/types/campaign";
import { campaignDateIso } from "./campaignDate";

/**
 * THE Category deadline rule, for the whole app.
 *
 *   deadline = the PN's OWN campaign date - 7 days, at 23:59 IST
 *
 * Per PN per day, not per week: a 1 Nov PN is due 25 Oct, a 2 Nov PN 26
 * Oct, a 3 Nov PN 27 Oct. This replaces the former "week start - 7" rule
 * for deciding any individual PN's deadline.
 *
 * It matches `campaigns.category_deadline`, the generated column defined in
 * 01_schema.sql as `launch_date - 7`, so the database and the UI cannot
 * disagree. Nothing else may compute a PN deadline.
 */

/** India Standard Time, UTC+05:30, in minutes. */
const IST_OFFSET_MIN = 5 * 60 + 30;

/** The deadline DATE for one PN, ISO yyyy-mm-dd. */
export function pnDeadlineDate(launchDate: string | null | undefined): string | null {
  const iso = campaignDateIso(launchDate);
  if (!iso) return null;
  const d = toDate(iso);
  d.setDate(d.getDate() - 7);
  return isoDate(d);
}

/**
 * The exact instant a PN is due: 23:59:59.999 IST on the deadline date.
 * Returned as a real Date so a countdown can be computed against `now`.
 */
export function pnDeadlineInstant(launchDate: string | null | undefined): Date | null {
  const iso = pnDeadlineDate(launchDate);
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  // 23:59:59.999 IST expressed as UTC.
  return new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999) - IST_OFFSET_MIN * 60_000);
}

/** Milliseconds remaining. Negative once the deadline has passed. */
export function msUntilDeadline(
  launchDate: string | null | undefined, now: Date = new Date()
): number | null {
  const due = pnDeadlineInstant(launchDate);
  return due === null ? null : due.getTime() - now.getTime();
}

/** "2d 5h left", "7h left", "23m left", or null when there is no date. */
export function timeLeftLabel(
  launchDate: string | null | undefined, now: Date = new Date()
): string | null {
  const ms = msUntilDeadline(launchDate, now);
  if (ms === null) return null;
  if (ms <= 0) return "overdue";
  const mins = Math.floor(ms / 60_000);
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  if (days > 0) return `${days}d ${hours}h left`;
  if (hours > 0) return `${hours}h left`;
  return `${Math.max(1, mins)}m left`;
}

/** True once the PN's deadline has passed. */
export const deadlinePassed = (
  launchDate: string | null | undefined, now: Date = new Date()
) => {
  const ms = msUntilDeadline(launchDate, now);
  return ms !== null && ms <= 0;
};

/** Under 24 hours remaining — the amber state. */
export const deadlineImminent = (
  launchDate: string | null | undefined, now: Date = new Date()
) => {
  const ms = msUntilDeadline(launchDate, now);
  return ms !== null && ms > 0 && ms <= 24 * 60 * 60 * 1000;
};

/** The deadline range for a week of PNs: earliest and latest PN deadline. */
export function weekDeadlineRange(launchDates: (string | null | undefined)[]) {
  const all = launchDates.map(pnDeadlineDate).filter((d): d is string => d !== null).sort();
  return all.length === 0 ? null : { first: all[0], last: all[all.length - 1] };
}

/* ───────────── existing exports, now on the per-PN rule ───────────── */

export type DeadlineState =
  | "COMPLETED" | "EMERGENCY" | "OVERDUE" | "DUE_TODAY" | "DUE_SOON" | "ON_TRACK";

/**
 * Kept for the existing StatusChip. It now delegates to `pnDeadlineDate`,
 * so there is still only ONE calculation — this is a presentation wrapper,
 * not a second rule.
 */
export const categoryDeadline = (launchDate: string) =>
  toDate(pnDeadlineDate(launchDate) ?? launchDate);

export const isCategoryComplete = (c: Campaign) =>
  c.category_status === "SUBMITTED" || c.category_status === "LOCKED";

export function deadlineState(c: Campaign): DeadlineState {
  if (isCategoryComplete(c)) return "COMPLETED";
  if (c.is_emergency) return "EMERGENCY";
  const iso = pnDeadlineDate(c.launch_date);
  if (!iso) return "ON_TRACK";
  const gap = daysBetween(today(), toDate(iso));
  if (gap < 0) return "OVERDUE";
  if (gap === 0) return "DUE_TODAY";
  if (gap <= 3) return "DUE_SOON";
  return "ON_TRACK";
}

export const DEADLINE_LABEL: Record<DeadlineState, string> = {
  COMPLETED: "Completed",
  EMERGENCY: "Emergency",
  OVERDUE: "Overdue",
  DUE_TODAY: "Due today",
  DUE_SOON: "Due soon",
  ON_TRACK: "On track",
};
