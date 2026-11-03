"use client";

import { supabase } from "@/lib/supabase";
import type { Campaign } from "@/types/campaign";

/**
 * Multi-field change requests (migration 38).
 *
 * Category and Content do not edit a submitted PN directly: they propose
 * changes, and nothing on the PN moves until CRM accepts. Every rule —
 * which fields a team owns, the 60/200 limits, the seven Category fields
 * that may not be blanked, the calendar block — is enforced again in
 * Postgres by `raise_change_request`, so the UI cannot be bypassed.
 */

export const CATEGORY_EDITABLE = [
  "sub_category", "brand", "offer", "brief", "landing",
  "expected_cvr", "expected_rpv", "additional_notes", "date_time_brief",
] as const;

export const CONTENT_EDITABLE = [
  "header", "sub_copy_text", "reference_link",
] as const;

export const FIELD_LABEL: Record<string, string> = {
  sub_category: "Sub Category", brand: "Brand", offer: "Offer",
  brief: "Category Brief", landing: "Landing Link",
  expected_cvr: "Expected CVR", expected_rpv: "Expected RPV",
  additional_notes: "Comments", date_time_brief: "Date / Time Brief",
  header: "Header", sub_copy_text: "Sub Copy", reference_link: "Reference Link",
};

/** Fields the seven-field rule protects: a request may never blank these. */
const CATEGORY_MANDATORY = new Set([
  "sub_category", "brand", "offer", "brief", "landing",
  "expected_cvr", "expected_rpv",
]);

export type RequestStatus = "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN";

export interface ChangeRequestRow {
  id: string;
  campaign_id: string;
  request_group_id: string | null;
  field_name: string;
  current_value: string | null;
  requested_value: string | null;
  reason: string | null;
  status: string;
  requested_by_name: string | null;
  requested_by_role: string | null;
  reviewed_by_name: string | null;
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
}

/** Which fields this role may propose on this PN. */
export function editableFieldsFor(role: string): readonly string[] {
  if (role === "CATEGORY") return CATEGORY_EDITABLE;
  if (role === "CONTENT") return CONTENT_EDITABLE;
  return [];
}

/** Why Edit input is unavailable, or undefined when it is available. */
export function editGate(c: Campaign, role: string): string | undefined {
  if (c.calendar_status === "UPDATED") return "On calendar";
  if (role === "CATEGORY") {
    if (!c.category_submitted_at) return "Not submitted yet — edit it directly";
    /**
     * Category's window closes when CRM hands the PN to Content.
     *
     * `content_status` is the marker, not `crm_status`: crm_status keeps
     * advancing (SENT_TO_CONTENT → FINAL_QC → READY), so an equality test
     * on it would re-open the gate at Final QC. `content_status` leaves
     * NOT_ASSIGNED in the same write as the handoff and never returns.
     * Migration 42 enforces exactly this rule server-side.
     */
    if (c.content_status !== "NOT_ASSIGNED") return "Already sent to Content. Ask CRM.";
    return undefined;
  }
  if (role === "CONTENT") {
    return c.content_submitted_at
      ? undefined
      : "Not submitted yet — edit it directly";
  }
  return "Your role cannot raise change requests";
}

/**
 * Client-side validation. The same rules run again in Postgres; this exists
 * so the user sees the problem before a round trip, never instead of it.
 */
export function validateRequest(
  fields: Record<string, string>, role: string
): string[] {
  const problems: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    const label = FIELD_LABEL[k] ?? k;
    if (role === "CATEGORY" && CATEGORY_MANDATORY.has(k) && v.trim() === "") {
      problems.push(`${label} is required and cannot be left empty.`);
    }
    if (k === "header" && v.length > 60) {
      problems.push(`Header is ${v.length} characters, over the 60 limit.`);
    }
    if (k === "sub_copy_text" && v.length > 200) {
      problems.push(`Sub Copy is ${v.length} characters, over the 200 limit.`);
    }
  }
  if (Object.keys(fields).length === 0) problems.push("Nothing has changed.");
  return problems;
}

/** Only the fields that actually differ, trimmed-compared. */
export function changedFields(
  c: Campaign, draft: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(draft)) {
    const before = String((c as unknown as Record<string, unknown>)[k] ?? "");
    if (before.trim() !== v.trim()) out[k] = v;
  }
  return out;
}

const friendly = (e: { message?: string } | null) => {
  const m = e?.message ?? "";
  if (/does not exist|schema cache/i.test(m)) {
    return new Error("Change requests are not set up yet — migration 38 has not been run.");
  }
  return new Error(m || "The change request could not be saved.");
};

export async function raiseChangeRequest(
  campaignId: string, fields: Record<string, string>,
  byName: string, reason?: string
): Promise<string> {
  const { data, error } = await supabase.rpc("raise_change_request", {
    p_campaign_id: campaignId,
    p_fields: fields,
    p_by_name: byName.trim(),
    p_reason: reason?.trim() || null,
  });
  if (error) throw friendly(error);
  return String(data);
}

export async function decideChangeGroup(
  groupId: string, accept: boolean, byName: string, note?: string
): Promise<number> {
  const { data, error } = await supabase.rpc("decide_change_group", {
    p_group_id: groupId,
    p_accept: accept,
    p_by_name: byName.trim(),
    p_note: note?.trim() || null,
  });
  if (error) throw friendly(error);
  return Number(data ?? 0);
}

