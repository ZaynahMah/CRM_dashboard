"use client";

import type { Campaign } from "@/types/campaign";
import { slotDisplay } from "@/lib/format";

/**
 * Category's own export: the PNs this team has SUBMITTED back to CRM.
 *
 * Read-only. Reuses the CSV approach of `exportExcel.ts` — despite its
 * name, that file has always produced CSV, and there is no xlsx writer in
 * the repo. Excel opens this directly, with a BOM so UTF-8 renders.
 *
 * Scope is whatever rows the caller passes, which are already the rows the
 * Category view is showing. Permissions are not re-implemented here: RLS
 * (migration 17) and the existing handoff filter decide what Category can
 * see, so a user cannot export another team's rows.
 */

/** Submitted means Category locked it and sent it back to CRM. */
export const isSubmittedByCategory = (c: Campaign) =>
  (c.category_status === "LOCKED" || c.category_status === "SUBMITTED")
  && !c.defaulted_at;

const esc = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** DD-MM-YYYY, as specified. */
const ddmmyyyy = (iso: string | null | undefined): string => {
  if (!iso) return "";
  const m = String(iso).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
};

/** 12-hour time, matching how the dashboard shows it. */
const hhmm = (t: string | null | undefined): string => {
  if (!t) return "";
  const [h, m] = String(t).split(":").map(Number);
  if (Number.isNaN(h)) return "";
  const ampm = h >= 12 ? "PM" : "AM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:${String(m ?? 0).padStart(2, "0")} ${ampm}`;
};

const istStamp = (iso: string | null | undefined): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
};

/**
 * Readable headers, in the order the dashboard shows them: CRM's uploaded
 * columns first, then Category's own, then status.
 */
const COLUMNS: [string, (c: Campaign) => unknown][] = [
  // ── CRM input ──
  ["Date",          (c) => ddmmyyyy(c.launch_date)],
  ["Time",          (c) => hhmm(c.launch_time)],
  // The RAW uploaded Slot. Never slot_type, never "Standard".
  ["Slot",          (c) => slotDisplay(c)],
  ["Segment",       (c) => c.pncc_segment_label],
  ["Category",      (c) => c.category ?? c.pncc_category_code],
  // ── Category input ──
  ["Campaign Name", (c) => c.campaign_name],
  ["Sub Category",  (c) => c.sub_category],
  ["Brand",         (c) => c.brand],
  ["Offer",         (c) => c.offer],
  ["Brief",         (c) => c.brief],
  ["Landing",       (c) => c.landing],
  ["Exp. CVR",      (c) => c.expected_cvr],
  ["Exp. RPV",      (c) => c.expected_rpv],
  ["Comment",       (c) => c.additional_notes],
  // ── status ──
  ["Status",        (c) => (c.category_status === "LOCKED" ? "Submitted" : "Submitted")],
  // No per-person column exists on campaigns, so this reports the TEAM
  // rather than inventing a name.
  ["Submitted By",  () => "Category"],
  ["Submitted At",  (c) => istStamp(c.submitted_at)],
];

export function categorySubmittedCsv(rows: Campaign[]): string {
  const head = COLUMNS.map(([h]) => esc(h)).join(",");
  const body = rows.map((c) => COLUMNS.map(([, get]) => esc(get(c))).join(","));
  return [head, ...body].join("\n");
}

/** <Category>_Submitted_PNs_<DD-MM-YYYY>.csv */
export function categoryFileName(rows: Campaign[]): string {
  const cats = [...new Set(rows.map((c) => (c.category ?? "").trim()).filter(Boolean))];
  // One category gets its name; a mixed set says so rather than picking one.
  const label = cats.length === 1 ? cats[0] : "All_Categories";
  const now = new Date();
  const d = now.toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata" }).replace(/\//g, "-");
  return `${label.replace(/[^A-Za-z0-9]+/g, "_")}_Submitted_PNs_${d}.csv`;
}

export function downloadCategoryExport(csv: string, fileName: string) {
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = fileName; a.click();
  URL.revokeObjectURL(url);
}
