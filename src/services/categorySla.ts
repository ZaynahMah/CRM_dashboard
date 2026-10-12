"use client";

import { supabase } from "@/lib/supabase";

/**
 * Category SLA, Activities and shared Notifications.
 *
 * Three SEPARATE systems by requirement:
 *   category_sla         — state per category per business week
 *   activities           — the operational event log
 *   system_notifications — what people are told, shared by every role
 *
 * None of them touches campaigns, and nothing here can block campaign
 * movement: a default is recorded and surfaced, never enforced.
 */

export interface SlaRow {
  id: string;
  week_key: string;
  week_start: string;
  week_end: string;
  deadline: string;
  category: string;
  pn_count: number;
  submitted_count: number;
  status: string;
  submitted_at: string | null;
  defaulted_at: string | null;
  crm_filled_by: string | null;
  crm_filled_at: string | null;
}

export interface ActivityRow {
  id: string;
  occurred_at: string;
  event_type: string;
  category: string | null;
  week_key: string | null;
  details: string;
  actor_id: string | null;
}

export interface SystemNotification {
  id: string;
  created_at: string;
  kind: string;
  title: string;
  body: string;
  category: string | null;
  week_key: string | null;
}

export interface SlaSummary {
  on_time: number; due_soon: number; overdue: number;
  defaults_created: number; crm_overrides: number; total: number;
}

const PENDING =
  "Category SLA is not set up yet — contact your admin. Migration 24 is required.";

function isSetupPending(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null;
  const code = err?.code ?? "";
  const msg = (err?.message ?? "").toLowerCase();
  return code === "PGRST202" || code === "42P01" || code === "42703"
    || msg.includes("schema cache") || msg.includes("does not exist");
}

export class SlaSetupPendingError extends Error {
  constructor() { super(PENDING); this.name = "SlaSetupPendingError"; }
}

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) { if (isSetupPending(e)) throw new SlaSetupPendingError(); throw e; }
}

export const listSla = () => guard(async () => {
  const { data, error } = await supabase
    .from("category_sla").select("*")
    .order("week_start", { ascending: false }).order("category");
  if (error) throw error;
  return (data ?? []) as SlaRow[];
});

export const listActivities = (limit = 200) => guard(async () => {
  const { data, error } = await supabase
    .from("activities").select("*")
    .order("occurred_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []) as ActivityRow[];
});

export const listSystemNotifications = (limit = 50) => guard(async () => {
  const { data, error } = await supabase
    .from("system_notifications").select("*")
    .order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []) as SystemNotification[];
});

export const slaSummary = () => guard(async () => {
  const { data, error } = await supabase.rpc("category_sla_summary");
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as SlaSummary | null;
  return row ?? { on_time: 0, due_soon: 0, overdue: 0, defaults_created: 0, crm_overrides: 0, total: 0 };
});

export const slaTrend = () => guard(async () => {
  const { data, error } = await supabase.rpc("category_sla_trend");
  if (error) throw error;
  return (data ?? []) as { month: string; on_time: number; total: number; on_time_pct: number }[];
});

export const slaOffenders = () => guard(async () => {
  const { data, error } = await supabase.rpc("category_sla_offenders");
  if (error) throw error;
  return (data ?? []) as { category: string; missed: number; defaults: number; total: number }[];
});

/**
 * Recomputes every week's status and writes the activities and
 * notifications it implies. The nightly job; also callable by hand so an
 * operator never has to wait until midnight to see a correct board.
 */
export const recalculateSla = () => guard(async () => {
  const { error } = await supabase.rpc("recalculate_category_sla", {});
  if (error) throw error;
});

/** CRM records that it filled a defaulted week's category details. */
export const recordCrmOverride = (slaId: string) => guard(async () => {
  const { error } = await supabase.rpc("record_crm_sla_override", { p_sla_id: slaId });
  if (error) throw error;
});

/* ───────── Default Rate reporting (migration 25) ───────── */

/* ---------------- Default Rate reporting (migration 26) ---------------- */

export interface DefaultRateRow {
  category: string; on_time: number; overdue: number;
  defaulted: number; total_weeks: number; default_rate: number | null;
}
export interface OrgDefaultRate {
  total_weeks: number; defaulted_weeks: number;
  default_rate: number | null; categories: number; over_threshold: number;
}

export const defaultRateByCategory = () => guard(async () => {
  const { data, error } = await supabase.rpc("category_default_rate");
  if (error) throw error;
  return (data ?? []) as DefaultRateRow[];
});

export const orgDefaultRate = () => guard(async () => {
  const { data, error } = await supabase.rpc("org_default_rate");
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as OrgDefaultRate | null;
  return row ?? { total_weeks: 0, defaulted_weeks: 0, default_rate: 0, categories: 0, over_threshold: 0 };
});

export const defaultRateTrend = () => guard(async () => {
  const { data, error } = await supabase.rpc("default_rate_trend");
  if (error) throw error;
  return (data ?? []) as { month: string; defaulted: number; total: number; default_rate: number | null }[];
});

/** Fires threshold activities and notifications. Each crossing alerts once. */
export const evaluateThresholds = () => guard(async () => {
  const { error } = await supabase.rpc("evaluate_default_thresholds", {});
  if (error) throw error;
});