export async function withdrawChangeGroup(
  groupId: string, byName: string
): Promise<number> {
  const { data, error } = await supabase.rpc("withdraw_change_group", {
    p_group_id: groupId, p_by_name: byName.trim(),
  });
  if (error) throw friendly(error);
  return Number(data ?? 0);
}


export interface RequestFilters {
  status?: RequestStatus;
  /** Campaign ids to keep — resolved from the category filter. */
  campaignIds?: string[];
  from?: string;
  to?: string;
}

/**
 * Requests for one status, newest first.
 *
 * Filtering happens IN THE QUERY, not per row: with many requests a
 * client-side pass would fetch everything and then discard most of it.
 * RLS (migration 42) already limits each team to its own rows.
 */
export async function listRequests(
  filters: RequestFilters = {}
): Promise<ChangeRequestRow[]> {
  let q = supabase.from("change_requests").select("*");
  if (filters.status) q = q.eq("status", filters.status);
  if (filters.campaignIds) {
    if (filters.campaignIds.length === 0) return [];   // nothing can match
    q = q.in("campaign_id", filters.campaignIds);
  }
  if (filters.from) q = q.gte("created_at", `${filters.from}T00:00:00`);
  if (filters.to) q = q.lte("created_at", `${filters.to}T23:59:59`);

  const { data, error } = await q.order("created_at", { ascending: false });
  if (error) {
    if (/does not exist|column/i.test(error.message)) return [];
    throw error;
  }
  return (data ?? []) as ChangeRequestRow[];
}

/** Pending requests, newest first. RLS limits what each role sees. */
export async function listPendingRequests(): Promise<ChangeRequestRow[]> {
  const { data, error } = await supabase
    .from("change_requests").select("*")
    .eq("status", "PENDING")
    .order("created_at", { ascending: false });
  if (error) {
    if (/does not exist|column/i.test(error.message)) return [];
    throw error;
  }
  return (data ?? []) as ChangeRequestRow[];
}

/** One request per group, with its fields together. */
export interface ChangeRequestGroup {
  groupId: string;
  campaignId: string;
  team: string;
  byName: string;
  createdAt: string;
  reason: string | null;
  rows: ChangeRequestRow[];
}

export function groupRequests(rows: ChangeRequestRow[]): ChangeRequestGroup[] {
  const byGroup = new Map<string, ChangeRequestGroup>();
  for (const r of rows) {
    // A row from before migration 38 has no group; it stands alone.
    const key = r.request_group_id ?? `single:${r.id}`;
    let g = byGroup.get(key);
    if (!g) {
      g = {
        groupId: r.request_group_id ?? "",
        campaignId: r.campaign_id,
        team: r.requested_by_role ?? "—",
        byName: r.requested_by_name ?? "—",
        createdAt: r.created_at,
        reason: r.reason,
        rows: [],
      };
      byGroup.set(key, g);
    }
    g.rows.push(r);
  }
  return [...byGroup.values()];
}

/** Remembered per browser so the name is typed once. */
const NAME_KEY = "cliq.changeRequest.name";
export const rememberedRequestName = () => {
  try { return localStorage.getItem(NAME_KEY) ?? ""; } catch { return ""; }
};
export const rememberRequestName = (n: string) => {
  try { localStorage.setItem(NAME_KEY, n.trim()); } catch { /* ignore */ }
};


/* ─────────────── the latest decision on a PN, for its badge ─────────────── */

export interface PnRequestBadge {
  status: RequestStatus;
  label: string;
  tone: "warning" | "success" | "danger";
  reason: string | null;
}

/** The newest request per campaign, whatever its status. */
export function latestByCampaign(
  rows: ChangeRequestRow[]
): Map<string, ChangeRequestRow> {
  const out = new Map<string, ChangeRequestRow>();
  // Rows arrive newest-first, so the first seen per campaign is its latest.
  for (const r of rows) if (!out.has(r.campaign_id)) out.set(r.campaign_id, r);
  return out;
}

export function badgeFor(r: ChangeRequestRow | undefined): PnRequestBadge | null {
  if (!r) return null;
  switch (r.status) {
    case "PENDING":
      return { status: "PENDING", label: "Change pending CRM approval",
               tone: "warning", reason: null };
    case "APPROVED":
      return { status: "APPROVED", label: "Change accepted by CRM",
               tone: "success", reason: null };
    case "REJECTED":
      return { status: "REJECTED",
               label: `Change rejected by CRM${r.review_note ? `: ${r.review_note}` : ""}`,
               tone: "danger", reason: r.review_note };
    default:
      return null;                      // WITHDRAWN needs no badge
  }
}

/**
 * Decisions this team has not opened yet.
 *
 * A localStorage high-water mark, deliberately: counting unseen decisions
 * needs persistence, and a column would mean a migration for a badge whose
 * usefulness is still unproven. It resets per browser, which is the
 * trade-off.
 */
const SEEN_KEY = "cliq.changes.seenAt";
export const changesSeenAt = () => {
  try { return localStorage.getItem(SEEN_KEY) ?? ""; } catch { return ""; }
};
export const markChangesSeen = () => {
  try { localStorage.setItem(SEEN_KEY, new Date().toISOString()); } catch { /* ignore */ }
};

/** How many decisions landed since this browser last opened Changes. */
export function unseenDecisions(rows: ChangeRequestRow[], seenAt: string): number {
  if (!seenAt) return 0;
  return rows.filter((r) =>
    r.status !== "PENDING" && (r.reviewed_at ?? r.created_at) > seenAt).length;
}
