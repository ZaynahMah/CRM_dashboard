"use client";

import { useCallback, useEffect, useState } from "react";
import {
  contentChangesForReview, acknowledgeContentChanges,
  type ContentChangeSummary,
} from "@/services/contentBulk";
import { DIFF_LABEL, type ContentDiffField } from "@/lib/contentExcel";
import { Button, Card, Pill, Empty } from "./ui";
import { Icon } from "./icons";
import { fmtDate } from "@/lib/format";

/**
 * "Changed Fields" — what Content altered, so CRM does not have to open
 * every row to find out. A NEW component; no CRM screen was modified.
 *
 * The diff is captured at import time, because once the copy is written the
 * previous value is gone and activity_logs records which campaign changed
 * but not which column.
 *
 * Acknowledging clears a campaign from the list, so this shows only what
 * CRM has not yet looked at.
 */
export function ContentChangesForCrm({ onChanged }: { onChanged?: () => void }) {
  const [rows, setRows] = useState<ContentChangeSummary[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRows(await contentChangesForReview()); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const ack = async (id: string) => {
    setBusy(id);
    try { await acknowledgeContentChanges(id); await load(); onChanged?.(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setBusy(null);
  };

  // Nothing to review is the normal state; an empty card would be noise.
  if (!loading && rows.length === 0 && !error) return null;

  return (
    <Card pad={false}>
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <div>
          <h3 className="font-display text-[15px] font-600 text-heading">Changed Fields</h3>
          <p className="text-micro text-faint">
            What Content edited since you last looked. No need to open each row.
          </p>
        </div>
        <Pill dot={false} label={`${rows.length} campaign${rows.length === 1 ? "" : "s"}`} tone="indigo" />
      </div>

      {error && (
        <p className="border-b border-line bg-danger-50 px-5 py-2 text-tiny text-danger-700">{error}</p>
      )}

      {loading ? (
        <p className="px-5 py-3 text-tiny text-muted">Loading changes...</p>
      ) : rows.length === 0 ? (
        <Empty title="Nothing new" hint="Content has not changed anything since your last review." />
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.campaign_id} className="flex items-start gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-heading">{r.campaign_name}</div>
                <ul className="mt-1 space-y-0.5">
                  {r.changed_fields.map((f) => (
                    <li key={f} className="flex items-center gap-1.5 text-micro text-success-700">
                      {Icon.check(11)}
                      {DIFF_LABEL[f as ContentDiffField] ?? f}
                    </li>
                  ))}
                </ul>
              </div>
              <span className="shrink-0 whitespace-nowrap text-micro text-faint">
                {fmtDate(r.changed_at.slice(0, 10))}
              </span>
              <Button size="sm" variant="ghost" disabled={busy === r.campaign_id}
                onClick={() => ack(r.campaign_id)}>
                {busy === r.campaign_id ? "..." : "Reviewed"}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
