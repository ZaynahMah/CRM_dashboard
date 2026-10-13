import { daysPastDeadline, type SlaStatus } from "./businessWeeks";
import { today, toDate, fmtDate } from "./format";

/**
 * Team SLA & Accountability — the operational view.
 *
 * This is a DISPLAY layer over the SLA that migration 24 already computes.
 * It introduces NO new deadline formula: `daysPastDeadline` and the stored
 * status are the only inputs, and the escalation ladder
 * (day 0 overdue → 1 reminder → 2 escalation → 3+ defaulted) is untouched.
 *
 * The question it answers is "what should CRM do today?", not "who is
 * late?", which is why the health buckets are coarser than the stored
 * statuses and are sorted by urgency rather than alphabetically.
 */

export type HealthStatus =
  | "COMPLETED" | "ON_TRACK" | "DUE_SOON" | "DUE_TODAY" | "OVERDUE" | "DEFAULTED";

export const HEALTH_LABEL: Record<HealthStatus, string> = {
  COMPLETED: "Completed",
  ON_TRACK: "On Track",
  DUE_SOON: "Due Soon",
  DUE_TODAY: "Due Today",
  OVERDUE: "Overdue",
  DEFAULTED: "Defaulted",
};

export const HEALTH_TONE: Record<HealthStatus, "success" | "neutral" | "warning" | "danger" | "indigo"> = {
  COMPLETED: "success",
  ON_TRACK: "neutral",
  DUE_SOON: "warning",
  DUE_TODAY: "warning",
  OVERDUE: "danger",
  DEFAULTED: "indigo",
};

/** Lower sorts first: the most urgent thing CRM must chase. */
export const HEALTH_URGENCY: Record<HealthStatus, number> = {
  DEFAULTED: 0, OVERDUE: 1, DUE_TODAY: 2, DUE_SOON: 3, ON_TRACK: 4, COMPLETED: 5,
};

export interface SlaRowLike {
  id: string;
  category: string;
  week_key: string;
  week_start: string;
  week_end: string;
  deadline: string;
  pn_count: number;
  submitted_count: number;
  status: string;
  defaulted_at?: string | null;
  crm_filled_at?: string | null;
  last_evaluated_at?: string | null;
}

/**
 * Maps a stored status to an operational one.
 *
 * The one refinement: on the deadline day itself the stored status is
 * OVERDUE (the agreed ladder), but operationally it reads better as
 * "Due Today" — the team still has the day. The stored value and every
 * downstream calculation are unchanged; only this label differs, and
 * "Overdue" then means the deadline genuinely passed.
 */
export function healthOf(row: SlaRowLike, asOf: Date = today()): HealthStatus {
  const s = row.status as SlaStatus;
  if (s === "DEFAULTED" || s === "CRM_FILLED_AFTER_DEFAULT") return "DEFAULTED";
  if (s === "SUBMITTED_ON_TIME") return "COMPLETED";

  const past = daysPastDeadline(row.deadline, asOf);
  if (past >= 1) return "OVERDUE";       // REMINDER / ESCALATION
  if (past === 0) return "DUE_TODAY";    // stored OVERDUE, day 0
  if (past >= -3) return "DUE_SOON";
  return "ON_TRACK";
}

/** Inputs the team still owes. Never negative. */
export const missingInputs = (r: SlaRowLike) =>
  Math.max(0, (r.pn_count ?? 0) - (r.submitted_count ?? 0));

/**
 * Default % for one week: how much of the required input is missing.
 *
 * Distinct from the Executive Default Rate, which counts whole DEFAULTED
 * weeks. Both are wanted: this shows how far behind a team is right now,
 * that one shows how often a team misses entirely.
 */
export function defaultPercent(r: SlaRowLike): number {
  const expected = r.pn_count ?? 0;
  if (expected === 0) return 0;
  return Math.round((missingInputs(r) / expected) * 1000) / 10;
}

/* ───────────────────────── Card 1: health summary ───────────────────────── */

export interface HealthSummary {
  total: number;
  on_track: number;
  due_soon: number;
  due_today: number;
  overdue: number;
  defaulted: number;
  completed: number;
}

export function healthSummary(rows: SlaRowLike[], asOf: Date = today()): HealthSummary {
  const out: HealthSummary = {
    total: rows.length, on_track: 0, due_soon: 0, due_today: 0,
    overdue: 0, defaulted: 0, completed: 0,
  };
  const key: Record<HealthStatus, keyof HealthSummary> = {
    ON_TRACK: "on_track", DUE_SOON: "due_soon", DUE_TODAY: "due_today",
    OVERDUE: "overdue", DEFAULTED: "defaulted", COMPLETED: "completed",
  };
  for (const r of rows) out[key[healthOf(r, asOf)]]++;
  return out;
}

