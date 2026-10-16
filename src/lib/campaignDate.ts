import { toDate, isoDate, today } from "./format";
import { excelValueToIsoDate } from "./excelDates";

/**
 * The canonical campaign-date helper.
 *
 * `launch_date` is THE campaign date. Nothing else may stand in for it —
 * not `updated_at`, not a review timestamp, not an upload or sync time, not
 * a deadline, not a sheet name. A July campaign edited in October is still
 * a July campaign.
 *
 * This exists because "when is this campaign?" was being answered in
 * several places by whichever timestamp was nearest to hand, and a status
 * derived from the wrong one is wrong in a way that looks plausible.
 */

/** Fields that are NOT the campaign date, kept here as documentation. */
export const NOT_CAMPAIGN_DATE = [
  "updated_at", "created_at", "submitted_at", "changed_at", "reviewed_at",
  "acknowledged_at", "calendar_updated_at", "last_evaluated_at",
  "archived_at", "uploaded_at", "deadline",
] as const;

export interface HasCampaignDate {
  id?: string;
  launch_date?: string | null;
}

/**
 * The campaign date as an ISO yyyy-mm-dd string, or null when absent or
 * unparseable. Never guesses an ambiguous format.
 *
 * Accepted: ISO (yyyy-mm-dd, with or without a time), a Date, an Excel
 * serial number, and dd/mm/yyyy — the format the CRM sheets use. mm/dd/yyyy
 * is deliberately NOT inferred: 03/04/2026 is genuinely ambiguous, and
 * silently picking one is how a campaign lands in the wrong month.
 */
export function campaignDateIso(value: unknown): string | null {
  if (value == null || value === "") return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : isoDate(value);
  }

  if (typeof value === "number") {
    // Excel serial date. Delegated so there is one implementation.
    const iso = excelValueToIsoDate(value);
    return iso || null;
  }

  const s = String(value).trim();
  if (!s) return null;

  // ISO, optionally with a time component.
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const [, y, m, d] = iso;
    const month = Number(m), day = Number(d);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${y}-${m}-${d}`;
  }

  // dd/mm/yyyy or dd-mm-yyyy, the CRM sheet format.
  const dmy = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (dmy) {
    const day = Number(dmy[1]), month = Number(dmy[2]);
    // A day over 12 proves it is not mm/dd; at 12 or under it is ambiguous,
    // and we take the known source format (dd/mm) rather than guess.
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${dmy[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  // A millisecond timestamp.
  if (/^\d{10,}$/.test(s)) {
    const d = new Date(Number(s));
    return Number.isNaN(d.getTime()) ? null : isoDate(d);
  }

  return null;
}

/** "2026-10" for the month a campaign belongs to. */
export function campaignMonthKey(c: HasCampaignDate): string | null {
  const iso = campaignDateIso(c.launch_date);
  return iso ? iso.slice(0, 7) : null;
}

/** The month key for a date, defaulting to today. Never hard-coded. */
export const monthKeyOf = (d: Date = today()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/**
 * Campaigns whose CAMPAIGN DATE falls in the given month. The month comes
 * from the system clock by default, so this keeps working in November,
 * December and January without a change.
 */
export function inMonth<T extends HasCampaignDate>(
  campaigns: T[], asOf: Date = today()
): T[] {
  const key = monthKeyOf(asOf);
  return campaigns.filter((c) => campaignMonthKey(c) === key);
}

/** Campaigns whose campaign date falls inside an inclusive ISO range. */
export function inWeek<T extends HasCampaignDate>(
  campaigns: T[], startIso: string, endIso: string
): T[] {
  return campaigns.filter((c) => {
    const d = campaignDateIso(c.launch_date);
    return d !== null && d >= startIso && d <= endIso;
  });
}

/**
 * One row per campaign id. The same campaign can arrive from several
 * snapshots or imports, and counting it twice inflates every total that
 * depends on it.
 */
export function dedupeById<T extends { id?: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    const id = r.id;
    if (!id) { out.push(r); continue; }   // no id to dedupe on
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(r);
  }
  return out;
}

export { toDate, isoDate };
