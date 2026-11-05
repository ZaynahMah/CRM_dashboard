"use client";

import { Button } from "./ui";
import { fmtDate } from "@/lib/format";
import {
  QUICK_PICKS, quickPickRange, validateRange,
  type DateRange, type QuickPick,
} from "@/lib/dateRange";

/**
 * Campaign-date filter: five quick picks plus a custom From → To.
 *
 * It narrows whatever the caller already shows; it never widens it. A
 * single day is simply the same date in both fields.
 */
export function DateRangeFilter({ value, onChange, matching }: {
  value: Partial<DateRange>;
  onChange: (next: Partial<DateRange>) => void;
  /** Row count after every filter, shown beside the range. */
  matching?: number;
}) {
  const check = validateRange(value);
  const active = Boolean(value.start || value.end);

  const pick = (p: QuickPick) => onChange(quickPickRange(p));

  return (
    <div className="flex flex-wrap items-center gap-2">
      {QUICK_PICKS.map((p) => {
        const r = quickPickRange(p.key);
        const on = value.start === r.start && value.end === r.end;
        return (
          <button key={p.key} onClick={() => pick(p.key)}
            className={`rounded-lg px-2.5 py-1 text-micro font-medium ${
              on ? "bg-indigo-50 text-indigo-700" : "text-muted hover:bg-[#F9FAFB]"}`}>
            {p.label}
          </button>
        );
      })}

      <input type="date" aria-label="From" value={value.start ?? ""}
        onChange={(e) => onChange({ ...value, start: e.target.value || undefined })}
        className="!m-0 !w-[140px] !py-1 !text-[12px]" />
      <input type="date" aria-label="To" value={value.end ?? ""}
        onChange={(e) => onChange({ ...value, end: e.target.value || undefined })}
        className="!m-0 !w-[140px] !py-1 !text-[12px]" />

      {active && (
        <Button size="sm" variant="ghost" onClick={() => onChange({})}>Clear</Button>
      )}

      {!check.valid ? (
        <span className="text-micro text-danger-700">{check.error}</span>
      ) : active && value.start && value.end ? (
        <span className="text-micro text-muted">
          {fmtDate(value.start)} – {fmtDate(value.end)}
          {matching !== undefined && ` · ${matching} PN${matching === 1 ? "" : "s"}`}
        </span>
      ) : null}
    </div>
  );
}
