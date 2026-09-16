"use client";

import { useEffect, useState } from "react";
import type { DimensionRow, TableAnalysis, SheetKey } from "@/types/performance";
import { buildDimensionAnalysisInput } from "@/lib/performanceAnalysis";
import { getTableAnalysis } from "@/services/geminiAnalysis";
import { Button, Card, Pill, Loading } from "./ui";
import { Icon } from "./icons";
import { BarChart } from "./Charts";
import { fmtInr, fmtPct } from "@/lib/performanceAnalysis";

/**
 * One AI Analysis card, rendered below every per-table chart in the
 * Performance view. Reuses Card/Pill/Button — no new visual pattern.
 */
export function AIAnalysisCard({ sheetKey, sheetTitle, month, currentRows, historyRows }: {
  sheetKey: SheetKey; sheetTitle: string; month: string;
  currentRows: DimensionRow[]; historyRows: DimensionRow[];
}) {
  const [analysis, setAnalysis] = useState<TableAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);

  const load = async (force: boolean) => {
    force ? setRegenerating(true) : setLoading(true);
    setError(null);
    const input = buildDimensionAnalysisInput(sheetTitle, month, currentRows, historyRows);
    const lastFocus = undefined; // populated once a prior month's cached analysis exists for this table
    const { analysis: result, error: err } = await getTableAnalysis(sheetKey, input, lastFocus, force);
    setAnalysis(result); setError(err ?? null);
    setLoading(false); setRegenerating(false);
  };

  useEffect(() => {
    if (currentRows.length > 0) load(false);
    else { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetKey, month, currentRows.length]);

  if (currentRows.length === 0) return null;

  const confTone = analysis?.confidence === "High" ? "success" : analysis?.confidence === "Medium" ? "warning" : "neutral";

  return (
    <Card pad={false} className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-t border-line bg-[#F9FAFB] px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="text-indigo-600">{Icon.spark(14)}</span>
          <span className="text-tiny font-600 text-heading">AI Analysis</span>
          <Pill dot={false} label="Prototype · Dummy Data" tone="neutral" />
        </div>
        <button onClick={() => load(true)} disabled={regenerating || loading}
          className="flex items-center gap-1.5 text-micro font-medium text-indigo-700 hover:underline disabled:opacity-50">
          {regenerating ? "Regenerating..." : "Regenerate analysis"}
        </button>
      </div>

      <div className="px-5 py-4">
        {loading ? <Loading label="Analyzing this table" /> : error ? (
          <div className="flex items-start gap-2 text-tiny text-danger-700">
            {Icon.alert(14)} <span>{error}</span>
          </div>
        ) : analysis ? (
          <div className="space-y-3">
            <Row label="Pattern" value={analysis.pattern} />
            <Row label="Risk / loophole" value={analysis.risk_or_loophole} />
            <Row label="Focus next month" value={analysis.focus_next_month} emphasis />
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-tiny text-muted">
                <span className="font-medium text-heading">Estimated impact:</span> {analysis.estimated_impact}
              </span>
              <Pill label={`${analysis.confidence} confidence`} tone={confTone} />
            </div>
            {analysis.last_month_check && (
              <div className="rounded-lg bg-indigo-50 px-3.5 py-2.5 text-tiny text-indigo-700">
                {analysis.last_month_check}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function Row({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div>
      <div className="text-micro font-medium uppercase tracking-wide text-faint">{label}</div>
      <p className={`mt-0.5 text-[13.5px] leading-relaxed ${emphasis ? "font-medium text-heading" : "text-body"}`}>{value}</p>
    </div>
  );
}
