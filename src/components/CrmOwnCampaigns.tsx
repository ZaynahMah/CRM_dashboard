"use client";

import { useMemo, useState } from "react";
import type { Campaign } from "@/types/campaign";
import { Button, Card, Pill } from "./ui";
import { Icon } from "./icons";
import { sendBatchToContentAndDesign } from "@/services/campaigns";

/**
 * CRM Own Campaigns — CRM-only component showing which campaign slots
 * have been filled by Category and which CRM still needs to complete.
 * "Send to Content & Design" is a true multi-select bulk action: CRM checks
 * which campaigns to route, not an implicit "send everything ready."
 */
export function CrmOwnCampaigns({ campaigns, onOpen, profileId, onSent }: {
  campaigns: Campaign[];
  onOpen: (id: string) => void;
  profileId: string;
  onSent: () => void;
}) {
  const [sending, setSending] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const categoryFilled = campaigns.filter((c) => c.brand && c.offer);
  const categoryPending = campaigns.filter((c) => !c.brand || !c.offer);
  const crmCompleted = campaigns.filter((c) => c.pn_template && c.brand && c.offer);
  const crmPending = categoryFilled.filter((c) => !c.pn_template);

  // Reviewed and ready to route onward: CRM has completed its Part 2 fields
  // but hasn't sent the batch to Content/Design yet.
  const readyToRoute = useMemo(
    () => crmCompleted.filter((c) => c.crm_status !== "SENT_TO_CONTENT" && c.design_status === "NOT_ASSIGNED"),
    [crmCompleted]
  );

  const allSelected = readyToRoute.length > 0 && readyToRoute.every((c) => selected.has(c.id));

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(readyToRoute.map((c) => c.id)));
  };

  const handleSendBatch = async () => {
    if (selected.size === 0) return;
    setSending(true);
    try {
      await sendBatchToContentAndDesign([...selected], profileId);
      setSelected(new Set());
      onSent();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to send batch.");
    }
    setSending(false);
  };

  const pct = campaigns.length > 0 ? Math.round((categoryFilled.length / campaigns.length) * 100) : 0;

  return (
    <Card pad={false}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-display text-[15px] font-600 text-heading">CRM Own Campaigns</h3>
            <Pill dot={false} label="CRM only" tone="indigo" />
          </div>
          <p className="mt-1 text-micro text-faint">
            Campaign slots CRM owns after Category submission — track what's ready for you to complete
          </p>
        </div>
        {readyToRoute.length > 0 && (
          <Button size="sm" disabled={sending || selected.size === 0} onClick={handleSendBatch}>
            {sending ? "Sending..." : selected.size > 0 ? `Send ${selected.size} to Content & Design` : "Select campaigns to send"}
          </Button>
        )}
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

      {/* Ready to route — multi-select bulk send */}
      {readyToRoute.length > 0 && (
        <div className="border-b border-line px-5 py-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-micro font-medium uppercase tracking-wide text-faint">
              Reviewed and ready to route ({readyToRoute.length})
            </span>
            <button onClick={toggleAll} className="text-micro font-medium text-indigo-700 hover:underline">
              {allSelected ? "Clear all" : "Select all"}
            </button>
          </div>
          <ul className="divide-y divide-line">
            {readyToRoute.slice(0, 12).map((c) => (
              <li key={c.id} className="flex items-center gap-3 py-2">
                <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                <button onClick={() => onOpen(c.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  <div className="min-w-0 flex-1">
                    <span className="text-[13px] font-medium text-heading">{c.campaign_name}</span>
                    <span className="ml-2 text-micro text-faint">{c.brand} · {c.offer}</span>
                  </div>
                  <Pill dot={false} label={c.pncc_segment_label ?? "—"} tone="indigo" />
                </button>
              </li>
            ))}
          </ul>
          {readyToRoute.length > 12 && (
            <p className="mt-2 text-micro text-faint">+{readyToRoute.length - 12} more — use All Campaigns to see the rest</p>
          )}
        </div>
      )}

      {/* Still needs CRM's own fields filled before it can be routed */}
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
