"use client";

import { useMemo, useState } from "react";
import type { Campaign } from "@/types/campaign";
import type { QcMap } from "@/lib/crmBuckets";
import { contentSubmitted, withContent } from "@/lib/crmBuckets";
import { Button, Card, Pill, Empty } from "./ui";
import { fmtDate, fmtTime } from "@/lib/format";
import { BulkWorkspace, type WorkspaceMode } from "./BulkWorkspace";
import { lockCategoryInput, submitContentRow } from "@/services/campaigns";

/**
 * The work surface for CATEGORY and CONTENT.
 *
 * This replaces the removed "Incoming Data" component. It exists because
 * removing that component left both roles with no queue at all — Category
 * had only the deadline widget and Content had an empty dashboard, which
 * would have hidden every PN assigned to them. Requirement: no PN may
 * disappear from any role's view.
 *
 * Deliberately thinner than what it replaces: two labelled buckets with
 * live counts and one "Show All PN" button into the spreadsheet workspace.
 * No weekly grouping, no inline per-row editor, no "pending from Category /
 * submitted back to CRM" summary line — all editing happens in the
 * workspace, which is where the team now works.
 */
export function RoleQueue({ role, campaigns, qc, profileId, onOpenCampaign, onChanged, staleIds, onReloadRow }: {
  role: "CATEGORY" | "CONTENT";
  campaigns: Campaign[];
  qc: QcMap;
  profileId: string;
  onOpenCampaign: (id: string) => void;
  onChanged: () => void;
  staleIds?: Set<string>;
  onReloadRow?: (id: string) => void;
}) {
  const [workspace, setWorkspace] = useState<
    { mode: WorkspaceMode; rows: Campaign[]; run: (ids: string[]) => Promise<void> } | null
  >(null);

  const { pending, submitted, title, pendingLabel, submittedLabel, mode } = useMemo(() => {
    if (role === "CATEGORY") {
      // Category never sees CRM Self rows — those skip Category entirely.
      const mine = campaigns.filter((c) => !c.is_crm_self && c.crm_status !== "NOT_STARTED");
      return {
        title: "Your campaigns",
        pendingLabel: "Pending your input",
        submittedLabel: "Submitted to CRM",
        mode: "CATEGORY_INPUT" as WorkspaceMode,
        pending: mine.filter((c) => c.category_status !== "LOCKED"),
        submitted: mine.filter((c) => c.category_status === "LOCKED"),
      };
    }
    return {
      title: "Your campaigns",
      pendingLabel: "Awaiting your copy",
      submittedLabel: "Submitted to CRM",
      mode: "CONTENT_INPUT" as WorkspaceMode,
      pending: campaigns.filter(withContent),
      submitted: campaigns.filter(contentSubmitted),
    };
  }, [role, campaigns]);

  const run = async (ids: string[]) => {
    for (const id of ids) {
      if (role === "CATEGORY") {
        await lockCategoryInput(id, profileId);
      } else {
        const c = campaigns.find((x) => x.id === id);
        if (!c) continue;
        await submitContentRow(id, {
          header: c.header ?? "",
          sub_copy_text: c.sub_copy_text ?? "",
          reference_link: c.reference_link ?? "",
        }, profileId);
      }
    }
  };

  if (campaigns.length === 0) {
    return (
      <Card>
        <Empty title="Nothing waiting on you right now"
          hint={role === "CATEGORY"
            ? "CRM hasn't sent any campaign slots yet."
            : "CRM hasn't routed any campaigns for copy yet."} />
      </Card>
    );
  }

  return (
    <>
      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-2.5 border-b border-line px-5 py-3.5">
          <h3 className="font-display text-[15px] font-600 text-heading">{title}</h3>
          {(pending.length > 0 || submitted.length > 0) && (
            <div className="ml-auto">
              <Button size="sm" variant="ghost"
                onClick={() => setWorkspace({ mode, rows: [...pending, ...submitted], run })}>
                Show All PN ({pending.length + submitted.length})
              </Button>
            </div>
          )}
        </div>

        <QueueBucket label={pendingLabel} tone="warning" rows={pending} onOpen={onOpenCampaign} />
        <QueueBucket label={submittedLabel} tone="success" rows={submitted} onOpen={onOpenCampaign} />
      </Card>

      {workspace && (
        <BulkWorkspace
          mode={workspace.mode}
          campaigns={workspace.rows}
          qc={qc}
          profileId={profileId}
          onClose={() => setWorkspace(null)}
          onSaved={onChanged}
          onPrimary={workspace.run}
          staleIds={staleIds}
          onReloadRow={onReloadRow}
        />
      )}
    </>
  );
}

function QueueBucket({ label, tone, rows, onOpen }: {
  label: string;
  tone: "warning" | "success";
  rows: Campaign[];
  onOpen: (id: string) => void;
  staleIds?: Set<string>;
  onReloadRow?: (id: string) => void;
}) {
  return (
    <div className="border-b border-line last:border-b-0">
      <div className="flex items-center gap-2 bg-[#FCFCFD] px-5 py-2.5">
        <span className="text-micro font-medium uppercase tracking-wide text-faint">{label}</span>
        {/* The count is rows.length — the same array rendered below, so the
            number can never disagree with what is on screen. */}
        <Pill dot={false} label={String(rows.length)} tone={rows.length === 0 ? "neutral" : tone} />
      </div>
      {rows.length === 0 ? (
        <p className="px-5 py-3 text-tiny text-faint">Nothing here right now.</p>
      ) : (
        <>
          <ul className="divide-y divide-line">
            {rows.slice(0, 15).map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-5 py-2">
                <button onClick={() => onOpen(c.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  <div className="min-w-0 flex-1">
                    <span className="text-[13px] font-medium text-heading">{c.campaign_name}</span>
                    <span className="ml-2 text-micro text-faint">
                      {fmtDate(c.launch_date)} · {fmtTime(c.launch_time)}
                      {c.brand ? ` · ${c.brand}` : ""}
                    </span>
                  </div>
                  {c.is_emergency && <Pill label="Emergency" tone="danger" />}
                  <Pill dot={false} label={c.pncc_segment_label ?? "—"} tone="indigo" />
                </button>
              </li>
            ))}
          </ul>
          {rows.length > 15 && (
            <p className="px-5 pb-2 text-micro text-faint">
              +{rows.length - 15} more — open Show All PN to see every row
            </p>
          )}
        </>
      )}
    </div>
  );
}
