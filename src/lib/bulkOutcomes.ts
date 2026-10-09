import type { Campaign } from "@/types/campaign";
import type { BulkCalendarOutcome } from "@/services/campaigns";

/**
 * The per-row submit/lock rule from RoleQueue, extracted so it is testable.
 *
 * The bug this replaces: a bare `for (const id of ids) { await submit(id) }`
 * with no per-row handling. The first throw aborted the loop, so every row
 * after it was never attempted — Content pressed Submit on 5 PNs, one
 * failed, and CRM saw 2. Each row now succeeds or fails on its own, and
 * every failure names its PN.
 */
export async function runPerRow(
  ids: string[],
  campaigns: Campaign[],
  action: (c: Campaign) => Promise<void>,
  validate?: (c: Campaign) => string | null
): Promise<BulkCalendarOutcome[]> {
  const outcomes: BulkCalendarOutcome[] = [];
  for (const id of ids) {
    const c = campaigns.find((x) => x.id === id);
    const name = c?.campaign_name ?? id;
    try {
      if (!c) throw new Error("This campaign is no longer in your queue — reload and try again.");
      const problem = validate?.(c);
      if (problem) throw new Error(problem);
      await action(c);
      outcomes.push({ campaignId: id, campaignName: name, ok: true });
    } catch (e) {
      outcomes.push({
        campaignId: id, campaignName: name, ok: false,
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return outcomes;
}

/** Content cannot submit without copy. Mirrors RoleQueue's check. */
export const contentSubmitProblem = (c: Campaign): string | null =>
  !(c.header ?? "").trim() || !(c.sub_copy_text ?? "").trim()
    ? "Header and Sub Copy are both required before submitting."
    : null;

/** Batching rule from BulkWorkspace: every item written, 500 at a time. */
export async function inBatchesOf<T>(
  items: T[], size: number, fn: (item: T) => Promise<unknown>
): Promise<number> {
  let batches = 0;
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
    batches++;
  }
  return batches;
}
