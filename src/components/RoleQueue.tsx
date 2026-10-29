"use client";

import { useCallback, useMemo, useState } from "react";
import type { Campaign } from "@/types/campaign";
import type { QcMap } from "@/lib/crmBuckets";
import { contentSubmitted, withContent } from "@/lib/crmBuckets";
import { Button, Card, Pill, Empty } from "./ui";
import { fmtDate, fmtTime } from "@/lib/format";
import { businessWeekOf } from "@/lib/businessWeeks";
import {
  categorySubmittedCsv, categoryFileName, downloadCategoryExport, isSubmittedByCategory,
} from "@/services/categoryExport";
import {
  CAMPAIGN_CATEGORY_FILTER_OPTIONS, ALL_CATEGORIES_LABEL, filterByCategory,
} from "@/lib/categoryFilter";
import { campaignDateIso } from "@/lib/campaignDate";
import { planningWindow } from "@/lib/planningWindow";
import { BulkWorkspace, type WorkspaceMode } from "./BulkWorkspace";
import { lockCategoryInput, submitContentRow, type BulkCalendarOutcome } from "@/services/campaigns";

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
    { mode: WorkspaceMode; rows: Campaign[]; run: (ids: string[]) => Promise<BulkCalendarOutcome[]> } | null
  >(null);

  /**
   * Content's home category filter.
   *
   * Declared above the workspace state it outlives, so the chosen category
   * survives opening Show All PN and coming back — the workspace is a child
   * of this component, not a separate route.
   *
   * Reuses the controlled list and alias matching from lib/categoryFilter,
   * exactly as the Show All PN filter does.
   */
  const [homeCategory, setHomeCategory] = useState<string>(ALL_CATEGORIES_LABEL);

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
    // Filtered FIRST, so every section, count and Show All PN below is
    // derived from the same narrowed set. Order is untouched — the filter
    // only removes rows.
    const scoped = filterByCategory(campaigns, homeCategory);
    return {
      title: "Your campaigns",
      pendingLabel: "Awaiting your copy",
      submittedLabel: "Submitted to CRM",
      mode: "CONTENT_INPUT" as WorkspaceMode,
      pending: scoped.filter(withContent),
      submitted: scoped.filter(contentSubmitted),
    };
  }, [role, campaigns, homeCategory]);

  /**
   * Submits or locks the selected rows, ONE AT A TIME with its own
   * try/catch, and returns an outcome per row.
   *
   * This was a bare `for (const id of ids) { await ... }` with no per-row
   * handling. The first throw aborted the loop, so every row after it was
   * never even attempted — Content pressed Submit on 5 PNs, row 3 failed,
   * rows 4 and 5 silently never happened, and CRM saw 2. The only feedback
   * was one generic error naming no PN at all. That was the 5-to-3 bug.
   *
   * A row missing from `campaigns` is now reported too, rather than being
   * skipped by a bare `continue`.
   */
  const run = async (ids: string[]): Promise<BulkCalendarOutcome[]> => {
    const outcomes: BulkCalendarOutcome[] = [];
    for (const id of ids) {
      const c = campaigns.find((x) => x.id === id);
      const name = c?.campaign_name ?? id;
      try {
        if (!c) {
          throw new Error("This campaign is no longer in your queue — reload and try again.");
        }
        if (role === "CATEGORY") {
          await lockCategoryInput(id, profileId);
        } else {
          // Content must have copy before it can submit. Catching this here
          // names the PN instead of surfacing a database constraint error.
          if (!(c.header ?? "").trim() || !(c.sub_copy_text ?? "").trim()) {
            throw new Error("Header and Sub Copy are both required before submitting.");
          }
          await submitContentRow(id, {
            header: c.header ?? "",
            sub_copy_text: c.sub_copy_text ?? "",
            reference_link: c.reference_link ?? "",
          }, profileId);
        }
        outcomes.push({ campaignId: id, campaignName: name, ok: true });
      } catch (e) {
        outcomes.push({
          campaignId: id, campaignName: name, ok: false,
          reason: e instanceof Error ? e.message : String(e),
        });
      }
    }
    return outcomes;
  };

  /**
   * CATEGORY sees its incoming PN work grouped by CAMPAIGN WEEK.
   *
   * The week comes from the PN's own launch date — never from when CRM sent
   * it, nor from updated_at / created_at / submitted_at. A PN handed over on
   * 1 October but scheduled for 12 October belongs under 8–14 October, so
   * sending several future weeks at once distributes them correctly with no
   * further action.
   *
   * Weeks are the existing calendar buckets (1-7, 8-14, 15-21, 22-28,
   * 29-end) from `businessWeekOf`, and only weeks that actually have PNs are
   * rendered — the list rolls into November and beyond on its own.
   *
   * The pending/submitted split and the Show All PN behaviour are the same
   * rules used above; this only groups them.
   */
  /** Toast shown when there is nothing to export. */
  const [exportNote, setExportNote] = useState<string | null>(null);


  /**
   * Downloads the submitted PNs of whatever rows are passed in. Drafts,
   * pending, unfilled and defaulted rows are excluded; an empty result
   * tells the user rather than downloading a header-only file.
   */
  const exportSubmitted = useCallback((rows: Campaign[]) => {
    const submitted = rows.filter(isSubmittedByCategory);
    if (submitted.length === 0) {
      setExportNote("No submitted PNs to export");
      return;
    }
    setExportNote(null);
    downloadCategoryExport(categorySubmittedCsv(submitted), categoryFileName(submitted));
  }, []);

  const weekSections = useMemo(() => {
    if (role !== "CATEGORY") return [];
    const win = planningWindow();
    const byWeek = new Map<string, { label: string; start: string; rows: Campaign[] }>();
    for (const c of [...pending, ...submitted]) {
      const iso = campaignDateIso(c.launch_date);
      // A PN with no usable campaign date cannot be placed in a week; it is
      // surfaced separately below rather than dropped.
      if (!iso) continue;
      // Placed by CAMPAIGN DATE, never by when CRM sent it.
      if (iso < win.start || iso > win.end) continue;
      const w = businessWeekOf(iso);
      if (!byWeek.has(w.key)) byWeek.set(w.key, { label: w.label, start: w.start, rows: [] });
      byWeek.get(w.key)!.rows.push(c);
    }
    return [...byWeek.entries()]
      // Only weeks inside the planning window: current-month start through
      // the 14th of next month. A November PN submitted in October is here;
      // one dated 15 November is not, and remains reachable from All
      // Campaigns.
      .filter(([, w]) => w.start <= win.end && w.rows.length > 0)
      .sort((a, b) => a[1].start.localeCompare(b[1].start))
      .map(([key, w]) => ({
        key,
        label: w.label,
        rows: w.rows,
        pending: w.rows.filter((c) => c.category_status !== "LOCKED"),
        submitted: w.rows.filter((c) => c.category_status === "LOCKED"),
      }));
  }, [role, pending, submitted]);

  /** PNs CRM sent that carry no usable campaign date. Never silently lost. */
  const undated = useMemo(
    () => (role !== "CATEGORY" ? []
      : [...pending, ...submitted].filter((c) => !campaignDateIso(c.launch_date))),
    [role, pending, submitted]);

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

  if (role === "CATEGORY") {
    return (
      <>
        {weekSections.length === 0 && undated.length === 0 ? (
          <Card>
            <Empty title="Nothing waiting on you right now"
              hint="CRM hasn't sent any campaign slots yet." />
          </Card>
        ) : (
          <div className="space-y-4">
            {exportNote && (
              <div className="flex items-center justify-between gap-3 rounded-lg bg-warning-50 px-4 py-2.5 text-tiny text-warning-700">
                <span>{exportNote}</span>
                <button onClick={() => setExportNote(null)}
                  className="font-medium hover:underline">Dismiss</button>
              </div>
            )}
            {weekSections.map((w) => (
              <Card key={w.key} pad={false}>
                <div className="flex flex-wrap items-center gap-2.5 border-b border-line px-5 py-3.5">
                  <h3 className="font-display text-[15px] font-600 text-heading">{w.label}</h3>
                  <Pill dot={false} label={`All PN (${w.rows.length})`} tone="indigo" />
                  <Pill dot={false} label={`Pending your input (${w.pending.length})`}
                    tone={w.pending.length > 0 ? "warning" : "neutral"} />
                  <Pill dot={false} label={`Submitted to CRM (${w.submitted.length})`}
                    tone={w.submitted.length > 0 ? "success" : "neutral"} />
                  <div className="ml-auto flex items-center gap-2">
                    {/* The SAME workspace, scoped to this week's rows. */}
                    <Button size="sm" variant="ghost"
                      onClick={() => setWorkspace({ mode, rows: w.rows, run })}>
                      Show All PN ({w.rows.length})
                    </Button>
                    {/* Exports only what Category has SUBMITTED, from the
                        same rows this section already shows — so any
                        filtering applied above carries through. */}
                    <Button size="sm" variant="ghost"
                      onClick={() => exportSubmitted(w.rows)}>
                      Download Export ({w.rows.filter(isSubmittedByCategory).length})
                    </Button>
                  </div>
                </div>
                <QueueBucket label={pendingLabel} tone="warning" rows={w.pending} onOpen={onOpenCampaign} />
                <QueueBucket label={submittedLabel} tone="success" rows={w.submitted} onOpen={onOpenCampaign} />
              </Card>
            ))}

            {undated.length > 0 && (
              <Card pad={false}>
                <div className="flex flex-wrap items-center gap-2.5 border-b border-line px-5 py-3.5">
                  <h3 className="font-display text-[15px] font-600 text-heading">No campaign date</h3>
                  <Pill dot={false} label={`${undated.length} PN`} tone="warning" />
                  <span className="text-micro text-faint">
                    CRM sent these without a usable date, so they cannot be placed in a week.
                  </span>
                  <div className="ml-auto">
                    <Button size="sm" variant="ghost"
                      onClick={() => setWorkspace({ mode, rows: undated, run })}>
                      Show All PN ({undated.length})
                    </Button>
                  </div>
                </div>
                <QueueBucket label={pendingLabel} tone="warning"
                  rows={undated.filter((c) => c.category_status !== "LOCKED")} onOpen={onOpenCampaign} />
                <QueueBucket label={submittedLabel} tone="success"
                  rows={undated.filter((c) => c.category_status === "LOCKED")} onOpen={onOpenCampaign} />
              </Card>
            )}
          </div>
        )}

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

  return (
    <>
      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-2.5 border-b border-line px-5 py-3.5">
          <h3 className="font-display text-[15px] font-600 text-heading">{title}</h3>
          <div className="ml-auto flex items-center gap-2">
            {/* Filter by category, beside Show All PN. Same controlled list
                and alias matching as the Show All PN filter. */}
            {role === "CONTENT" && (
              <select aria-label="Filter by category"
                value={homeCategory}
                onChange={(e) => setHomeCategory(e.target.value)}
                className="!m-0 !w-[170px] !py-1 !text-[12px]">
                <option value={ALL_CATEGORIES_LABEL}>{ALL_CATEGORIES_LABEL}</option>
                {CAMPAIGN_CATEGORY_FILTER_OPTIONS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            )}
            {(pending.length > 0 || submitted.length > 0) && (
              <Button size="sm" variant="ghost"
                onClick={() => setWorkspace({ mode, rows: [...pending, ...submitted], run })}>
                Show All PN ({pending.length + submitted.length})
              </Button>
            )}
          </div>
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
