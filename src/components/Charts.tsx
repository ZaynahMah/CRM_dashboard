"use client";

/** Small hand-rolled charts — no charting dependency, no runtime cost. */

export function BarChart({ data, height = 190 }: {
  data: { label: string; value: number; muted?: boolean }[];
  height?: number;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="flex items-end gap-2" style={{ height }}>
      {data.map((d, i) => (
        <div key={`${d.label}-${i}`} className="group flex min-w-0 flex-1 flex-col items-center justify-end gap-2">
          <div className="relative flex w-full max-w-[34px] flex-1 items-end justify-center rounded-md bg-[#F2F4F7]">
            <div
              className={`w-full rounded-md transition-all duration-500 ${d.muted ? "bg-indigo-200" : "bg-gradient-to-t from-indigo-600 to-indigo-400"}`}
              style={{ height: `${Math.max((d.value / max) * 100, 3)}%` }}
            />
            <span className="pointer-events-none absolute -top-6 rounded bg-heading px-1.5 py-0.5 text-micro text-white opacity-0 transition-opacity group-hover:opacity-100">
              {d.value}
            </span>
          </div>
          <span className="w-full truncate text-center text-micro text-faint">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

export function LineChart({ data, height = 190 }: {
  data: { label: string; value: number }[];
  height?: number;
}) {
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
    <div style={{ height }}>
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
            vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
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
