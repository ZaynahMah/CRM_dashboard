"use client";

import { useRef, useState } from "react";
import { parseWorkbook, saveUpload } from "@/services/performanceUpload";
import { Button, Card, Pill } from "./ui";
import { Icon } from "./icons";

export function PerformanceUpload({ profileId, onDone }: { profileId: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string; warnings: string[] } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setBusy(true); setResult(null);
    try {
      const buffer = await file.arrayBuffer();
      const parsed = parseWorkbook(buffer);
      const { warnings } = await saveUpload(parsed, file.name, profileId);
      setResult({
        ok: true,
        message: parsed.currentMonth
          ? `Performance view rebuilt for ${parsed.currentMonth}.`
          : "Upload processed.",
        warnings,
      });
      onDone();
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : "Upload failed.", warnings: [] });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="font-display text-[15px] font-600 text-heading">Upload This Month's Performance Report</h3>
          <p className="mt-0.5 text-micro text-faint">
            .xlsx with the Monthly_KPI, Category_Performance, Remarketing_Flow, Segment_Performance,
            PN_Type_Performance, Cohort_Performance, Occasion_Performance, Tag_Performance and
            &ldquo;top 10 performing PN&rdquo; sheets. Replaces the current month; history is kept.
          </p>
        </div>
        <label className="cursor-pointer">
          <Button variant="ghost" disabled={busy} className="pointer-events-none">
            {busy ? "Processing..." : <>{Icon.chart(13)} Choose .xlsx file</>}
          </Button>
          <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden" disabled={busy}
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
        </label>
      </div>

      {result && (
        <div className={`mt-4 rounded-lg px-4 py-3 text-tiny ${result.ok ? "bg-success-50 text-success-700" : "bg-danger-50 text-danger-700"}`}>
          <div className="flex items-center gap-2 font-medium">
            {result.ok ? Icon.check(14) : Icon.alert(14)} {result.message}
          </div>
          {result.warnings.length > 0 && (
            <ul className="mt-2 space-y-1">
              {result.warnings.map((w, i) => (
                <li key={i} className="flex items-start gap-1.5 text-muted">
                  <span className="mt-0.5">{Icon.alert(11)}</span> {w}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
