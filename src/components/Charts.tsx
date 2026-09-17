"use client";

import { useState } from "react";

/** Small hand-rolled charts — no charting dependency, no runtime cost. Every
 * chart below shows a real hover tooltip keyed to whatever period label the
 * caller passes in (day, week, or month — the chart doesn't care which). */

const PALETTE = ["#6438E8", "#9B8AFB", "#2E90FA", "#12B76A", "#F79009", "#F04438", "#D9D6FE", "#B2DDFF"];

interface Tooltip { x: number; y: number; label: string; value: string }

function TooltipLayer({ tip }: { tip: Tooltip | null }) {
  if (!tip) return null;
  return (
    <div
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg bg-heading px-2.5 py-1.5 text-micro text-white shadow-pop"
      style={{ left: tip.x, top: tip.y - 8 }}
    >
      <div className="font-600">{tip.label}</div>
      <div className="text-white/80">{tip.value}</div>
    </div>
  );
}

export function BarChart({ data, height = 190, valueFormat }: {
  data: { label: string; value: number; muted?: boolean }[];
  height?: number;
  valueFormat?: (v: number) => string;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const fmt = valueFormat ?? ((v: number) => v.toLocaleString("en-IN"));
  const [tip, setTip] = useState<Tooltip | null>(null);

  return (
    <div className="relative">
      <div className="flex items-end gap-2" style={{ height }}>
        {data.map((d, i) => (
          <div key={`${d.label}-${i}`} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-2">
            <div
              className="relative flex w-full max-w-[34px] flex-1 items-end justify-center rounded-md bg-[#F2F4F7]"
              onMouseEnter={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                const p = e.currentTarget.parentElement?.parentElement?.parentElement?.getBoundingClientRect();
                setTip({ x: r.left - (p?.left ?? 0) + r.width / 2, y: r.top - (p?.top ?? 0), label: d.label, value: fmt(d.value) });
              }}
              onMouseLeave={() => setTip(null)}
            >
              <div
                className={`w-full rounded-md transition-all duration-500 ${d.muted ? "bg-indigo-200" : "bg-gradient-to-t from-indigo-600 to-indigo-400"}`}
                style={{ height: `${Math.max((d.value / max) * 100, 3)}%` }}
              />
            </div>
            <span className="w-full truncate text-center text-micro text-faint">{d.label}</span>
          </div>
        ))}
      </div>
      <TooltipLayer tip={tip} />
    </div>
  );
}

export function LineChart({ data, height = 190, valueFormat }: {
  data: { label: string; value: number }[];
  height?: number;
  valueFormat?: (v: number) => string;
}) {
  const [tip, setTip] = useState<Tooltip | null>(null);
  const fmt = valueFormat ?? ((v: number) => v.toLocaleString("en-IN"));
  if (data.length < 2) return null;

  const w = 100, h = 100;
  const max = Math.max(...data.map((d) => d.value), 1);
  const min = Math.min(...data.map((d) => d.value), 0);
  const span = max - min || 1;
  const pts = data.map((d, i) => ({
    x: (i / (data.length - 1)) * w,
    y: h - ((d.value - min) / span) * (h - 10) - 5,
  }));
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ");
  const area = `${line} L${w} ${h} L0 ${h} Z`;

  return (
    <div className="relative" style={{ height }}>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-full w-full overflow-visible">
        <defs>
          <linearGradient id="lineFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7A5AF8" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#7A5AF8" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[25, 50, 75].map((y) => (
          <line key={y} x1="0" y1={y} x2={w} y2={y} stroke="#EAECF0" strokeWidth="0.4" vectorEffect="non-scaling-stroke" />
        ))}
        <path d={area} fill="url(#lineFill)" />
        <path d={line} fill="none" stroke="#6438E8" strokeWidth="2" vectorEffect="non-scaling-stroke"
          strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="2.4" fill="#fff" stroke="#6438E8" strokeWidth="1.6"
            vectorEffect="non-scaling-stroke" className="cursor-pointer"
            onMouseEnter={(e) => {
              const svg = (e.target as SVGElement).ownerSVGElement;
              const rect = svg?.getBoundingClientRect();
              const parentRect = svg?.parentElement?.getBoundingClientRect();
              if (!rect || !parentRect) return;
              setTip({
                x: (p.x / w) * rect.width + (rect.left - parentRect.left),
                y: (p.y / h) * rect.height + (rect.top - parentRect.top),
                label: data[i].label, value: fmt(data[i].value),
              });
            }}
            onMouseLeave={() => setTip(null)}
          />
        ))}
      </svg>
      <TooltipLayer tip={tip} />
      <div className="mt-2 flex justify-between text-micro text-faint">
        <span>{data[0].label}</span>
        <span>{data[data.length - 1].label}</span>
      </div>
    </div>
  );
}

