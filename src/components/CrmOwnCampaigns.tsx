"use client";

import type { Campaign } from "@/types/campaign";
import { Card, Pill } from "./ui";
import { Icon } from "./icons";

/**
 * CRM Own Campaigns — CRM-only component showing which campaign slots
 * have been filled by Category and which CRM still needs to complete.
 */
export function CrmOwnCampaigns({ campaigns, onOpen }: {
  campaigns: Campaign[];
  onOpen: (id: string) => void;
}) {
  const categoryFilled = campaigns.filter((c) => c.brand && c.offer);
  const categoryPending = campaigns.filter((c) => !c.brand || !c.offer);
  const crmCompleted = campaigns.filter((c) => c.pn_template && c.brand && c.offer);
  const crmPending = categoryFilled.filter((c) => !c.pn_template);

  const pct = campaigns.length > 0 ? Math.round((categoryFilled.length / campaigns.length) * 100) : 0;

  return (
    <Card pad={false}>
      <div className="border-b border-line px-5 py-4">
        <div className="flex items-center gap-2">
          <h3 className="font-display text-[15px] font-600 text-heading">CRM Own Campaigns</h3>
          <Pill dot={false} label="CRM only" tone="indigo" />
        </div>
        <p className="mt-1 text-micro text-faint">
          Campaign slots CRM owns after Category submission — track what's ready for you to complete
        </p>
      </div>

      {/* Progress */}
      <div className="border-b border-line px-5 py-4">
        <div className="flex items-baseline justify-between">
          <span className="text-tiny text-muted">Category filled</span>
          <span className="text-[14px] font-600 text-heading">{categoryFilled.length} / {campaigns.length}</span>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[#F2F4F7]">
          <div className="h-full rounded-full bg-gradient-to-r from-indigo-600 to-indigo-400 transition-all duration-500"
            style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MiniStat label="Category filled" value={categoryFilled.length} tone="success" />
          <MiniStat label="Category pending" value={categoryPending.length} tone="warning" />
          <MiniStat label="CRM completed" value={crmCompleted.length} tone="indigo" />
          <MiniStat label="CRM pending" value={crmPending.length} tone="neutral" />
        </div>
      </div>

      {/* Pending CRM action */}
      {crmPending.length > 0 && (
        <div className="px-5 py-4">
          <div className="mb-2 text-micro font-medium uppercase tracking-wide text-faint">
            Ready for CRM to complete ({crmPending.length})
          </div>
          <ul className="divide-y divide-line">
            {crmPending.slice(0, 8).map((c) => (
              <li key={c.id}>
                <button onClick={() => onOpen(c.id)}
                  className="flex w-full items-center gap-3 py-2.5 text-left transition-colors hover:bg-[#FCFCFD]">
                  <div className="min-w-0 flex-1">
                    <span className="text-[13px] font-medium text-heading">{c.campaign_name}</span>
                    <span className="ml-2 text-micro text-faint">
                      {c.brand} · {c.offer}
                    </span>
                  </div>
                  <Pill dot={false} label={c.pncc_segment_label ?? "—"} tone="indigo" />
                  <span className="text-micro font-medium text-indigo-700">{Icon.chevron(12)}</span>
                </button>
              </li>
            ))}
          </ul>
          {crmPending.length > 8 && (
            <p className="mt-2 text-micro text-faint">+{crmPending.length - 8} more</p>
          )}
        </div>
      )}
    </Card>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: number; tone: string }) {
  const bg = {
    success: "bg-success-50 text-success-700",
    warning: "bg-warning-50 text-warning-700",
    indigo: "bg-indigo-50 text-indigo-700",
    neutral: "bg-[#F2F4F7] text-muted",
  }[tone] ?? "bg-[#F2F4F7] text-muted";

  return (
    <div className={`rounded-lg px-3 py-2 ${bg}`}>
      <div className="text-[18px] font-700">{value}</div>
      <div className="text-micro">{label}</div>
    </div>
  );
}
