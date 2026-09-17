import type { Campaign } from "@/types/campaign";
import { daysBetween, toDate, today } from "./format";

export type DeadlineState =
  | "COMPLETED" | "EMERGENCY" | "OVERDUE" | "DUE_TODAY" | "DUE_SOON" | "ON_TRACK";

/** RULE 4 — the deadline is never typed by hand, it is always launch date - 7. */
export const categoryDeadline = (launchDate: string) => {
  const d = toDate(launchDate);
  d.setDate(d.getDate() - 7);
  return d;
};

export const isCategoryComplete = (c: Campaign) =>
  c.category_status === "SUBMITTED" || c.category_status === "LOCKED";

/** RULE 7 — once submitted, Category edits only through a change request. */
export const isCategoryLocked = (c: Campaign) => c.category_status === "LOCKED";

export function deadlineState(c: Campaign): DeadlineState {
  if (isCategoryComplete(c)) return "COMPLETED";
  if (c.is_emergency) return "EMERGENCY";
  const due = c.category_deadline ? toDate(c.category_deadline) : categoryDeadline(c.launch_date);
  const gap = daysBetween(today(), due);
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

/** Alert copy, written the way an operator would read it in a standup. */
export function deadlineAlert(campaigns: Campaign[]): string | null {
  const overdue = campaigns.filter((c) => deadlineState(c) === "OVERDUE");
  const dueToday = campaigns.filter((c) => deadlineState(c) === "DUE_TODAY");
  if (overdue.length) {
    const dates = new Set(overdue.map((c) => c.launch_date));
    return overdue.length === 1
      ? `1 push scheduled for ${overdue[0].launch_date} is overdue for Category details.`
      : `${overdue.length} pushes across ${dates.size} launch dates are overdue for Category details.`;
  }
  if (dueToday.length) {
    return dueToday.length === 1
      ? "Your push details are due today."
      : `${dueToday.length} pushes need Category details today.`;
  }
  return null;
}