export function SplitBar({ segments }: { segments: { label: string; value: number; color: string }[] }) {
  const total = segments.reduce((a, b) => a + b.value, 0) || 1;
  return (
    <div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-[#F2F4F7]">
        {segments.map((s) => (
          <div key={s.label} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
        {segments.map((s) => (
          <span key={s.label} className="flex items-center gap-2 text-tiny text-muted">
            <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
            {s.label}
            <span className="font-medium text-heading">{Math.round((s.value / total) * 100)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** SVG donut/pie — up to 8 slices, palette-cycled, with a hover tooltip per slice. */
export function PieChart({ data, size = 180, valueFormat }: {
  data: { label: string; value: number }[];
  size?: number;
  valueFormat?: (v: number) => string;
}) {
  const [tip, setTip] = useState<Tooltip | null>(null);
  const fmt = valueFormat ?? ((v: number) => v.toLocaleString("en-IN"));
  const total = data.reduce((a, d) => a + d.value, 0) || 1;
  const r = 42, cx = 50, cy = 50, inner = 24;

  let cumulative = 0;
  const slices = data.map((d, i) => {
    const start = (cumulative / total) * 2 * Math.PI - Math.PI / 2;
    cumulative += d.value;
    const end = (cumulative / total) * 2 * Math.PI - Math.PI / 2;
    const largeArc = end - start > Math.PI ? 1 : 0;
    const x1 = cx + r * Math.cos(start), y1 = cy + r * Math.sin(start);
    const x2 = cx + r * Math.cos(end), y2 = cy + r * Math.sin(end);
    const ix1 = cx + inner * Math.cos(end), iy1 = cy + inner * Math.sin(end);
    const ix2 = cx + inner * Math.cos(start), iy2 = cy + inner * Math.sin(start);
    const path = `M${x1} ${y1} A${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} L${ix1} ${iy1} A${inner} ${inner} 0 ${largeArc} 0 ${ix2} ${iy2} Z`;
    const midAngle = (start + end) / 2;
    return { path, color: PALETTE[i % PALETTE.length], label: d.label, value: d.value, midAngle };
  });

  return (
    <div className="flex flex-wrap items-center gap-6">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg viewBox="0 0 100 100" className="h-full w-full overflow-visible">
          {slices.map((s, i) => (
            <path key={i} d={s.path} fill={s.color} className="cursor-pointer transition-opacity hover:opacity-80"
              onMouseEnter={(e) => {
                const svg = (e.target as SVGElement).ownerSVGElement;
                const rect = svg?.getBoundingClientRect();
                const parentRect = svg?.parentElement?.parentElement?.getBoundingClientRect();
                if (!rect || !parentRect) return;
                const px = cx + 32 * Math.cos(s.midAngle), py = cy + 32 * Math.sin(s.midAngle);
                setTip({
                  x: (px / 100) * rect.width + (rect.left - parentRect.left),
                  y: (py / 100) * rect.height + (rect.top - parentRect.top),
                  label: s.label, value: `${fmt(s.value)} (${Math.round((s.value / total) * 100)}%)`,
                });
              }}
              onMouseLeave={() => setTip(null)}
            />
          ))}
        </svg>
        <TooltipLayer tip={tip} />
      </div>
      <div className="flex min-w-[140px] flex-1 flex-col gap-1.5">
        {data.map((d, i) => (
          <span key={d.label} className="flex items-center gap-2 text-tiny text-muted">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />
            <span className="min-w-0 flex-1 truncate">{d.label}</span>
            <span className="font-medium text-heading">{Math.round((d.value / total) * 100)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** SVG bubble chart — x/y position plus a third dimension encoded as radius. */
export function BubbleChart({ data, height = 240, xLabel, yLabel, valueFormat }: {
  data: { label: string; x: number; y: number; size: number }[];
  height?: number;
  xLabel?: string;
  yLabel?: string;
  valueFormat?: { x?: (v: number) => string; y?: (v: number) => string; size?: (v: number) => string };
}) {
  const [tip, setTip] = useState<Tooltip | null>(null);
  if (data.length === 0) return null;

  const w = 100, h = 60;
  const pad = 8;
  const maxX = Math.max(...data.map((d) => d.x), 1);
  const maxY = Math.max(...data.map((d) => d.y), 1);
  const maxSize = Math.max(...data.map((d) => d.size), 1);
  const scaleX = (v: number) => pad + (v / maxX) * (w - pad * 2);
  const scaleY = (v: number) => h - pad - (v / maxY) * (h - pad * 2);
  const scaleR = (v: number) => 2 + (v / maxSize) * 8;

  const fx = valueFormat?.x ?? ((v: number) => v.toLocaleString("en-IN"));
  const fy = valueFormat?.y ?? ((v: number) => v.toLocaleString("en-IN"));
  const fs = valueFormat?.size ?? ((v: number) => v.toLocaleString("en-IN"));

  return (
    <div className="relative" style={{ height }}>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-full w-full overflow-visible">
        <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="#EAECF0" strokeWidth="0.4" vectorEffect="non-scaling-stroke" />
        <line x1={pad} y1={pad} x2={pad} y2={h - pad} stroke="#EAECF0" strokeWidth="0.4" vectorEffect="non-scaling-stroke" />
        {data.map((d, i) => (
          <circle key={i} cx={scaleX(d.x)} cy={scaleY(d.y)} r={scaleR(d.size)}
            fill={PALETTE[i % PALETTE.length]} fillOpacity={0.65} stroke={PALETTE[i % PALETTE.length]} strokeWidth="1"
            vectorEffect="non-scaling-stroke" className="cursor-pointer transition-opacity hover:fill-opacity-90"
            onMouseEnter={(e) => {
              const svg = (e.target as SVGElement).ownerSVGElement;
              const rect = svg?.getBoundingClientRect();
              const parentRect = svg?.parentElement?.getBoundingClientRect();
              if (!rect || !parentRect) return;
              setTip({
                x: (scaleX(d.x) / w) * rect.width + (rect.left - parentRect.left),
                y: (scaleY(d.y) / h) * rect.height + (rect.top - parentRect.top),
                label: d.label,
                value: `${xLabel ?? "x"}: ${fx(d.x)} · ${yLabel ?? "y"}: ${fy(d.y)} · size: ${fs(d.size)}`,
              });
            }}
            onMouseLeave={() => setTip(null)}
          />
        ))}
      </svg>
      <TooltipLayer tip={tip} />
      <div className="mt-1 flex justify-between text-micro text-faint">
        <span>{xLabel}</span>
        <span>{yLabel}</span>
      </div>
    </div>
  );
}
