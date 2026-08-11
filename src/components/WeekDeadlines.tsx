"use client";

import { useMemo } from "react";
import type { Campaign } from "@/types/campaign";
import { Pill } from "./ui";
import { fmtDate, isoDate, toDate, today } from "@/lib/format";

interface WeekBlock {
  weekLabel: string;
  weekStart: string;
  weekEnd: string;
  deadline: string;
  campaigns: Campaign[];
  status: "Completed" | "In Progress" | "Pending";
}

export function WeekDeadlines({ campaigns, monthStart }: {
  campaigns: Campaign[];
  monthStart: Date;
}) {
  const weeks = useMemo(() => {
    const t = today();
    const blocks: WeekBlock[] = [];
    const year = monthStart.getFullYear();
    const month = monthStart.getMonth();
    const lastDay = new Date(year, month + 1, 0).getDate();

    for (let d = 1; d <= lastDay; d += 7) {
      const ws = new Date(year, month, d);
      const we = new Date(year, month, Math.min(d + 6, lastDay));
      const deadline = new Date(ws);
      deadline.setDate(deadline.getDate() - 9); // 1 week + 2 days buffer

      const wsIso = isoDate(ws);
      const weIso = isoDate(we);
      const weekCampaigns = campaigns.filter((c) => c.launch_date >= wsIso && c.launch_date <= weIso);

      const filled = weekCampaigns.filter((c) => c.brand && c.offer).length;
      const total = weekCampaigns.length;

      let status: WeekBlock["status"] = "Pending";
      if (total > 0 && filled === total) status = "Completed";
      else if (filled > 0) status = "In Progress";
      else if (deadline < t) status = "In Progress"; // past deadline

      blocks.push({
        weekLabel: `${fmtDate(wsIso)} – ${fmtDate(weIso)}`,
        weekStart: wsIso,
        weekEnd: weIso,
        deadline: isoDate(deadline),
        campaigns: weekCampaigns,
        status,
      });
    }
    return blocks;
  }, [campaigns, monthStart]);

  const tones = { Completed: "success", "In Progress": "warning", Pending: "neutral" } as const;

  return (
    <div className="rounded-xl border border-line bg-surface shadow-card">
      <div className="border-b border-line px-5 py-3.5">
        <div className="text-[14px] font-600 text-heading">Category submission deadlines</div>
        <div className="mt-0.5 text-micro text-faint">Category must submit inputs one week before each campaign week</div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Campaign week</th>
            <th>Category deadline</th>
            <th>Campaigns</th>
            <th>Filled</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((w) => {
            const filled = w.campaigns.filter((c) => c.brand && c.offer).length;
            return (
              <tr key={w.weekStart}>
                <td className="font-medium text-heading">{w.weekLabel}</td>
                <td className="text-muted">{fmtDate(w.deadline)}</td>
                <td className="text-muted">{w.campaigns.length}</td>
                <td className="text-muted">{filled} / {w.campaigns.length}</td>
                <td><Pill label={w.status} tone={tones[w.status]} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
