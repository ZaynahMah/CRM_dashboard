"use client";

import type { Campaign } from "@/types/campaign";
import { ChannelChip, DeadlineChip, OriginChip, StageChip } from "@/components/StatusChip";
import { Empty } from "@/components/ui";
import { fmtDate, fmtTime } from "@/lib/format";

export function WorkList({ campaigns, onOpen, readOnly }: {
  campaigns: Campaign[]; onOpen: (id: string) => void; readOnly?: boolean;
}) {
  if (campaigns.length === 0) {
    return <Empty title="Nothing waiting on you"
      hint="Anything that needs action will appear here as the calendar moves." />;
  }
  return (
    <table>
      <thead>
        <tr>
          <th>Launch</th><th>Campaign</th><th>Origin</th><th>Brand</th><th>Channel</th>
          <th>Audience</th><th>Stage</th><th>Deadline</th><th />
        </tr>
      </thead>
      <tbody>
        {campaigns.map((c) => (
          <tr key={c.id} className="cursor-pointer" onClick={() => onOpen(c.id)}>
            <td className="whitespace-nowrap text-tiny text-muted">
              {fmtDate(c.launch_date)} · {fmtTime(c.launch_time)}
            </td>
            <td className="max-w-[220px] truncate font-medium text-heading">{c.campaign_name}</td>
            <td><OriginChip campaign={c} /></td>
            <td className="text-muted">{c.brand ?? "—"}</td>
            <td><ChannelChip campaign={c} /></td>
            <td className="max-w-[180px] truncate text-muted">{c.audience ?? "—"}</td>
            <td><StageChip campaign={c} /></td>
            <td><DeadlineChip campaign={c} /></td>
            <td className="text-right text-tiny font-medium text-indigo-700">{readOnly ? "View" : "Open"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
