"use client";

import { supabase } from "@/lib/supabase";
import { STORAGE_FIELD, normaliseOptionValue } from "@/lib/pnDropdowns";

/**
 * Values CRM has added to a dropdown, stored in `custom_pn_options` so every
 * CRM user sees them.
 *
 * Cached per field for the session, because the grid renders one dropdown
 * per row and must not query once per cell.
 *
 * Every read FAILS SOFT: a missing table (migration 30 not run) or a network
 * error yields an empty list, so the dropdown still works from the JSON
 * alone. Adding a value must never be able to break the grid.
 */

const cache = new Map<string, string[]>();
const inflight = new Map<string, Promise<string[]>>();

export async function listCustomOptions(columnKey: string): Promise<string[]> {
  const field = STORAGE_FIELD[columnKey];
  if (!field) return [];
  const hit = cache.get(field);
  if (hit) return hit;

  // Collapse concurrent reads from many cells into one request.
  const pending = inflight.get(field);
  if (pending) return pending;

  const p = (async () => {
    const { data, error } = await supabase
      .from("custom_pn_options")
      .select("value")
      .eq("field", field)
      .order("added_at", { ascending: true });
    if (error) {
      // Table absent or unreachable: fall back to the JSON list silently.
      cache.set(field, []);
      return [];
    }
    const vals = (data ?? []).map((r) => String(r.value));
    cache.set(field, vals);
    return vals;
  })().finally(() => inflight.delete(field));

  inflight.set(field, p);
  return p;
}

/**
 * Adds one value. Returns the stored value so the caller can select it.
 *
 * The unique index on (field, lower(value)) is the real guard: the UI
 * rejects duplicates first, but two users adding the same code at once
 * would otherwise both succeed.
 */
export async function addCustomOption(
  columnKey: string, value: string, profileId: string
): Promise<string> {
  const field = STORAGE_FIELD[columnKey];
  if (!field) throw new Error("This field does not accept new values.");

  const clean = value.trim().toLowerCase();
  if (!clean) throw new Error("Enter a value.");

  const { error } = await supabase
    .from("custom_pn_options")
    .insert({ field, value: clean, added_by: profileId });

  if (error) {
    if (/duplicate key|unique/i.test(error.message)) {
      throw new Error(`"${clean}" already exists.`);
    }
    if (/does not exist|schema cache/i.test(error.message)) {
      throw new Error(
        "Custom options are not set up yet — migration 30 has not been run.");
    }
    throw error;
  }

  // Keep the cache in step rather than re-reading.
  const current = cache.get(field) ?? [];
  if (!current.some((v) => normaliseOptionValue(v) === clean)) {
    cache.set(field, [...current, clean]);
  }
  return clean;
}

/** Drops the cache, for after an add from another surface. */
export const clearCustomOptionCache = () => cache.clear();
