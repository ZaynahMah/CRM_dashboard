"use client";

import { useMemo } from "react";
import type { DayWithSlots } from "@/services/calendar";
import type { Campaign } from "@/types/campaign";
import { fmtTime, isoDate, today } from "@/lib/format";
import { stageOf } from "@/lib/workflow";
import { Empty } from "./ui";

/**
 * The board is the product. Every date is a fixed strip of slots, so an open
 * slot is as visible as a booked one — which is the whole point of the change
 * away from the spreadsheet.
 */
const MARK: Record<string, string> = {
  AWAITING_CATEGORY: "bg-[#D0D5DD]",
  CATEGORY_SUBMITTED: "bg-info-500",
  CRM_PROCESSING: "bg-info-500",
  CONTENT_PENDING: "bg-warning-500",
  CONTENT_SUBMITTED: "bg-warning-500",
  FINAL_QC: "bg-indigo-500",
  READY: "bg-success-500",
  PUSHED: "bg-success-500",
  BLOCKED: "bg-danger-500",
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const LEGEND: [string, string][] = [
  ["bg-[#D0D5DD]", "Awaiting Category"],
  ["bg-info-500", "CRM processing"],
  ["bg-warning-500", "Content"],
  ["bg-indigo-500", "Final QC"],
  ["bg-success-500", "Ready or pushed"],
  ["bg-danger-500", "Blocked"],
];

export function SlotBoard({ days, onOpenCampaign, onClaimSlot, canClaim }: {
  days: DayWithSlots[];
  onOpenCampaign: (c: Campaign) => void;
  onClaimSlot?: (dayDate: string, slotId: string, slotTime: string) => void;
  canClaim: boolean;
}) {
  const todayIso = useMemo(() => isoDate(today()), []);

  if (days.length === 0) {
    return (
      <div className="rounded-xl border border-line bg-surface shadow-card">
        <Empty title="No dates opened for this month"
          hint="CRM opens the month before Category can plan against it. Use “Open this month” to create the slot grid." />
      </div>
    );
  }

  const first = new Date(days[0].date);
  const lead = (first.getDay() + 6) % 7;

  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-card">
      <div className="hidden grid-cols-7 gap-2 pb-2 md:grid">
        {WEEKDAYS.map((d) => (
          <div key={d} className="px-1 text-micro font-medium uppercase tracking-wide text-faint">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-7">
        {Array.from({ length: lead }).map((_, i) => (
          <div key={`pad-${i}`} className="hidden md:block" />
        ))}

        {days.map((day) => {
          const filled = day.slots.filter((s) => s.campaign).length;
          const isToday = day.date === todayIso;
          const past = day.date < todayIso;
          const emergencies = day.slots.filter((s) => s.campaign?.is_emergency).length;

          return (
            <div key={day.id}
              className={`overflow-hidden rounded-lg border transition-colors ${
                isToday ? "border-indigo-400 ring-1 ring-indigo-200"
                : past ? "border-line bg-[#FCFCFD] opacity-70" : "border-line"}`}>
              <div className="flex items-center justify-between border-b border-line bg-[#F9FAFB] px-2.5 py-1.5">
                <span className={`text-[13px] font-600 ${isToday ? "text-indigo-700" : "text-heading"}`}>
                  {new Date(day.date).getDate()}
                </span>
                <span className="flex items-center gap-1 text-micro text-faint">
                  {filled}/{day.slots.length}
                  {emergencies > 0 && <span className="h-1.5 w-1.5 rounded-full bg-danger-500" />}
                </span>
              </div>

              <div className="divide-y divide-line">
                {day.slots.map((slot) => {
                  const c = slot.campaign;
                  if (!c) {
                    return (
                      <button key={slot.id} disabled={!canClaim || past}
                        onClick={() => onClaimSlot?.(day.date, slot.id, slot.slot_time)}
                        className="group flex w-full items-center gap-2 px-2.5 py-[7px] text-left transition-colors enabled:hover:bg-indigo-50 disabled:cursor-default">
                        <span className="w-[48px] shrink-0 text-micro text-faint">{fmtTime(slot.slot_time)}</span>
                        <span className="h-px flex-1 bg-line" />
                        {canClaim && !past && (
                          <span className="text-micro font-medium text-faint group-hover:text-indigo-700">+</span>
                        )}
                      </button>
                    );
                  }
                  return (
                    <button key={slot.id} onClick={() => onOpenCampaign(c)}
                      className="flex w-full items-center gap-2 px-2.5 py-[7px] text-left transition-colors hover:bg-[#F9FAFB]">
                      <span className="w-[48px] shrink-0 text-micro text-faint">{fmtTime(slot.slot_time)}</span>
                      <span className={`h-3.5 w-[3px] shrink-0 rounded-full ${MARK[stageOf(c)]}`} />
                      <span className="truncate text-micro text-body">{c.brand ?? c.campaign_name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-line pt-3">
        {LEGEND.map(([cls, label]) => (
          <span key={label} className="flex items-center gap-1.5 text-micro text-muted">
            <span className={`h-2 w-2 rounded-full ${cls}`} />{label}
          </span>
        ))}
      </div>
    </div>
  );
}
