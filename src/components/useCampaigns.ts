"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { listCampaigns } from "@/services/campaigns";
import { supabase } from "@/lib/supabase";
import type { Campaign } from "@/types/campaign";

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
   * Live updates. Content and Design work the same campaigns in parallel,
   * so each must see the other's edits without reloading — Design should
   * see copy land, Content should see the creative link appear.
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
          setCampaigns((prev) => {
            const i = prev.findIndex((c) => c.id === row.id);
            if (i === -1) return prev;            // not in this filtered view
            const next = [...prev];
            next[i] = { ...next[i], ...row };
            return next;
          });
        })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "campaigns" },
        () => { reload(); })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "campaigns" },
        () => { reload(); })
      .subscribe();

    // Unsubscribes and removes the channel from the client's registry, so
    // nothing is left listening and no reference to this component's state
    // setter survives the unmount.
    return () => { supabase.removeChannel(channel); };
  }, [reload, channelId]);

  return { campaigns, loading, error, reload };
}
