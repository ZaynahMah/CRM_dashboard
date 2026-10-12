"use client";

import { useRef, useState } from "react";
import { uploadPerformanceReport } from "@/services/performanceReports";
import { Card, Pill } from "./ui";
import { Icon } from "./icons";

/**
 * Uploads a workbook and PERSISTS it: the original goes to Supabase
 * Storage, the parsed metrics go to the database, and the new report
 * becomes current. It used to parse into React state only, which a refresh
 * threw away.
 *
 * `onUploaded` tells the page to reload from storage rather than handing it
 * parsed data, so what is displayed is always what was actually saved.
 */
export function PerformanceUpload({ profileId, onUploaded }: {
  profileId: string;
  onUploaded: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ tone: "ok" | "warning" | "danger"; message: string; warnings: string[] } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setBusy(true); setStatus(null);
    try {
      // Parses once, stores the original file, writes the metrics and makes
      // this the current report. Nothing is reparsed on later page loads.
      const { report, data } = await uploadPerformanceReport(file, profileId);
      setStatus({
        tone: data.warnings.length > 0 ? "warning" : "ok",
        message: data.currentMonth
          ? `Saved. Performance view built for ${data.currentMonth} from ${report.sheet_count} sheets.`
          : `Saved. ${report.sheet_count} sheets processed.`,
        warnings: data.warnings,
      });
      await onUploaded();
    } catch (e) {
      setStatus({ tone: "danger", message: e instanceof Error ? e.message : "Could not read this file.", warnings: [] });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const bg = status?.tone === "ok" ? "bg-success-50 text-success-700"
    : status?.tone === "warning" ? "bg-warning-50 text-warning-700"
    : "bg-danger-50 text-danger-700";

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="font-display text-[15px] font-600 text-heading">Upload This Month&rsquo;s Performance Report</h3>
          <p className="mt-0.5 text-micro text-faint">
            .xlsx with the Monthly_KPI, Category_Performance, Remarketing_Flow, Segment_Performance,
            PN_Type_Performance, Cohort_Performance, Occasion_Performance, Tag_Performance and
            &ldquo;top 10 performing PN&rdquo; sheets. Processed entirely in this browser tab — nothing is
            saved anywhere, so refreshing the page clears it. Re-upload any time to rebuild the view.
          </p>
        </div>

        <label className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface px-4 py-2.5 text-[13px] font-medium text-body transition-colors hover:bg-[#F9FAFB] ${busy ? "pointer-events-none opacity-60" : ""}`}>
          {busy ? "Processing..." : <>{Icon.chart(13)} Choose .xlsx file</>}
          <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden" disabled={busy}
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
        </label>
      </div>

      {status && (
        <div className={`mt-4 rounded-lg px-4 py-3 text-tiny ${bg}`}>
          <div className="flex items-center gap-2 font-medium">
            {status.tone === "ok" ? Icon.check(14) : Icon.alert(14)} {status.message}
          </div>
          {status.warnings.length > 0 && (
            <ul className="mt-2 space-y-1">
              {status.warnings.map((w, i) => (
                <li key={i} className="flex items-start gap-1.5"><span className="mt-0.5">{Icon.alert(11)}</span> {w}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
