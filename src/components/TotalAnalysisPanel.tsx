"use client";

import { useEffect, useState } from "react";
import type { TotalAnalysis } from "@/types/performance";
import { getTotalAnalysis } from "@/services/geminiAnalysis";
import { Card, Pill, Loading } from "./ui";
import { Icon } from "./icons";

/**
 * The one hero panel leadership reads first — sits above the executive KPI
 * strip. Built from the existing premium card style, just visually elevated
 * with a gradient header band, matching the treatment already used for the
 * recommendation panel elsewhere in the app (same pattern, not a new one).
 */
export function TotalAnalysisPanel({ month, tableSummaries, lastMonthFocuses }: {
  month: string; tableSummaries: unknown; lastMonthFocuses: unknown;
}) {
  const [analysis, setAnalysis] = useState<TotalAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);

  const load = async (force: boolean) => {
    force ? setRegenerating(true) : setLoading(true);
    setError(null);
    const { analysis: result, error: err } = await getTotalAnalysis(month, tableSummaries, lastMonthFocuses, force);
    setAnalysis(result); setError(err ?? null);
    setLoading(false); setRegenerating(false);
  };

  useEffect(() => { load(false); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [month]);

  const confTone = analysis?.confidence === "High" ? "success" : analysis?.confidence === "Medium" ? "warning" : "neutral";

  return (
    <Card pad={false} className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-indigo-600 to-indigo-500 px-5 py-3.5">
        <div className="flex items-center gap-2.5 text-white">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-white/20">{Icon.spark(15)}</span>
          <div>
            <div className="text-[13.5px] font-600">Total Performance Analysis</div>
            <div className="text-micro text-white/70">Cross-table synthesis for {month} · Prototype, dummy data</div>
          </div>
        </div>
        <button onClick={() => load(true)} disabled={regenerating || loading}
          className="rounded-lg bg-white/15 px-3 py-1.5 text-micro font-medium text-white hover:bg-white/25 disabled:opacity-50">
          {regenerating ? "Regenerating..." : "Regenerate"}
        </button>
      </div>

      <div className="px-5 py-5">
        {loading ? <Loading label="Synthesizing this month's report" /> : error ? (
          <div className="flex items-start gap-2 text-tiny text-danger-700">{Icon.alert(14)} <span>{error}</span></div>
        ) : analysis ? (
          <div className="space-y-4">
            <p className="font-display text-[16px] font-600 leading-snug text-heading">{analysis.headline}</p>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Strongest driver" value={analysis.strongest_driver} tone="success" />
              <Field label="Biggest risk" value={analysis.biggest_risk} tone="danger" />
            </div>

            <div className="rounded-lg bg-indigo-50 px-4 py-3">
              <div className="text-micro font-medium uppercase tracking-wide text-indigo-700">Cross-cutting insight</div>
              <p className="mt-1 text-[13.5px] text-heading">{analysis.cross_cutting_insight}</p>
            </div>

            <div>
              <div className="text-micro font-medium uppercase tracking-wide text-faint">Top 3 priorities</div>
              <ol className="mt-2 space-y-1.5">
                {analysis.top_3_priorities.map((p, i) => (
                  <li key={i} className="flex gap-2.5 text-[13.5px] text-body">
                    <span className="shrink-0 font-600 text-indigo-600">{i + 1}.</span> {p}
                  </li>
                ))}
              </ol>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Portfolio fatigue check" value={analysis.portfolio_fatigue_check} />
              <Field label="Last month's scorecard" value={analysis.last_month_scorecard} />
            </div>

            <Pill label={`${analysis.confidence} confidence`} tone={confTone} />
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function Field({ label, value, tone }: { label: string; value: string; tone?: "success" | "danger" }) {
  const border = tone === "success" ? "border-success-500" : tone === "danger" ? "border-danger-500" : "border-line";
  return (
    <div className={`border-l-2 ${border} pl-3`}>
      <div className="text-micro font-medium uppercase tracking-wide text-faint">{label}</div>
      <p className="mt-0.5 text-[13.5px] text-body">{value}</p>
    </div>
  );
}
