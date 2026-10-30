"use client";

import type { Campaign } from "@/types/campaign";
import { slotDisplay, fmtDate, fmtTime } from "@/lib/format";
import { pnDeadlineDate } from "@/lib/deadlines";
import { isDefaulted, fromCategoryPending, fromCategoryCompleted } from "@/lib/crmBuckets";

/**
 * Section exports for the CRM board.
 *
 * Read-only: nothing here writes, so exporting can never change a status.
 * Every value comes from a real typed Campaign column — no casts, so a
 * schema change breaks the build rather than silently emitting blanks.
 *
 * Empty stays empty. Nothing is invented or defaulted, and a Defaulted PN's
 * Category fields are exported blank exactly as they are stored.
 */

/** CSV, matching the existing export in exportExcel.ts — Excel opens it. */
const esc = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Dates are rendered in IST, the same as everywhere else in the app. */
const istDateTime = (iso: string | null | undefined): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
};

/** Which of the three sub-sections a PN is in. */
export function sectionStatus(c: Campaign): string {
  if (isDefaulted(c) && !fromCategoryCompleted(c)) return "Defaulted";
  if (fromCategoryCompleted(c)) return "Completed CRM Input";
  if (fromCategoryPending(c)) return "Pending CRM Input";
  return "";
}

/**
 * Columns shared by both exports: the Category input, plus every CRM Part 2
 * field that exists in the code.
 */
const BASE_COLUMNS: [string, (c: Campaign) => unknown][] = [
  ["Status",          sectionStatus],
  ["Deadline",        (c) => { const d = pnDeadlineDate(c.launch_date); return d ? fmtDate(d) : ""; }],
  ["Date",            (c) => (c.launch_date ? fmtDate(c.launch_date) : "")],
  ["Time",            (c) => (c.launch_time ? fmtTime(c.launch_time) : "")],
  // The RAW uploaded Slot. Never slot_type, never "Standard".
  ["Slot",            (c) => (c.slot_label ?? (c.slot_number ?? ""))],
  ["Segment",         (c) => c.pncc_segment_label],
  ["Category",        (c) => c.category ?? c.pncc_category_code],
  ["Campaign Name",   (c) => c.campaign_name],
  ["Sub Category",    (c) => c.sub_category],
  ["Brand",           (c) => c.brand],
  ["Offer",           (c) => c.offer],
  ["Brief",           (c) => c.brief],
  ["Landing",         (c) => c.landing],
  ["Exp. CVR",        (c) => c.expected_cvr],
  ["Exp. RPV",        (c) => c.expected_rpv],
  ["Comments",        (c) => c.additional_notes],
  // Who completed the row. A defaulted PN is filled by CRM, otherwise
  // Category submitted it. No name column exists on campaigns, so this
  // reports the TEAM rather than inventing a person.
  ["Filled by",       (c) => (isDefaulted(c) ? "CRM (after default)"
    : c.category_status === "LOCKED" || c.category_status === "SUBMITTED" ? "Category" : "")],
  ["Submitted at",    (c) => istDateTime(c.submitted_at)],
  // ── CRM Part 2, every field the drawer writes ──
  ["PN Template",           (c) => c.pn_template],
  ["Title Brief",           (c) => c.title_brief],
  ["Message Brief",         (c) => c.message_brief],
  ["Creative Requirements", (c) => c.creative_requirements],
  ["Slot Type",             (c) => c.slot_type],
  ["PNCC Segment",          (c) => c.pncc_segment_label],
  ["PNCC Category",         (c) => c.pncc_category_code],
  // ── context that makes a row readable on its own ──
  ["Defaulted At",     (c) => istDateTime(c.defaulted_at)],
  ["Default Reason",   (c) => c.default_reason],
  ["Category Status",  (c) => c.category_status],
  ["CRM Status",       (c) => c.crm_status],
  ["Campaign ID",      (c) => c.id],
];

/** Everything Content enters, added for the Content-led export. */
const CONTENT_COLUMNS: [string, (c: Campaign) => unknown][] = [
  ["Header",          (c) => c.header],
  ["PN Type",         (c) => c.pn_type],
  ["Sub Copy",        (c) => c.sub_copy_text],
  ["H Count",         (c) => c.h_count],
  ["S Count",         (c) => c.s_count],
  ["Reference Link",  (c) => c.reference_link],
  ["Creative Link",   (c) => c.creative_link],
  ["Content Status",  (c) => c.content_status],
  ["Content Submitted At", (c) => istDateTime(c.submitted_at)],
];

function toCsv(rows: Campaign[], columns: [string, (c: Campaign) => unknown][]): string {
  const head = columns.map(([h]) => esc(h)).join(",");
  const body = rows.map((c) => columns.map(([, get]) => esc(get(c))).join(","));
  return [head, ...body].join("\n");
}

export const incomingFromCategoryCsv = (rows: Campaign[]) => toCsv(rows, BASE_COLUMNS);

export const incomingFromContentCsv = (rows: Campaign[]) =>
  toCsv(rows, [...BASE_COLUMNS, ...CONTENT_COLUMNS]);

/** CRM_<section>_<YYYY-MM-DD>.csv, dated in IST. */
export function sectionFileName(section: string): string {
  const ist = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  return `CRM_${section}_${ist}.csv`;
}

export function downloadSection(csv: string, fileName: string) {
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = fileName; a.click();
  URL.revokeObjectURL(url);
}
