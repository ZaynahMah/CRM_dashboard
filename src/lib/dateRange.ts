import { fmtDate, isoDate, toDate } from "./format";

/**
 * Reusable date-range filtering.
 *
 * Deliberately NOT Content-specific: the same capability is wanted for CRM
 * exports, Category exports, Executive reports and audit downloads, so
 * nothing here knows what a campaign is beyond "it has a date". Callers
 * supply the accessor.
 */

export interface DateRange {
  /** ISO yyyy-mm-dd. */
  start: string;
  end: string;
}

export interface RangeValidation {
  valid: boolean;
  error: string | null;
}

/** Both dates present, both parseable, end not before start. */
export function validateRange(range: Partial<DateRange>): RangeValidation {
  const { start, end } = range;
  if (!start) return { valid: false, error: "Choose a start date." };
  if (!end) return { valid: false, error: "Choose an end date." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return { valid: false, error: "Dates must be real calendar dates." };
  }
  // String comparison is safe and exact on ISO dates, and avoids the
  // timezone shifts a Date round-trip introduces.
  if (end < start) {
    return { valid: false, error: "End date cannot be before start date." };
  }
  return { valid: true, error: null };
}

/**
 * INCLUSIVE on both ends: "1 Oct → 10 Oct" contains campaigns on the 1st
 * and on the 10th. Content reads a range the way a calendar does.
 *
 * Compared as ISO strings so a campaign is never pushed into the wrong day
 * by the viewer's timezone — the same reason excelDates.ts avoids `Date`.
 */
export function inRange(dateIso: string | null | undefined, range: DateRange): boolean {
  const d = (dateIso ?? "").slice(0, 10);
  if (!d) return false;
  return d >= range.start && d <= range.end;
}

/** Filters any list by a date read from each item. */
export function filterByDateRange<T>(
  items: T[], range: DateRange, dateOf: (item: T) => string | null | undefined
): T[] {
  return items.filter((i) => inRange(dateOf(i), range));
}

export interface RangeSummary<T> {
  items: T[];
  count: number;
  /** Distinct, sorted, blanks dropped — for the "Categories:" line. */
  categories: string[];
  label: string;
}

/**
 * Everything the export modal needs to show BEFORE downloading: how many
 * campaigns, which categories, and the range in words. Letting someone
 * confirm the batch is the point — an export that turns out to be the wrong
 * fortnight costs a day of work.
 */
export function summariseRange<T>(
  items: T[], range: DateRange,
  dateOf: (item: T) => string | null | undefined,
  categoryOf?: (item: T) => string | null | undefined
): RangeSummary<T> {
  const matched = filterByDateRange(items, range, dateOf);
  const categories = categoryOf
    ? [...new Set(matched.map((i) => (categoryOf(i) ?? "").trim()).filter(Boolean))].sort()
    : [];
  return {
    items: matched,
    count: matched.length,
    categories,
    label: `${fmtDate(range.start)} → ${fmtDate(range.end)}`,
  };
}

/** A sensible default: the current calendar month. */
export function currentMonthRange(today = new Date()): DateRange {
  const y = today.getFullYear();
  const m = today.getMonth();
  return {
    start: isoDate(new Date(y, m, 1)),
    end: isoDate(new Date(y, m + 1, 0)),
  };
}

/** Shifts a range by whole days, for "next 10 days" style controls. */
export function shiftRange(range: DateRange, days: number): DateRange {
  const s = toDate(range.start); s.setDate(s.getDate() + days);
  const e = toDate(range.end); e.setDate(e.getDate() + days);
  return { start: isoDate(s), end: isoDate(e) };
}
