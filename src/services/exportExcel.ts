"use client";

import type { Campaign } from "@/types/campaign";

/**
 * Export campaigns to a downloadable Excel (CSV for now — xlsx library
 * can be added later, but CSV opens in Excel and keeps the build small).
 */
const COLUMNS = [
  "Date","TIME","SLOT","SEGMENTS","CATEGORY","SUB CATEGORY","BRAND","OFFER",
  "Category Briefs","Title Brief","Message Brief","PN Template","creative requirements",
  "HEADER","SUB COPY","H COUNT","S COUNT","Reference Link","Slots","Creative links",
  "Landing links","COLLAPSE","OPS DETAILS","SOUND","GL",
  "Campaign Type","Campaign name","Channel Name","Channel Format",
  "Segment 1","Segment 2","Category","SubCategory","Brand","Landing","Offer",
  "Time","Date(ddmmyy)","Keywords","CID","Campaign ID","Tracking Code",
  "Landing Link + Tracking Code","Tracking Code check",
  "Smit's Feedback","Nazia's Feedback"
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
    const vals = [
      c.launch_date ?? "",
      fmtTime12(c.launch_time),
      c.slot_type ?? "STANDARD",
      c.pncc_segment_label ?? c.audience ?? "",
      c.pncc_category_code ?? c.category ?? "",
      c.sub_category ?? "",
      c.brand ?? "",
      c.offer ?? "",
      c.brief ?? "",
      (c as any).title_brief ?? "",
      (c as any).message_brief ?? "",
      c.pn_template ?? "",
      c.creative_requirements ?? "",
      (c as any).header ?? "",
      (c as any).sub_copy ?? "",
      (c as any).h_count ?? "",
      (c as any).s_count ?? "",
      c.reference_link ?? "",
      c.slot_type ?? "",
      c.creative_link ?? "",
      c.landing ?? "",
      c.collapse_id ?? "",
      (c as any).ops_details ?? "",
      c.sound ? "Yes" : "No",
      c.global_limit ? "Yes" : "",
      c.campaign_type ?? "",
      c.campaign_name ?? "",
      c.channel ?? "PN",
      "",
      c.segment_1 ?? "",
      c.segment_2 ?? "",
      c.category ?? "",
      c.sub_category ?? "",
      c.brand ?? "",
      c.landing ?? "",
      c.offer ?? "",
      fmtTime12(c.launch_time),
      fmtDateDDMMYY(c.launch_date),
      "",
      c.cid ?? "",
      c.campaign_id_ext ?? "",
      c.tracking_code ?? "",
      c.landing && c.tracking_code ? `${c.landing}?${c.tracking_code}` : "",
      "",
      (c as any).smit_feedback ?? "",
      (c as any).nazia_feedback ?? "",
    ];
    return vals.map((v) => escape(String(v))).join(",");
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
