"use client";

import type { Campaign } from "@/types/campaign";
import { Card, Pill } from "./ui";
import { Icon } from "./icons";

/**
 * CRM-ONLY dummy recommendations. These are NOT based on real performance data.
 * The actual recommendation engine will be built later once CVR, deliver rate,
 * CTR, historical performance data is available.
 */
const DUMMY_TIPS: { condition: (c: Campaign) => boolean; text: string }[] = [
  { condition: (c) => (c.pncc_segment_label ?? "").includes("Women"),
    text: "Women · WomAE campaigns have historically been stronger in evening slots." },
  { condition: (c) => (c.pncc_category_code ?? "") === "Westside",
    text: "Consider testing Westside in the 7:30 PM slot for higher engagement." },
  { condition: (c) => (c.pncc_segment_label ?? "").includes("Men") && (c.launch_time ?? "") >= "19:00",
    text: "Men segments tend to respond well in evening slots for apparel campaigns." },
  { condition: (c) => (c.pncc_category_code ?? "") === "Electronics",
    text: "Electronics campaigns may benefit from midday slots when browsing intent peaks." },
  { condition: () => true,
    text: "Consider avoiding overlapping campaigns targeting the same segment in adjacent time slots." },
  { condition: () => true,
    text: "This segment has fewer scheduled pushes today — consider increasing frequency." },
];

export function RecommendationPanel({ campaign, role }: {
  campaign: Campaign;
  role: string;
}) {
  // Rule 21: Recommendation is strictly CRM-only
  if (role !== "CRM") return null;

  // Pick 2-3 relevant dummy tips
  const tips = DUMMY_TIPS.filter((t) => t.condition(campaign)).slice(0, 3);

  return (
    <Card pad={false} className="overflow-hidden">
      <div className="flex items-center gap-2.5 border-b border-line bg-[#F9FAFB] px-5 py-3">
        <span className="text-faint">{Icon.spark(15)}</span>
        <span className="text-tiny font-600 text-heading">Scheduling hints</span>
        <Pill dot={false} label="Prototype" tone="neutral" />
      </div>
      <div className="px-5 py-4">
        <ul className="space-y-3">
          {tips.map((tip, i) => (
            <li key={i} className="flex gap-3 text-[13.5px] text-body">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" />
              {tip.text}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-micro text-faint">
          These are prototype suggestions, not based on actual performance data. The recommendation engine will be built once CVR, CTR and historical campaign data is available.
        </p>
      </div>
    </Card>
  );
}
