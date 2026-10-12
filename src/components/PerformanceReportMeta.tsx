"use client";

import type { ReportSummary } from "@/services/performanceReports";
import { Card, Pill } from "./ui";
import { fmtDate } from "@/lib/format";

/**
 * Provenance for the report on screen: who uploaded it, when, which file
 * and how many sheets were processed. A NEW component — nothing existing
 * was modified.
 *
 * It matters because the dashboard now shows stored data that someone else
 * may have uploaded days ago; without this, there is no way to tell how old
 * the numbers are.
 */
export function PerformanceReportMeta({ report }: { report: ReportSummary }) {
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <div>
          <div className="text-micro uppercase tracking-wide text-faint">File</div>
          <div className="text-tiny font-medium text-heading">{report.file_name}</div>
        </div>
        <div>
          <div className="text-micro uppercase tracking-wide text-faint">Uploaded by</div>
          <div className="text-tiny text-body">{report.uploaded_by_name ?? "—"}</div>
        </div>
        <div>
          <div className="text-micro uppercase tracking-wide text-faint">Uploaded</div>
          <div className="text-tiny text-body">
            {fmtDate(report.uploaded_at.slice(0, 10))} · {report.uploaded_at.slice(11, 16)}
          </div>
        </div>
        <div>
          <div className="text-micro uppercase tracking-wide text-faint">Sheets processed</div>
          <div className="text-tiny tabular-nums text-body">{report.sheet_count}</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Pill label="Current" tone="success" />
          {!report.storage_path && (
            <Pill dot={false} label="original file not stored" tone="warning" />
          )}
        </div>
      </div>
      {report.warnings.length > 0 && (
        <ul className="mt-3 space-y-1">
          {report.warnings.map((w, i) => (
            <li key={i} className="text-micro text-warning-700">{w}</li>
          ))}
        </ul>
      )}
    </Card>
  );
}
