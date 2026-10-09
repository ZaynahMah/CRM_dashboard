"use client";

import type { Campaign } from "@/types/campaign";
import type { Profile } from "@/types/user";
import { fmtLongDate, fmtTime } from "@/lib/format";
import { Card, Pill } from "./ui";

/** Groups campaigns by time and renders the time-slot-grouped view from the PN CC spec. */
export function DayDetail({ date, campaigns, onOpenCampaign, profile }: {
  date: string;
  campaigns: Campaign[];
  onOpenCampaign: (id: string) => void;
  profile: Profile;
}) {
  // Group by launch_time
  const byTime = new Map<string, Campaign[]>();
  campaigns.forEach((c) => {
    const key = c.launch_time ?? "unscheduled";
    byTime.set(key, [...(byTime.get(key) ?? []), c]);
  });
  const sortedTimes = [...byTime.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <Card pad={false}>
      <div className="border-b border-line px-5 py-4">
        <h2 className="font-display text-[17px] font-600 text-heading">{fmtLongDate(date)}</h2>
        <p className="mt-0.5 text-tiny text-muted">
          {campaigns.length} PNs across {byTime.size} time slots
        </p>
      </div>

      <div className="divide-y divide-line">
        {sortedTimes.map(([time, rows]) => (
          <div key={time} className="px-5 py-4">
            <div className="mb-3 flex items-center gap-3">
              <span className="font-display text-[15px] font-600 text-heading">{fmtTime(time)}</span>
              <span className="text-micro text-faint">{rows.length} {rows.length === 1 ? "PN" : "PNs"}</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th>Segment</th>
                    <th>Category</th>
                    <th>Sub Category</th>
                    <th>Brand</th>
                    <th>Offer</th>
                    <th>Brief</th>
                    <th>Landing</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => {
                    const hasCategoryInput = Boolean(c.brand && c.offer);
                    return (
                      <tr key={c.id} className="cursor-pointer" onClick={() => onOpenCampaign(c.id)}>
                        <td>
                          <div className="flex items-center gap-2">
                            <Pill dot={false}
                              label={c.pncc_segment_label ?? c.audience ?? "—"}
                              tone="indigo" />
                          </div>
                        </td>
                        <td>
                          <Pill dot={false}
                            label={c.pncc_category_code ?? c.category ?? "—"}
                            tone="neutral" />
                        </td>
                        <td className="text-muted">{c.sub_category ?? "—"}</td>
                        <td className="font-medium text-heading">{c.brand ?? "—"}</td>
                        <td className="max-w-[160px] truncate text-muted">{c.offer ?? "—"}</td>
                        <td className="max-w-[120px] truncate text-muted">{c.brief ?? "—"}</td>
                        <td className="max-w-[100px] truncate text-muted">{c.landing ?? "—"}</td>
                        <td>
                          <div className="flex items-center gap-1.5">
                            <Pill
                              label={hasCategoryInput ? "Ready" : "Pending"}
                              tone={hasCategoryInput ? "success" : "warning"}
                            />
                            {c.slot_type === "ADDITIONAL" && (
                              <Pill dot={false} label="Additional" tone="info" />
                            )}
                          </div>
                        </td>
                        <td className="text-right text-tiny font-medium text-indigo-700">Open</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
