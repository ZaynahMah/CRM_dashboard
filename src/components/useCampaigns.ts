"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { listCampaigns } from "@/services/campaigns";
import { supabase } from "@/lib/supabase";
import { applyRealtimeUpdate } from "./realtimeMerge";
import type { Campaign } from "@/types/campaign";

/**
 * Ids with unsaved edits open somewhere on the page. The workspace registers
 * its dirty rows here so a realtime push cannot overwrite what someone is
 * still typing (#11). Module-level because the workspace and the hook are
 * not in the same component tree.
 */
const dirtyRows = new Set<string>();
const dirtyListeners = new Set<() => void>();

export function markRowDirty(id: string, dirty: boolean) {
  const had = dirtyRows.has(id);
  if (dirty) dirtyRows.add(id); else dirtyRows.delete(id);
  if (had !== dirty) dirtyListeners.forEach((fn) => fn());
}

export function isRowDirty(id: string) { return dirtyRows.has(id); }

/**
 * Set when CRM resets the dashboard, so every component can clear itself.
 * Module-level because the workspace, the drawer and the hook are not in one
 * component tree.
 */
let resetNotice: string | null = null;
const resetListeners = new Set<(msg: string) => void>();

export function onDashboardReset(fn: (msg: string) => void) {
  resetListeners.add(fn);
  return () => { resetListeners.delete(fn); };
}

export const RESET_DISCARD_MESSAGE =
  "Data was reset by CRM \u2014 your unsaved changes were discarded.";

export function getResetNotice() { return resetNotice; }
export function clearResetNotice() { resetNotice = null; }

export function useCampaigns(filters: Record<string, string | boolean> = {}) {
  const key = JSON.stringify(filters);
  /**
   * A topic unique to this hook instance. A hardcoded name is a real bug
   * here: during client-side navigation the outgoing page is still mounted
   * while the incoming one mounts, and in dev StrictMode effects run twice —
   * so two instances would share one topic, and the first unmount's
   * removeChannel would tear down the channel the second is using. Realtime
   * then silently stops working after the first navigation.
   */
  const channelId = useId();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /**
   * Rows a realtime push arrived for while they had unsaved edits. The UI
   * shows "Changed by someone else — reload row" instead of silently
   * replacing the user's work.
   */
  const [staleRows, setStaleRows] = useState<Set<string>>(new Set());
  // Read inside the subscription callback, which closes over its first value.
  const staleRef = useRef<Set<string>>(new Set());

  const reload = useCallback(async () => {
    try {
      setError(null);
      setCampaigns(await listCampaigns(JSON.parse(key)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load campaigns.");
    } finally { setLoading(false); }
  }, [key]);

  useEffect(() => { reload(); }, [reload]);

  /**
   * Live updates. CRM and Content work the same campaigns, so each must
   * see the other's edits without reloading — CRM should see copy land as
   * soon as Content submits.
   *
   * Supabase Realtime pushes the changed row; we patch it in place by id
   * rather than refetching, so an in-progress edit elsewhere on the page is
   * not blown away. An INSERT or DELETE is rare enough that a full reload
   * is the simpler correct answer.
   *
   * NOTE: this requires Realtime to be enabled for the `campaigns` table in
   * the Supabase dashboard (Database > Replication). Without it the
   * subscription simply never fires and the app behaves exactly as before —
   * no errors, no broken screens, just no live updates.
   */
  useEffect(() => {
    const channel = supabase
      .channel(`campaigns-live:${channelId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "campaigns" },
        (payload) => {
          const row = payload.new as Campaign;
          if (!row?.id) return;

          // One rule, defined and tested in realtimeMerge.ts: a row with
          // unsaved edits is flagged stale, never overwritten.
          setCampaigns((prev) => {
            const { rows, stale } = applyRealtimeUpdate(prev, row, dirtyRows, staleRef.current);
            if (stale.size !== staleRef.current.size) {
              staleRef.current = stale;
              setStaleRows(stale);
            }
            return rows;
          });
        })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "campaigns" },
        () => { reload(); })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "campaigns" },
        () => { reload(); })
      /**
       * The reset signal (migration 20). A mass DELETE does not reliably
       * deliver one event per row, so this is the authoritative "everything
       * is gone" notification. reset_events is readable by every role,
       * unlike upload_reset_batches, which is CRM-only.
       */
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "reset_events" },
        () => {
          // Drop every old row immediately rather than waiting for the
          // refetch, so no stale PN is on screen for even a moment.
          setCampaigns([]);
          staleRef.current = new Set();
          setStaleRows(new Set());
          // Anyone mid-edit is told their work went, rather than having it
          // vanish silently.
          const hadEdits = dirtyRows.size > 0;
          dirtyRows.clear();
          dirtyListeners.forEach((fn) => fn());
          if (hadEdits) {
            resetNotice = RESET_DISCARD_MESSAGE;
            resetListeners.forEach((fn) => fn(RESET_DISCARD_MESSAGE));
          } else {
            resetListeners.forEach((fn) => fn(""));
          }
          reload();
        })
      .subscribe();

    // Unsubscribes and removes the channel from the client's registry, so
    // nothing is left listening and no reference to this component's state
    // setter survives the unmount.
    return () => { supabase.removeChannel(channel); };
  }, [reload, channelId]);

  /** Pulls the server's version of one row, discarding local edits for it. */
  const reloadRow = useCallback(async (id: string) => {
    const fresh = await listCampaigns(JSON.parse(key));
    const row = fresh.find((c) => c.id === id);
    if (row) setCampaigns((prev) => prev.map((c) => (c.id === id ? row : c)));
    markRowDirty(id, false);
    setStaleRows((prev) => { const n = new Set(prev); n.delete(id); return n; });
  }, [key]);

  return { campaigns, loading, error, reload, staleRows, reloadRow };
}
