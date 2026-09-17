"use client";

import { useState } from "react";
import { fmtInr } from "@/lib/performanceAnalysis";

/** Executive-grade chart primitives: heatmap, scatter, radar, quadrant.
 * All hand-rolled SVG, matching the palette and interaction style already
 * established in Charts.tsx — no new dependency. */

const PALETTE = ["#6438E8", "#9B8AFB", "#2E90FA", "#12B76A", "#F79009", "#F04438", "#0E9384", "#B54708"];

interface Tooltip { x: number; y: number; label: string; value: string }

function TooltipLayer({ tip }: { tip: Tooltip | null }) {
  if (!tip) return null;
  return (
    <div className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg bg-heading px-2.5 py-1.5 text-micro text-white shadow-pop"
      style={{ left: tip.x, top: tip.y - 8 }}>
      <div className="font-600">{tip.label}</div>
      <div className="text-white/80">{tip.value}</div>
    </div>
  );
}

/* ───────────────────────── Horizontal ranking bar ───────────────────────── */

export function HorizontalRanking({ data, valueFormat, height = 34 }: {
  data: { label: string; value: number; sublabel?: string }[];
  valueFormat?: (v: number) => string;
  height?: number;
}) {
  const fmt = valueFormat ?? fmtInr;
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="space-y-2.5">
      {data.map((d, i) => (
        <div key={d.label} className="flex items-center gap-3">
          <span className="w-[120px] shrink-0 truncate text-tiny font-medium text-heading" title={d.label}>{d.label}</span>
          <div className="relative flex-1 overflow-hidden rounded-md bg-[#F2F4F7]" style={{ height }}>
            <div className="flex h-full items-center rounded-md bg-gradient-to-r from-indigo-600 to-indigo-400 px-2.5 transition-all duration-500"
              style={{ width: `${Math.max((d.value / max) * 100, 6)}%` }}>
              <span className="whitespace-nowrap text-micro font-600 text-white">{fmt(d.value)}</span>
            </div>
          </div>
          {d.sublabel && <span className="w-14 shrink-0 text-right text-micro text-muted">{d.sublabel}</span>}
        </div>
      ))}
    </div>
  );
}

/* ───────────────────────────── Heatmap ───────────────────────────── */

