"use client";

import type { Campaign } from "@/types/campaign";

/**
 * Export campaigns to a downloadable CSV (opens fine in Excel; a native
 * .xlsx binary isn't generated, see the README). Every field read here is a
 * real, typed Campaign column — no `as any` casts, so a schema mismatch
 * would be a compile error instead of a silently-empty column.
 */
const COLUMNS = [
  "Date","TIME","SLOT","SEGMENTS","CATEGORY","SUB CATEGORY","BRAND","OFFER",
  "Category Briefs","Title Brief","Message Brief","PN Template","creative requirements",
  "HEADER","SUB COPY","H COUNT","S COUNT","Reference Link","Slots","Creative links",
  "Landing links","COLLAPSE ID","OPS DETAILS","SOUND","GL",
  "Campaign Type","Campaign name","Channel Name","Channel Format",
  "Segment 1","Segment 2","Category","SubCategory","Brand","Landing","Offer",
  "Time","Date(ddmmyy)","Keywords","CID","Campaign ID","Tracking Code",
  "Landing Link + Tracking Code","Tracking Code check",
  "Feedback 1","Feedback 2"
];

function fmtDateDDMMYY(d: string): string {
  if (!d) return "";
  const [y, m, dd] = d.split("-");
  return `${dd}${m}${y?.slice(2)}`;
}

function fmtTime12(t: string | null): string {
  if (!t) return "";
  const [hh, mm] = t.split(":").map(Number);
  const suffix = hh >= 12 ? "PM" : "AM";
  const h = hh % 12 === 0 ? 12 : hh % 12;
  return `${h}:${String(mm).padStart(2, "0")} ${suffix}`;
}

function escape(v: string): string {
  if (v.includes(",") || v.includes('"') || v.includes("\n")) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

export function campaignsToCSV(campaigns: Campaign[]): string {
  const header = COLUMNS.map(escape).join(",");
  const rows = campaigns.map((c) => {
    const vals: (string | number | boolean | null)[] = [
      c.launch_date ?? "",
      fmtTime12(c.launch_time),
      c.slot_type ?? "STANDARD",
      c.pncc_segment_label ?? c.audience ?? "",
      c.pncc_category_code ?? c.category ?? "",
      c.sub_category ?? "",
      c.brand ?? "",
      c.offer ?? "",
      c.brief ?? "",
      c.title_brief ?? "",
      c.message_brief ?? "",
      c.pn_template ?? "",
      c.creative_requirements ?? "",
      c.header ?? "",
      c.sub_copy_text ?? "",
      c.h_count ?? "",
      c.s_count ?? "",
      c.reference_link ?? "",
      c.slot_type ?? "",
      c.creative_link ?? "",
      c.landing ?? "",
      c.collapse ?? c.collapse_id ?? "",
      c.ops_details ?? "",
      c.sound ? "Yes" : "No",
      c.global_limit ? "Yes" : "",
      c.campaign_type ?? "",
      c.campaign_name ?? "",
      c.channel_name ?? c.channel ?? "PN",
      c.channel_format ?? "",
      c.segment_1 ?? "",
      c.segment_2 ?? "",
      c.category ?? "",
      c.sub_category ?? "",
      c.brand ?? "",
      c.landing ?? "",
      c.offer ?? "",
      fmtTime12(c.launch_time),
      c.date_ddmmyy || fmtDateDDMMYY(c.launch_date),
      c.keywords ?? "",
      c.cid ?? "",
      c.campaign_id_ext ?? "",
      c.tracking_code ?? "",
      c.landing_plus_tracking || (c.landing && c.tracking_code ? `${c.landing}?${c.tracking_code}` : ""),
      c.tracking_code_check ?? "",
      c.feedback_1 ?? "",
      c.feedback_2 ?? "",
    ];
    return vals.map((v) => escape(String(v ?? ""))).join(",");
  });
  return [header, ...rows].join("\n");
}

export function downloadCSV(campaigns: Campaign[], filename: string) {
  const csv = campaignsToCSV(campaigns);
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
