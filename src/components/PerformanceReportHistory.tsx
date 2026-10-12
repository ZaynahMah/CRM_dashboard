"use client";

import { useState } from "react";
import type { ReportSummary } from "@/services/performanceReports";
import { restoreReport, reportDownloadUrl } from "@/services/performanceReports";
import { Button, Card, Pill } from "./ui";
import { fmtDate } from "@/lib/format";

/**
 * Version history for the Executive performance report. A NEW component —
 * no existing screen was modified.
 *
 * Every upload is kept; the newest becomes Current and the rest Archived.
 * Restoring an older version only flips which one is current, because its
 * metrics are already stored — nothing is reparsed.
 */
export function PerformanceReportHistory({ reports, canManage, onChanged }: {
  reports: ReportSummary[];
  /** Only EXECUTIVE may restore. Everyone else sees the list read-only. */
  canManage: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (reports.length === 0) return null;

  const restore = async (id: string) => {
    setBusy(id); setError(null);
    try { await restoreReport(id); onChanged(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setBusy(null);
  };

  const download = async (path: string | null) => {
    if (!path) return;
    const url = await reportDownloadUrl(path);
    if (url) window.open(url, "_blank");
    else setError("The original file could not be retrieved from storage.");
  };

  return (
    <Card pad={false}>
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <h3 className="font-display text-[15px] font-600 text-heading">Report history</h3>
        <span className="text-micro text-faint">{reports.length} upload{reports.length === 1 ? "" : "s"}</span>
      </div>

      {error && (
        <p className="border-b border-line bg-danger-50 px-5 py-2 text-tiny text-danger-700">{error}</p>
      )}

      <table className="w-full">
        <thead>
          <tr>
            <th>File</th><th>Uploaded by</th><th>Uploaded</th><th>Sheets</th>
            <th>Status</th><th className="text-right">Action</th>
          </tr>
        </thead>
        <tbody>
          {reports.map((r) => (
            <tr key={r.id}>
              <td className="text-tiny font-medium text-heading">{r.file_name}</td>
              <td className="text-tiny text-muted">{r.uploaded_by_name ?? "—"}</td>
              <td className="whitespace-nowrap text-tiny text-muted">
                {fmtDate(r.uploaded_at.slice(0, 10))}
                <span className="ml-1.5 text-faint">{r.uploaded_at.slice(11, 16)}</span>
              </td>
              <td className="text-tiny tabular-nums text-muted">{r.sheet_count}</td>
              <td>
                <Pill label={r.is_current ? "Current" : "Archived"}
                  tone={r.is_current ? "success" : "neutral"} />
              </td>
              <td className="text-right">
                <div className="flex justify-end gap-2">
                  {r.storage_path && (
                    <button onClick={() => download(r.storage_path)}
                      className="text-micro font-medium text-indigo-700 hover:underline">
                      Download
                    </button>
                  )}
                  {canManage && !r.is_current && (
                    <Button size="sm" variant="ghost" disabled={busy === r.id}
                      onClick={() => restore(r.id)}>
                      {busy === r.id ? "Restoring..." : "Restore"}
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
