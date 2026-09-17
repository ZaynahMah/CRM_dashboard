"use client";

import { useMemo, useState } from "react";
import type { DimensionRow, SheetKey } from "@/types/performance";
import { QuadrantChart } from "./ChartsAdvanced";
import { classifyQuadrant, median } from "@/lib/performanceInsights";
import { fmtInr, fmtPct } from "@/lib/performanceAnalysis";
import { Card, CardHead, Pill } from "./ui";

const SOURCES: { key: SheetKey; label: string }[] = [
  { key: "category", label: "Categories" },
  { key: "segment", label: "Segments" },
  { key: "pn_type", label: "PN Types" },
];

const QUADRANT_INFO: Record<string, { label: string; hint: string; tone: "success" | "warning" | "info" | "neutral" }> = {
  SCALE: { label: "Scale", hint: "High revenue, high CVR — double down", tone: "success" },
  OPTIMIZE: { label: "Optimize", hint: "High revenue, low CVR — fix conversion before adding spend", tone: "warning" },
  GROW: { label: "Grow", hint: "Low revenue, high CVR — under-invested, real headroom", tone: "info" },
  DEPRIORITIZE: { label: "Deprioritize", hint: "Low revenue, low CVR — lowest return on attention", tone: "neutral" },
};

/** Section 9 — Opportunity Matrix: Revenue x CVR quadrant, switchable across dimension sheets. */
export function OpportunityMatrix({ dimensions }: { dimensions: Partial<Record<SheetKey, DimensionRow[]>> }) {
  const available = SOURCES.filter((s) => (dimensions[s.key]?.length ?? 0) > 0);
  const [source, setSource] = useState<SheetKey | null>(available[0]?.key ?? null);
  if (available.length === 0) return null;

  const rows = dimensions[source as SheetKey] ?? [];
  const medRevenue = median(rows.map((r) => r.revenue_inr ?? 0));
  const medCvr = median(rows.map((r) => r.cvr ?? 0));

  const classified = useMemo(() => rows.map((r) => ({
    label: r.dimension_value, x: r.revenue_inr ?? 0, y: r.cvr ?? 0,
    quadrant: classifyQuadrant(r.revenue_inr ?? 0, r.cvr ?? 0, medRevenue, medCvr),
  })), [rows, medRevenue, medCvr]);

  const counts = { SCALE: 0, OPTIMIZE: 0, GROW: 0, DEPRIORITIZE: 0 };
  classified.forEach((c) => counts[c.quadrant]++);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-[16px] font-700 text-heading">Opportunity Matrix</h2>
        <div className="flex gap-1 rounded-lg border border-line bg-surface p-1">
          {available.map((s) => (
            <button key={s.key} onClick={() => setSource(s.key)}
              className={`rounded-md px-3 py-1.5 text-micro font-medium transition-colors ${
                source === s.key ? "bg-indigo-600 text-white" : "text-muted hover:bg-[#F9FAFB]"}`}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <Card>
        <CardHead title="Revenue vs CVR" sub="Median-split into four strategic quadrants" />
        <QuadrantChart data={classified} xLabel="Revenue" yLabel="CVR" />
        <div className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-4">
          {(Object.keys(QUADRANT_INFO) as (keyof typeof QUADRANT_INFO)[]).map((q) => (
            <div key={q} className="rounded-lg bg-[#F9FAFB] p-3">
              <div className="flex items-center justify-between">
                <Pill dot={false} label={QUADRANT_INFO[q].label} tone={QUADRANT_INFO[q].tone} />
                <span className="text-[16px] font-700 text-heading">{counts[q as keyof typeof counts]}</span>
              </div>
              <p className="mt-1.5 text-micro text-faint">{QUADRANT_INFO[q].hint}</p>
              {classified.filter((c) => c.quadrant === q).slice(0, 3).map((c) => (
                <div key={c.label} className="mt-1 truncate text-micro text-muted">• {c.label}</div>
              ))}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
