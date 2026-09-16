"use client";

import type { Campaign } from "@/types/campaign";

const STAGES = [
  { key: "crm_input", label: "CRM Input", sub: "Slot creation" },
  { key: "category_input", label: "Category Input", sub: "Brand · Offer · Brief" },
  { key: "crm_review", label: "CRM Review", sub: "QC category data" },
  { key: "crm_complete", label: "CRM Completion", sub: "Content handoff prep" },
  { key: "creative", label: "Creative / Content", sub: "Header · Copy · Assets" },
  { key: "final_qc", label: "Final QC", sub: "Tracking · Review" },
  { key: "publish", label: "Audience / Publish", sub: "Ready to go" },
];

function computeStage(campaigns: Campaign[]): number {
  if (campaigns.length === 0) return 0;
  const total = campaigns.length;
  const hasCrmSlots = campaigns.some((c) => c.crm_status !== "NOT_STARTED");
  const catFilled = campaigns.filter((c) => c.brand && c.offer).length;
  const catRatio = catFilled / total;
  const contentSent = campaigns.filter((c) =>
    c.crm_status === "SENT_TO_CONTENT" || c.content_status !== "NOT_ASSIGNED"
  ).length;
  const contentDone = campaigns.filter((c) => c.content_status === "SUBMITTED").length;
  const qcDone = campaigns.filter((c) => c.qc_status === "PASSED").length;
  const published = campaigns.filter((c) =>
    c.production_status === "READY" || c.production_status === "PUSHED"
  ).length;

  if (published > total * 0.3) return 6;
  if (qcDone > total * 0.1) return 5;
  if (contentDone > total * 0.1) return 5;
  if (contentSent > total * 0.1) return 4;
  if (catRatio > 0.3) return 3;
  if (catRatio > 0.05) return 2;
  if (hasCrmSlots) return 1;
  return 0;
}

export function MonthlyProgressBar({ campaigns }: { campaigns: Campaign[] }) {
  const active = computeStage(campaigns);

  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3.5 shadow-card">
      <div className="mb-2.5 text-[10px] font-600 uppercase tracking-wider text-faint">
        Monthly workflow
      </div>
      <div className="flex items-start">
        {STAGES.map((s, i) => {
          const done = i < active;
          const current = i === active;
          return (
            <div key={s.key} className="flex min-w-0 flex-1 flex-col items-center">
              <div className="flex w-full items-center">
                {i > 0 && <div className={`h-[2px] flex-1 ${done ? "bg-indigo-500" : "bg-line"}`} />}
                <div className={`h-2.5 w-2.5 shrink-0 rounded-full border-2 ${
                  done ? "border-indigo-500 bg-indigo-500"
                  : current ? "border-indigo-500 bg-white"
                  : "border-line bg-white"
                }`} />
                {i < STAGES.length - 1 && <div className={`h-[2px] flex-1 ${done ? "bg-indigo-500" : "bg-line"}`} />}
              </div>
              <div className="mt-1.5 text-center">
                <div className={`text-[10px] font-600 leading-tight ${
                  current ? "text-indigo-700" : done ? "text-heading" : "text-faint"}`}>
                  {s.label}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
