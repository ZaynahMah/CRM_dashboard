"use client";

import { useCallback, useEffect, useState } from "react";
import { listCampaigns } from "@/services/campaigns";
import type { Campaign } from "@/types/campaign";

export function useCampaigns(filters: Record<string, string | boolean> = {}) {
  const key = JSON.stringify(filters);
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
  return { campaigns, loading, error, reload };
}
