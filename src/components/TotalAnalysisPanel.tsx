"use client";

import { useEffect, useState } from "react";
import type { TotalAnalysis } from "@/types/performance";
import { getTotalAnalysis } from "@/services/geminiAnalysis";
import { Card, Pill, Loading } from "./ui";
import { Icon } from "./icons";

/**
 * Section 2 — Executive AI Summary. Full-width insight card synthesizing
 * across every data source: What's Working / Risks / Opportunities, plus
 * 3 executive recommendations. This is the one section where a genuine
 * Gemini call earns its keep — real cross-source synthesis, not a
 * highest/lowest computation any spreadsheet could do.
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
      <div className="flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-indigo-600 to-indigo-500 px-6 py-4">
        <div className="flex items-center gap-3 text-white">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-white/20">{Icon.spark(16)}</span>
          <div>
            <div className="text-[14px] font-700">Executive AI Summary</div>
            <div className="text-micro text-white/70">Synthesized across every data source · {month} · Prototype, dummy data</div>
          </div>
        </div>
        <button onClick={() => load(true)} disabled={regenerating || loading}
          className="rounded-lg bg-white/15 px-3 py-1.5 text-micro font-medium text-white hover:bg-white/25 disabled:opacity-50">
          {regenerating ? "Regenerating..." : "Regenerate"}
        </button>
      </div>

      <div className="px-6 py-6">
        {loading ? <Loading label="Synthesizing this month's executive summary" /> : error ? (
          <div className="flex items-start gap-2 text-tiny text-danger-700">{Icon.alert(14)} <span>{error}</span></div>
        ) : analysis ? (
          <div className="space-y-6">
            <p className="font-display text-[19px] font-700 leading-snug text-heading">{analysis.headline}</p>

            <div className="grid gap-5 lg:grid-cols-3">
              <SummaryBlock title="What is working" tone="success" icon={Icon.check(14)}>
                <Row label="Best category" value={analysis.working.best_category} />
                <Row label="Best segment" value={analysis.working.best_segment} />
                <Row label="Best cohort" value={analysis.working.best_cohort} />
                <Row label="Best remarketing flow" value={analysis.working.best_remarketing_flow} />
                <Row label="Best PN type" value={analysis.working.best_pn_type} />
                <Row label="Best occasion" value={analysis.working.best_occasion} />
              </SummaryBlock>

              <SummaryBlock title="Risks" tone="danger" icon={Icon.alert(14)}>
                <Row label="Weakest category" value={analysis.risks.weakest_category} />
                <Row label="Weakest audience" value={analysis.risks.weakest_audience} />
                <Row label="Weakest campaign type" value={analysis.risks.weakest_campaign_type} />
              </SummaryBlock>

              <SummaryBlock title="Opportunities" tone="indigo" icon={Icon.target(14)}>
                <Row label="Scale" value={analysis.opportunities.scale} />
                <Row label="Optimize" value={analysis.opportunities.optimize} />
                <Row label="Revenue growth" value={analysis.opportunities.revenue_growth} />
              </SummaryBlock>
            </div>

            <div className="rounded-xl border border-line bg-[#F9FAFB] p-4">
              <div className="mb-2.5 text-micro font-medium uppercase tracking-wide text-faint">Executive recommendations</div>
              <ol className="space-y-2">
                {analysis.recommendations.map((r, i) => (
                  <li key={i} className="flex gap-3 text-[13.5px] text-body">
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-indigo-600 text-[10px] font-700 text-white">{i + 1}</span>
                    {r}
                  </li>
                ))}
              </ol>
            </div>

            <Pill label={`${analysis.confidence} confidence`} tone={confTone} />
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function SummaryBlock({ title, tone, icon, children }: { title: string; tone: "success" | "danger" | "indigo"; icon: React.ReactNode; children: React.ReactNode }) {
  const border = tone === "success" ? "border-success-500" : tone === "danger" ? "border-danger-500" : "border-indigo-500";
  const text = tone === "success" ? "text-success-700" : tone === "danger" ? "text-danger-700" : "text-indigo-700";
  return (
    <div className={`border-l-2 ${border} pl-4`}>
      <div className={`mb-2 flex items-center gap-1.5 text-tiny font-600 ${text}`}>{icon} {title}</div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-wide text-faint">{label}</div>
      <div className="text-tiny text-body">{value}</div>
    </div>
  );
}