/* ───────────────────────── Card 2: requires attention ───────────────────────── */

export interface AttentionItem {
  row: SlaRowLike;
  health: HealthStatus;
  missing: number;
  /** "Tomorrow", "Deadline passed 3 days ago", "In 5 days" */
  deadlineText: string;
  daysPast: number;
}

/** Days past the deadline, as prose a person can act on. */
export function deadlineText(deadlineIso: string, asOf: Date = today()): string {
  const past = daysPastDeadline(deadlineIso, asOf);
  if (past === 0) return "Deadline today";
  if (past === 1) return "Deadline passed yesterday";
  if (past > 1) return `Deadline passed ${past} days ago`;
  if (past === -1) return "Tomorrow";
  return `In ${Math.abs(past)} days`;
}

/**
 * What CRM should chase, most urgent first. Completed and On Track weeks
 * are excluded: a list that includes everything is not a to-do list.
 */
export function requiresAttention(rows: SlaRowLike[], asOf: Date = today()): AttentionItem[] {
  return rows
    .map((row) => {
      const health = healthOf(row, asOf);
      return {
        row, health,
        missing: missingInputs(row),
        deadlineText: deadlineText(row.deadline, asOf),
        daysPast: daysPastDeadline(row.deadline, asOf),
      };
    })
    .filter((i) => i.health !== "COMPLETED" && i.health !== "ON_TRACK" && i.missing > 0)
    .sort((a, b) =>
      HEALTH_URGENCY[a.health] - HEALTH_URGENCY[b.health]
      || b.daysPast - a.daysPast            // longest overdue first
      || b.missing - a.missing              // then biggest gap
      || a.row.category.localeCompare(b.row.category));
}

/* ───────────────────────── Card 3: deadline calendar ───────────────────────── */

export interface DeadlineGroup {
  label: string;
  days: number;
  categories: string[];
}

/**
 * Upcoming deadlines grouped by when they fall: who must submit next.
 * Past deadlines are excluded — those live in Requires Attention.
 */
export function deadlineCalendar(
  rows: SlaRowLike[], asOf: Date = today(), horizonDays = 14
): DeadlineGroup[] {
  const groups = new Map<number, Set<string>>();
  for (const r of rows) {
    const health = healthOf(r, asOf);
    if (health === "COMPLETED" || health === "DEFAULTED") continue;
    const past = daysPastDeadline(r.deadline, asOf);
    const inDays = -past;
    if (inDays < 0 || inDays > horizonDays) continue;
    if (!groups.has(inDays)) groups.set(inDays, new Set());
    groups.get(inDays)!.add(r.category);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([days, cats]) => ({
      days,
      label: days === 0 ? "Today" : days === 1 ? "Tomorrow" : `In ${days} days`,
      categories: [...cats].sort(),
    }));
}

/* ───────────────────────── Card 6: accountability rows ───────────────────────── */

export interface AccountabilityRow {
  category: string;
  week: string;
  required: number;
  submitted: number;
  missing: number;
  deadline: string;
  health: HealthStatus;
  defaultPct: number;
  lastActivity: string | null;
}

export function accountabilityRows(
  rows: SlaRowLike[], asOf: Date = today()
): AccountabilityRow[] {
  return rows
    .map((r) => ({
      category: r.category,
      week: `${fmtDate(r.week_start)} – ${fmtDate(r.week_end)}`,
      required: r.pn_count ?? 0,
      submitted: r.submitted_count ?? 0,
      missing: missingInputs(r),
      deadline: r.deadline,
      health: healthOf(r, asOf),
      defaultPct: defaultPercent(r),
      lastActivity: r.last_evaluated_at ?? null,
    }))
    .sort((a, b) =>
      HEALTH_URGENCY[a.health] - HEALTH_URGENCY[b.health]
      || a.category.localeCompare(b.category)
      || a.deadline.localeCompare(b.deadline));
}

/** Completion for a progress bar: 0–100. */
export const completionPercent = (r: SlaRowLike) =>
  (r.pn_count ?? 0) === 0 ? 0
    : Math.round(((r.submitted_count ?? 0) / r.pn_count) * 100);

/** Sort helper shared by the cards, exported for tests. */
export const byUrgency = (a: HealthStatus, b: HealthStatus) =>
  HEALTH_URGENCY[a] - HEALTH_URGENCY[b];

export { toDate };
