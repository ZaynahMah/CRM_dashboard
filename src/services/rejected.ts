"use client";

import { supabase } from "@/lib/supabase";
import type { Campaign } from "@/types/campaign";

/**
 * PNs CRM sent back to Category with "Request Changes".
 *
 * There is no column for this, by decision: the fact lives in
 * `activity_logs`. A PN is REJECTED when
 *
 *   category_status = 'DRAFT'
 *   AND its most recent relevant activity is CRM_REQUESTED_CHANGES
 *       (i.e. no CATEGORY_SUBMITTED after it)
 *
 * ONE query for the whole board, not one per PN: every relevant activity row
 * is fetched in a single call and reduced in memory. At ~3k PNs that is one
 * round trip and a linear pass, rather than 3,000 requests.
 */

export const REJECT_ACTION = "CRM_REQUESTED_CHANGES";
/** Actions that END a rejection — Category has acted on it. */
export const RESUBMIT_ACTIONS = ["CATEGORY_SUBMITTED", "CATEGORY_LOCKED"];

export interface RejectionInfo {
  campaignId: string;
  /** CRM's reason, exactly as typed. */
  reason: string;
  /** The typed name, when the entry carries one. */
  byName: string | null;
  at: string;
}

/** Pulls "CRM (Name) requested changes: reason" back apart. */
export function parseRejection(description: string): { byName: string | null; reason: string } {
  const withName = /^CRM \(([^)]+)\) requested changes:\s*([\s\S]*)$/.exec(description);
  if (withName) return { byName: withName[1].trim(), reason: withName[2].trim() };
  // Entries written before the typed name was mandatory.
  const plain = /^CRM requested changes:\s*([\s\S]*)$/.exec(description);
  return { byName: null, reason: (plain ? plain[1] : description).trim() };
}

/**
 * The latest rejection per campaign, for every campaign, in ONE query.
 *
 * Rows come back newest-first, so the first entry seen for a campaign is its
 * latest. A resubmit seen before a rejection means the rejection is already
 * answered and the PN is no longer rejected.
 */
export async function loadRejections(): Promise<Map<string, RejectionInfo>> {
  const { data, error } = await supabase
    .from("activity_logs")
    .select("campaign_id, action, description, created_at")
    .in("action", [REJECT_ACTION, ...RESUBMIT_ACTIONS])
    .order("created_at", { ascending: false });

  const out = new Map<string, RejectionInfo>();
  if (error || !data) return out;

  const settled = new Set<string>();
  for (const row of data as {
    campaign_id: string | null; action: string;
    description: string | null; created_at: string;
  }[]) {
    const id = row.campaign_id;
    if (!id || settled.has(id)) continue;      // an older entry: ignore
    settled.add(id);                           // first seen = latest
    if (row.action !== REJECT_ACTION) continue; // answered by a resubmit
    const { byName, reason } = parseRejection(row.description ?? "");
    out.set(id, { campaignId: id, reason, byName, at: row.created_at });
  }
  return out;
}

/**
 * Is this PN currently rejected?
 *
 * Both halves must hold: a DRAFT whose latest activity is a rejection. A PN
 * Category has since resubmitted is LOCKED/SUBMITTED and fails the first
 * test anyway, so the two agree.
 */
export const isRejected = (c: Campaign, rejections: Map<string, RejectionInfo>) =>
  c.category_status === "DRAFT" && rejections.has(c.id);

/** Rejected PNs only. */
export const rejectedOnly = (
  rows: Campaign[], rejections: Map<string, RejectionInfo>
) => rows.filter((c) => isRejected(c, rejections));

/**
 * "Pending your input" EXCLUDES rejected PNs — they have their own tab, so a
 * PN never appears in both.
 */
export const pendingExcludingRejected = (
  rows: Campaign[], rejections: Map<string, RejectionInfo>
) => rows.filter((c) => !isRejected(c, rejections));

/** The typed name on Request Changes, remembered per browser. */
const NAME_KEY = "cliq.reject.name";
export const rememberedRejectName = () => {
  try { return localStorage.getItem(NAME_KEY) ?? ""; } catch { return ""; }
};
export const rememberRejectName = (n: string) => {
  try { localStorage.setItem(NAME_KEY, n.trim()); } catch { /* ignore */ }
};
