import type { Campaign } from "@/types/campaign";

/**
 * How a realtime UPDATE is applied to the list in `useCampaigns` (#11).
 *
 * Extracted so the rule is testable without mounting React: a row that
 * somebody is editing is NEVER overwritten. It is flagged stale instead, and
 * the user reloads that one row when they are ready. Clean rows update live.
 */
export interface MergeResult {
  rows: Campaign[];
  /** Ids that changed on the server while they had unsaved local edits. */
  stale: Set<string>;
}

export function applyRealtimeUpdate(
  rows: Campaign[],
  incoming: Partial<Campaign> & { id?: string },
  dirtyIds: ReadonlySet<string>,
  stale: ReadonlySet<string> = new Set()
): MergeResult {
  const nextStale = new Set(stale);
  if (!incoming?.id) return { rows, stale: nextStale };

  // Unsaved edits win. Losing someone's typing to a background push is worse
  // than showing them a slightly old row with a reload badge.
  if (dirtyIds.has(incoming.id)) {
    nextStale.add(incoming.id);
    return { rows, stale: nextStale };
  }

  const i = rows.findIndex((c) => c.id === incoming.id);
  if (i === -1) return { rows, stale: nextStale };   // not in this filtered view

  const next = [...rows];
  next[i] = { ...next[i], ...incoming } as Campaign;
  return { rows: next, stale: nextStale };
}