export function Heatmap({ rows, columns }: {
  rows: { label: string; values: (number | null)[] }[];
  columns: { label: string; format?: (v: number) => string }[];
}) {
  // Normalize per-column so each metric's own scale drives its own color intensity.
  const colStats = columns.map((_, ci) => {
    const vals = rows.map((r) => r.values[ci]).filter((v): v is number => v != null);
    return { min: Math.min(...vals, 0), max: Math.max(...vals, 1) };
  });

  const colorFor = (v: number | null, ci: number) => {
    if (v == null) return "#F2F4F7";
    const { min, max } = colStats[ci];
    const t = max > min ? (v - min) / (max - min) : 0.5;
    // Red (weak) -> Yellow (medium) -> Green (strong)
    if (t < 0.5) {
      const k = t / 0.5;
      return `rgb(${240 - k * 20}, ${68 + k * 100}, ${56 + k * 10})`;
    }
    const k = (t - 0.5) / 0.5;
    return `rgb(${220 - k * 100}, ${168 + k * 20}, ${56 + k * 40})`;
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-1">
        <thead>
          <tr>
            <th className="text-left text-micro font-medium uppercase tracking-wide text-faint">Category</th>
            {columns.map((c) => <th key={c.label} className="px-1 text-center text-micro font-medium uppercase tracking-wide text-faint">{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td className="whitespace-nowrap py-1 pr-3 text-tiny font-medium text-heading">{r.label}</td>
              {r.values.map((v, ci) => (
                <td key={ci} className="p-0.5">
                  <div className="flex h-9 min-w-[64px] items-center justify-center rounded-md text-micro font-600 text-white"
                    style={{ background: colorFor(v, ci) }}>
                    {v == null ? "—" : (columns[ci].format ? columns[ci].format!(v) : v.toLocaleString("en-IN"))}
                  </div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 flex items-center gap-2 text-micro text-faint">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: "rgb(240,68,56)" }} /> Weak
        <span className="ml-2 h-2.5 w-2.5 rounded-sm" style={{ background: "rgb(200,188,86)" }} /> Medium
        <span className="ml-2 h-2.5 w-2.5 rounded-sm" style={{ background: "rgb(120,188,96)" }} /> Strong
      </div>
    </div>
  );
}

/* ───────────────────────────── Scatter plot ───────────────────────────── */

export function ScatterPlot({ data, height = 220, xLabel, yLabel, xFormat, yFormat }: {
  data: { label: string; x: number; y: number }[];
  height?: number;
  xLabel?: string; yLabel?: string;
  xFormat?: (v: number) => string; yFormat?: (v: number) => string;
}) {
  const [tip, setTip] = useState<Tooltip | null>(null);
  if (data.length === 0) return null;
  const w = 100, h = 60, pad = 8;
  const maxX = Math.max(...data.map((d) => d.x), 0.0001);
  const maxY = Math.max(...data.map((d) => d.y), 1);
  const sx = (v: number) => pad + (v / maxX) * (w - pad * 2);
  const sy = (v: number) => h - pad - (v / maxY) * (h - pad * 2);
  const fx = xFormat ?? ((v) => v.toFixed(2));
  const fy = yFormat ?? fmtInr;

  return (
    <div className="relative" style={{ height }}>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-full w-full overflow-visible">
        <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="#EAECF0" strokeWidth="0.4" vectorEffect="non-scaling-stroke" />
        <line x1={pad} y1={pad} x2={pad} y2={h - pad} stroke="#EAECF0" strokeWidth="0.4" vectorEffect="non-scaling-stroke" />
        {data.map((d, i) => (
          <circle key={i} cx={sx(d.x)} cy={sy(d.y)} r="2.2" fill={PALETTE[i % PALETTE.length]}
            className="cursor-pointer transition-all hover:r-3" vectorEffect="non-scaling-stroke"
            onMouseEnter={(e) => {
              const svg = (e.target as SVGElement).ownerSVGElement;
              const rect = svg?.getBoundingClientRect(); const parentRect = svg?.parentElement?.getBoundingClientRect();
              if (!rect || !parentRect) return;
              setTip({ x: (sx(d.x)/w)*rect.width + (rect.left-parentRect.left), y: (sy(d.y)/h)*rect.height + (rect.top-parentRect.top),
                label: d.label, value: `${xLabel ?? "x"}: ${fx(d.x)} · ${yLabel ?? "y"}: ${fy(d.y)}` });
            }}
            onMouseLeave={() => setTip(null)}
          />
        ))}
      </svg>
      <TooltipLayer tip={tip} />
      <div className="mt-1 flex justify-between text-micro text-faint"><span>{xLabel}</span><span>{yLabel}</span></div>
    </div>
  );
}

/* ───────────────────────────── Radar chart ───────────────────────────── */

export function RadarChart({ axes, series, height = 260 }: {
  axes: string[];
  series: { name: string; color: string; values: number[] }[]; // one value per axis, 0-1 normalized
  height?: number;
}) {
  const [tip, setTip] = useState<Tooltip | null>(null);
  const cx = 50, cy = 50, r = 38;
  const angleFor = (i: number) => (Math.PI * 2 * i) / axes.length - Math.PI / 2;
  const pointFor = (i: number, val: number) => {
    const a = angleFor(i);
    return { x: cx + r * val * Math.cos(a), y: cy + r * val * Math.sin(a) };
  };

  const rings = [0.25, 0.5, 0.75, 1];

  return (
    <div className="relative" style={{ height }}>
      <svg viewBox="0 0 100 100" className="h-full w-full overflow-visible">
        {rings.map((ring) => (
          <polygon key={ring}
            points={axes.map((_, i) => { const p = pointFor(i, ring); return `${p.x},${p.y}`; }).join(" ")}
            fill="none" stroke="#EAECF0" strokeWidth="0.3" vectorEffect="non-scaling-stroke" />
        ))}
        {axes.map((_, i) => {
          const p = pointFor(i, 1);
          return <line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="#EAECF0" strokeWidth="0.3" vectorEffect="non-scaling-stroke" />;
        })}
        {series.map((s) => (
          <g key={s.name}>
            <polygon points={s.values.map((v, i) => { const p = pointFor(i, v); return `${p.x},${p.y}`; }).join(" ")}
              fill={s.color} fillOpacity="0.15" stroke={s.color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            {s.values.map((v, i) => {
              const p = pointFor(i, v);
              return (
                <circle key={i} cx={p.x} cy={p.y} r="1.8" fill={s.color} vectorEffect="non-scaling-stroke" className="cursor-pointer"
                  onMouseEnter={(e) => {
                    const svg = (e.target as SVGElement).ownerSVGElement;
                    const rect = svg?.getBoundingClientRect(); const parentRect = svg?.parentElement?.getBoundingClientRect();
                    if (!rect || !parentRect) return;
                    setTip({ x: (p.x/100)*rect.width + (rect.left-parentRect.left), y: (p.y/100)*rect.height + (rect.top-parentRect.top),
                      label: `${s.name} · ${axes[i]}`, value: `${Math.round(v * 100)} / 100 (normalized)` });
                  }}
                  onMouseLeave={() => setTip(null)}
                />
              );
            })}
          </g>
        ))}
        {axes.map((label, i) => {
          const p = pointFor(i, 1.18);
          return (
            <text key={label} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle"
              className="fill-faint" style={{ fontSize: "4.5px" }}>{label}</text>
          );
        })}
      </svg>
      <TooltipLayer tip={tip} />
      <div className="mt-2 flex flex-wrap justify-center gap-4">
        {series.map((s) => (
          <span key={s.name} className="flex items-center gap-1.5 text-micro text-muted">
            <span className="h-2 w-2 rounded-full" style={{ background: s.color }} /> {s.name}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ───────────────────────────── Quadrant chart ───────────────────────────── */

export function QuadrantChart({ data, xLabel, yLabel, height = 320 }: {
  data: { label: string; x: number; y: number; quadrant: "SCALE" | "OPTIMIZE" | "GROW" | "DEPRIORITIZE" }[];
  xLabel: string; yLabel: string;
  height?: number;
}) {
  const [tip, setTip] = useState<Tooltip | null>(null);
  if (data.length === 0) return null;

  const w = 100, h = 70, pad = 6;
  const maxX = Math.max(...data.map((d) => d.x), 1);
  const maxY = Math.max(...data.map((d) => d.y), 0.0001);
  const sx = (v: number) => pad + (v / maxX) * (w - pad * 2);
  const sy = (v: number) => h - pad - (v / maxY) * (h - pad * 2);
  const midX = w / 2, midY = h / 2;

  const QUADRANT_COLOR: Record<string, string> = {
    SCALE: "#12B76A", OPTIMIZE: "#F79009", GROW: "#2E90FA", DEPRIORITIZE: "#98A2B3",
  };

  return (
    <div className="relative" style={{ height }}>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-full w-full overflow-visible">
        <rect x={pad} y={pad} width={midX - pad} height={midY - pad} fill="#EFF8FF" opacity="0.5" />
        <rect x={midX} y={pad} width={w - pad - midX} height={midY - pad} fill="#ECFDF3" opacity="0.5" />
        <rect x={pad} y={midY} width={midX - pad} height={h - pad - midY} fill="#F9FAFB" opacity="0.6" />
        <rect x={midX} y={midY} width={w - pad - midX} height={h - pad - midY} fill="#FFFAEB" opacity="0.5" />
        <line x1={midX} y1={pad} x2={midX} y2={h - pad} stroke="#D0D5DD" strokeWidth="0.3" vectorEffect="non-scaling-stroke" />
        <line x1={pad} y1={midY} x2={w - pad} y2={midY} stroke="#D0D5DD" strokeWidth="0.3" vectorEffect="non-scaling-stroke" />

        <text x={w - pad - 1} y={pad + 3} textAnchor="end" style={{ fontSize: "3.4px" }} className="fill-success-700 font-semibold">SCALE</text>
        <text x={w - pad - 1} y={h - pad - 1} textAnchor="end" style={{ fontSize: "3.4px" }} className="fill-warning-700 font-semibold">OPTIMIZE</text>
        <text x={pad + 1} y={pad + 3} textAnchor="start" style={{ fontSize: "3.4px" }} className="fill-info-700 font-semibold">GROW</text>
        <text x={pad + 1} y={h - pad - 1} textAnchor="start" style={{ fontSize: "3.4px" }} className="fill-faint font-semibold">DEPRIORITIZE</text>

        {data.map((d, i) => (
          <circle key={i} cx={sx(d.x)} cy={sy(d.y)} r="2.4" fill={QUADRANT_COLOR[d.quadrant]}
            stroke="#fff" strokeWidth="0.5" vectorEffect="non-scaling-stroke" className="cursor-pointer"
            onMouseEnter={(e) => {
              const svg = (e.target as SVGElement).ownerSVGElement;
              const rect = svg?.getBoundingClientRect(); const parentRect = svg?.parentElement?.getBoundingClientRect();
              if (!rect || !parentRect) return;
              setTip({ x: (sx(d.x)/w)*rect.width + (rect.left-parentRect.left), y: (sy(d.y)/h)*rect.height + (rect.top-parentRect.top),
                label: d.label, value: `${xLabel}: ${fmtInr(d.x)} · ${yLabel}: ${(d.y*100).toFixed(1)}%` });
            }}
            onMouseLeave={() => setTip(null)}
          />
        ))}
      </svg>
      <TooltipLayer tip={tip} />
      <div className="mt-1 flex justify-between text-micro text-faint"><span>{xLabel} →</span><span>{yLabel} ↑</span></div>
    </div>
  );
}
