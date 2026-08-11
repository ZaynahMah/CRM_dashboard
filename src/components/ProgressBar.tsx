"use client";

import type { Campaign } from "@/types/campaign";

const STAGES = [
  { key: "crm_input", label: "CRM Input", sub: "Day · Time · Segment · Category" },
  { key: "category_input", label: "Category Input", sub: "Brand · Offer · Brief · Landing" },
  { key: "crm_review", label: "CRM Review", sub: "Review and complete" },
  { key: "crm_reco", label: "Recommendation", sub: "CRM-only insights" },
  { key: "creative", label: "Creative / Content", sub: "Copy · Creative · Assets" },
  { key: "qc_publish", label: "QC & Publish", sub: "Final check → production" },
];

function currentStageIndex(campaigns: Campaign[]): number {
  if (campaigns.length === 0) return 0;
  const hasCategory = campaigns.some((c) => c.brand && c.offer);
  const hasContent = campaigns.some((c) => c.content_status === "SUBMITTED");
  const hasReady = campaigns.some((c) => c.production_status === "READY" || c.production_status === "PUSHED");

  if (hasReady) return 5;
  if (hasContent) return 4;
  if (hasCategory) return 2;
  return 1;
}

export function MonthlyProgressBar({ campaigns }: { campaigns: Campaign[] }) {
  const active = currentStageIndex(campaigns);

  return (
    <div className="rounded-xl border border-line bg-surface px-5 py-4 shadow-card">
      <div className="mb-3 text-micro font-medium uppercase tracking-wide text-faint">
        Monthly workflow progress
      </div>
      <div className="flex items-start gap-0">
        {STAGES.map((s, i) => {
          const done = i < active;
          const current = i === active;
          return (
            <div key={s.key} className="flex min-w-0 flex-1 flex-col items-center">
              {/* Connector + dot */}
              <div className="flex w-full items-center">
                {i > 0 && (
                  <div className={`h-[2px] flex-1 ${done ? "bg-indigo-500" : "bg-line"}`} />
                )}
                <div className={`h-3 w-3 shrink-0 rounded-full border-2 ${
                  done ? "border-indigo-500 bg-indigo-500"
                  : current ? "border-indigo-500 bg-white"
                  : "border-line bg-white"
                }`}>
                  {done && (
                    <svg viewBox="0 0 12 12" className="h-full w-full text-white">
                      <path d="M3 6l2 2 4-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  )}
                </div>
                {i < STAGES.length - 1 && (
                  <div className={`h-[2px] flex-1 ${done ? "bg-indigo-500" : "bg-line"}`} />
                )}
              </div>
              {/* Label */}
              <div className="mt-2 text-center">
                <div className={`text-micro font-600 ${current ? "text-indigo-700" : done ? "text-heading" : "text-faint"}`}>
                  {s.label}
                </div>
                <div className="mt-0.5 hidden text-[10px] text-faint sm:block">{s.sub}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
