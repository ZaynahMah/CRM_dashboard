"use client";

import { useMemo, useState } from "react";
import { Button, Modal } from "./ui";
import type { Campaign } from "@/types/campaign";
import { downloadCSV } from "@/services/exportExcel";
import { planningWindow } from "@/lib/planningWindow";
import { validateRange, type DateRange } from "@/lib/dateRange";
import { campaignDateIso } from "@/lib/campaignDate";
import { fmtDate } from "@/lib/format";

/**
 * Date-range export of calendar PNs, used by Final View and the Calendar.
 *
 * Reuses the EXISTING export: `downloadCSV` / `campaignsToCSV` in
 * exportExcel.ts, which carries the 46-column contract. Only the row
 * selection is new — no second export was built.
 *
 * Read-only: this reads campaigns and writes a file. It changes nothing.
 *
 * CSV, not xlsx: `exportExcel.ts` has always produced CSV despite its name,
 * and there is no xlsx writer in the repo. Excel opens it directly.
 */
export function CalendarRangeExport({ campaigns, label = "Export date range" }: {
  campaigns: Campaign[];
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  // Defaults to the current planning window, the range CRM usually wants.
  const [range, setRange] = useState<DateRange>(() => planningWindow());

  const check = validateRange(range);

  /**
   * Only PNs that have REACHED the calendar, by their own campaign date.
   * `calendar_status = 'UPDATED'` is the single finalisation gate the
   * Calendar and Final View already read.
   */
  const matching = useMemo(() => {
    if (!check.valid) return [];
    return campaigns.filter((c) => {
      if (c.calendar_status !== "UPDATED") return false;
      const d = campaignDateIso(c.launch_date);
      return d !== null && d >= range.start && d <= range.end;
    });
  }, [campaigns, range, check.valid]);

  const fileName = `PN_Calendar_${range.start}_to_${range.end}.csv`;

  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>{label}</Button>

      <Modal open={open} onClose={() => setOpen(false)}
        title="Export calendar PNs" sub="Only PNs that have reached the calendar.">
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="mb-1 block text-tiny font-medium text-body">From</span>
              <input type="date" value={range.start}
                onChange={(e) => setRange((r) => ({ ...r, start: e.target.value }))} />
            </label>
            <label className="block">
              <span className="mb-1 block text-tiny font-medium text-body">To</span>
              <input type="date" value={range.end}
                onChange={(e) => setRange((r) => ({ ...r, end: e.target.value }))} />
            </label>
          </div>

          {!check.valid ? (
            <p className="rounded-lg bg-danger-50 px-3 py-2 text-tiny text-danger-700">
              {check.error}
            </p>
          ) : matching.length === 0 ? (
            /* No empty file: a header-only download looks like a success. */
            <p className="rounded-lg bg-warning-50 px-3 py-2 text-tiny text-warning-700">
              No PNs on the calendar from {fmtDate(range.start)} to {fmtDate(range.end)}.
            </p>
          ) : (
            <p className="rounded-lg bg-success-50 px-3 py-2 text-tiny text-success-700">
              {matching.length} PN{matching.length === 1 ? "" : "s"} on the calendar
              from {fmtDate(range.start)} to {fmtDate(range.end)}.
            </p>
          )}

          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={!check.valid || matching.length === 0}
              onClick={() => { downloadCSV(matching, fileName); setOpen(false); }}>
              Download ({matching.length})
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
