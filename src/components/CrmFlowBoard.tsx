"use client";

import { useMemo, useState } from "react";
import type { Campaign } from "@/types/campaign";
import { Button, Card, Pill } from "./ui";
import { Icon } from "./icons";
import { fmtDate, fmtTime } from "@/lib/format";
import {
  sendBatchToContent, markCopyReviewed, bulkUpdateCalendar,
  type BulkCalendarOutcome,
} from "@/services/campaigns";
import {
  type QcMap,
  fromCategoryPending, fromCategoryCompleted, isDefaulted,
  fromContentPending, fromContentReady, withContent,
  crmSelfUploadPending, crmSelfUploadCompleted, sentToContent,
} from "@/lib/crmBuckets";
import { BulkWorkspace, type WorkspaceMode } from "./BulkWorkspace";

/**
 * The CRM dashboard, as one layout used six times.
 *
 * Every section is the same shape — a Pending bucket and a Completed bucket,
 * each with a count and an optional selected-rows action — so the handoff
 * chain reads down the page in order:
 *
 *   Category -> CRM -> Content -> CRM Final QC -> Calendar
 *
 * Nothing here introduces a status. Sections are filtered views over the one
 * campaign list the rest of the app already reads.
 */

interface Action {
  label: string;
  /** Applied to each selected id in turn; every call names one UUID. */
  run: (ids: string[]) => Promise<void>;
}

export function CrmFlowBoard({ campaigns, qc, profileId, onChanged, onOpen, staleIds, onReloadRow }: {
  campaigns: Campaign[];
  qc: QcMap;
  profileId: string;
  onChanged: () => void;
  onOpen: (id: string) => void;
  staleIds?: Set<string>;
  onReloadRow?: (id: string) => void;
}) {
  const categoryLed = useMemo(() => campaigns.filter((c) => !c.is_crm_self), [campaigns]);
  const crmSelf = useMemo(() => campaigns.filter((c) => c.is_crm_self), [campaigns]);

  const sendToContent: Action = {
    label: "Bulk Send Selected to Content",
    run: (ids) => sendBatchToContent(ids, profileId),
  };
  const markReviewed: Action = {
    label: "Mark reviewed",
    run: async (ids) => { for (const id of ids) await markCopyReviewed(id, profileId); },
  };
  /**
   * Push to calendar. Routed through bulkUpdateCalendar, which calls the
   * same server-side update_calendar() RPC the drawer uses, once per
   * campaign. It never sets qc_status from the client — a PN that has not
   * passed QC is reported as a failure and left in QC.
   */
  const pushToCalendar: Action = {
    label: "Bulk Push To Calendar",
    run: async (ids) => {
      const rows = campaigns.filter((c) => ids.includes(c.id));
      const outcomes = await bulkUpdateCalendar(rows, profileId, qc);
      const failed = outcomes.filter((o) => !o.ok);
      if (failed.length > 0) {
        throw new Error(
          `${outcomes.length - failed.length} pushed, ${failed.length} could not be: ` +
          failed.slice(0, 3).map((f) => `${f.campaignName} (${f.reason})`).join("; ") +
          (failed.length > 3 ? `, and ${failed.length - 3} more` : "") +
          ". Open Show All PN for the full list."
        );
      }
    },
  };

  /** Which queue the workspace is currently showing, if any. */
  const [workspace, setWorkspace] = useState<
    { mode: WorkspaceMode; rows: Campaign[]; run: (ids: string[]) => Promise<BulkCalendarOutcome[] | void> } | null
  >(null);

  /**
   * Content-submitted PNs across BOTH flows.
   *
   * CRM saw "2" under Incoming From Content and thought three submissions
   * were lost — they were in the CRM Self section. Nothing was missing, but
   * nothing said so. This banner states the combined total and the split,
   * and opens a workspace containing every Content-submitted PN from both
   * flows. Bucket logic is untouched.
   */
  const contentSubmittedAll = useMemo(
    () => campaigns.filter((c) => fromContentPending(c, qc) || fromContentReady(c, qc)),
    [campaigns, qc]
  );
  const contentLed = contentSubmittedAll.filter((c) => !c.is_crm_self);
  const contentSelf = contentSubmittedAll.filter((c) => c.is_crm_self);

  const common = { qc, onChanged, onOpen };

  return (
    <div className="space-y-8">
      {contentSubmittedAll.length > 0 && (
        <button
          onClick={() => setWorkspace({
            mode: "FINAL_QC", rows: contentSubmittedAll,
            run: (ids) => bulkUpdateCalendar(
              campaigns.filter((c) => ids.includes(c.id)), profileId, qc),
          })}
          className="flex w-full items-center gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-5 py-3.5 text-left transition-colors hover:bg-indigo-100"
        >
          <span className="font-display text-[15px] font-600 text-indigo-900">
            Incoming From Content: {contentSubmittedAll.length}
          </span>
          <span className="text-tiny text-indigo-700">
            (Category-led {contentLed.length} · CRM Self {contentSelf.length})
          </span>
          <span className="ml-auto text-micro font-medium text-indigo-700">
            Show All PN →
          </span>
        </button>
      )}

      <FlowHeading
        title="Category-led flow"
        chain="Category → CRM → Content → CRM Final QC → Calendar"
      />

      <FlowSection
        {...common}
        step={1}
        title="Incoming Inputs From Category"
        pending={{
          label: "Pending CRM Input",
          hint: "Category submitted — CRM Part 2 still to complete",
          rows: categoryLed.filter(fromCategoryPending),
        }}
        completed={{
          label: "Completed CRM Input",
          hint: "CRM Part 2 complete — ready to send to Content",
          rows: categoryLed.filter(fromCategoryCompleted),
          action: sendToContent,
        }}
        /* NEW: PNs whose own TAT passed with no Category input. They arrive
           with the Category fields BLANK — nothing was auto-filled — and
           CRM fills both Category and Part 2 in the same row. Completing a
           row moves it to Completed CRM Input and it can then be sent to
           Content as usual. */
        inFlight={{
          label: "Defaulted PN",
          rows: categoryLed.filter(isDefaulted).filter((c) => !fromCategoryCompleted(c)),
        }}
        showAll={{
          label: "Show All PN",
          rows: categoryLed.filter((c) =>
            fromCategoryPending(c) || fromCategoryCompleted(c) || isDefaulted(c)),
          open: (rows) => setWorkspace({
            mode: "CATEGORY_REVIEW", rows,
            run: (ids) => sendBatchToContent(ids, profileId),
          }),
        }}
      />

      <FlowSection
        {...common}
        step={2}
        title="Incoming From Content — Category-led"
        pending={{
          label: "Pending CRM Review",
          hint: "Content submitted — CRM review pending",
          rows: categoryLed.filter((c) => fromContentPending(c, qc)),
          action: markReviewed,
        }}
        completed={{
          label: "Ready for Final QC",
          hint: "CRM reviewed — ready for Final QC and calendar",
          rows: categoryLed.filter((c) => fromContentReady(c, qc)),
          action: pushToCalendar,
        }}
        inFlight={{
          label: "Still with Content",
          rows: categoryLed.filter(withContent),
        }}
        showAll={{
          label: "Show All PN",
          rows: categoryLed.filter((c) => fromContentPending(c, qc) || fromContentReady(c, qc)),
          open: (rows) => setWorkspace({
            mode: "FINAL_QC", rows,
            // Returns one outcome per PN so the workspace can show which
            // succeeded, which failed, and why.
            run: async (ids) =>
              bulkUpdateCalendar(campaigns.filter((c) => ids.includes(c.id)), profileId, qc),
          }),
        }}
      />

      <FlowHeading
        title="CRM Self flow"
        chain="CRM Self Upload → Content → CRM Final QC → Calendar"
        note="These campaigns skip Category entirely."
      />

      <FlowSection
        {...common}
        step={1}
        title="CRM Self Upload"
        pending={{
          label: "Pending CRM Input",
          hint: "Uploaded — not yet routed to Content",
          rows: crmSelf.filter(crmSelfUploadPending),
        }}
        completed={{
          label: "Completed CRM Input",
          hint: "CRM input complete · send to Content",
          rows: crmSelf.filter(crmSelfUploadCompleted),
          action: sendToContent,
        }}
        inFlight={{
          label: "Sent to Content (read-only)",
          rows: crmSelf.filter(sentToContent),
        }}
      />

      <FlowSection
        {...common}
        step={2}
        title="Incoming From Content — CRM Self"
        pending={{
          label: "Pending CRM Review",
          hint: "Content submitted — CRM review pending",
          rows: crmSelf.filter((c) => fromContentPending(c, qc)),
          action: markReviewed,
        }}
        completed={{
          label: "Ready for Final QC",
          hint: "CRM reviewed — ready for Final QC and calendar",
          rows: crmSelf.filter((c) => fromContentReady(c, qc)),
          action: pushToCalendar,
        }}
        inFlight={{
          label: "Still with Content",
          rows: crmSelf.filter(withContent),
        }}
        showAll={{
          label: "Show All PN",
          rows: crmSelf.filter((c) => fromContentPending(c, qc) || fromContentReady(c, qc)),
          open: (rows) => setWorkspace({
            mode: "FINAL_QC", rows,
            // Returns one outcome per PN so the workspace can show which
            // succeeded, which failed, and why.
            run: async (ids) =>
              bulkUpdateCalendar(campaigns.filter((c) => ids.includes(c.id)), profileId, qc),
          }),
        }}
      />

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
    </div>
  );
}

function FlowHeading({ title, chain, note }: { title: string; chain: string; note?: string }) {
  return (
    <div className="border-l-2 border-indigo-600 pl-3">
      <h2 className="font-display text-[17px] font-700 uppercase tracking-wide text-heading">{title}</h2>
      <p className="mt-0.5 font-mono text-micro text-muted">{chain}</p>
      {note && <p className="mt-0.5 text-micro text-faint">{note}</p>}
    </div>
  );
}

interface BucketSpec {
  label: string;
  hint: string;
  rows: Campaign[];
  action?: Action;
  footer?: string;
}

function FlowSection({ step, title, pending, completed, inFlight, showAll, qc, onChanged, onOpen }: {
  step: number;
  title: string;
  pending: BucketSpec;
  completed: BucketSpec;
  /** Routed but not yet back from both teams — visible, not actionable. */
  inFlight?: { label: string; rows: Campaign[] };
  /** Opens the spreadsheet workspace for this whole section. */
  showAll?: { label: string; rows: Campaign[]; open: (rows: Campaign[]) => void };
  qc: QcMap;
  onChanged: () => void;
  onOpen: (id: string) => void;
  staleIds?: Set<string>;
  onReloadRow?: (id: string) => void;
}) {
  return (
    <Card pad={false}>
      <div className="flex flex-wrap items-center gap-2.5 border-b border-line px-5 py-3.5">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-indigo-50 text-[11px] font-700 text-indigo-700">
          {step}
        </span>
        <h3 className="font-display text-[15px] font-600 text-heading">{title}</h3>
        {showAll && showAll.rows.length > 0 && (
          <div className="ml-auto">
            <Button size="sm" variant="ghost" onClick={() => showAll.open(showAll.rows)}>
              {showAll.label} ({showAll.rows.length})
            </Button>
          </div>
        )}
      </div>
      <Bucket spec={pending} tone="warning" onChanged={onChanged} onOpen={onOpen} />
      <Bucket spec={completed} tone="success" onChanged={onChanged} onOpen={onOpen} />
      {inFlight && inFlight.rows.length > 0 && (
        <div className="border-t border-line px-5 py-2.5">
          <span className="text-micro font-medium uppercase tracking-wide text-faint">
            {inFlight.label}
          </span>
          <span className="ml-2 text-micro text-faint">
            {inFlight.rows.length} campaign{inFlight.rows.length === 1 ? "" : "s"} — Content
            has these; they return here when submitted.
          </span>
        </div>
      )}
    </Card>
  );
}

function Bucket({ spec, tone, onChanged, onOpen }: {
  spec: BucketSpec;
  tone: "warning" | "success";
  onChanged: () => void;
  onOpen: (id: string) => void;
  staleIds?: Set<string>;
  onReloadRow?: (id: string) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  /**
   * A visual echo of what this bucket just sent, nothing more.
   *
   * Once routed, a campaign matches no bucket at all — it is in flight with
   * the next team — so it would otherwise disappear the instant you click,
   * leaving no confirmation of what went. These snapshots are taken at click
   * time, held in component state, and gone on reload. They are never fed
   * back into the bucket conditions in `crmBuckets.ts`: a faded row is not a
   * second active membership, and `rows.length` still counts only actionable
   * campaigns.
   *
   * No status, no column, no migration. Deliberately not persisted — it is
   * an aid to the person who just clicked, and should not outlive them.
   */
  const [justSent, setJustSent] = useState<Campaign[]>([]);

  const { rows, action } = spec;
  const allSelected = rows.length > 0 && rows.every((c) => selected.has(c.id));

  // Defensive: if a row somehow returns to the active list, the live row
  // wins and the echo is dropped, so it can never render twice.
  const activeIds = new Set(rows.map((c) => c.id));
  const echoes = justSent.filter((c) => !activeIds.has(c.id));

  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const run = async () => {
    if (!action || selected.size === 0) return;
    const ids = [...selected];
    // Snapshot before the write: these rows are about to stop matching this
    // bucket. Name, date, brand and segment are untouched by routing, so the
    // snapshot cannot go stale for anything shown.
    const snapshot = rows.filter((c) => selected.has(c.id));
    setBusy(true); setError(null); setDone(null);
    try {
      await action.run(ids);
      setSelected(new Set());
      setJustSent((prev) => [
        ...prev.filter((c) => !ids.includes(c.id)),
        ...snapshot,
      ]);
      setDone(`${ids.length} campaign${ids.length === 1 ? "" : "s"} updated.`);
      onChanged();
    } catch (e) {
      // The real message, not a generic one — a failed bulk action that says
      // "something went wrong" is indistinguishable from a silent no-op.
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  return (
    <div className="border-b border-line last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-[#FCFCFD] px-5 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-micro font-medium uppercase tracking-wide text-faint">{spec.label}</span>
          <Pill dot={false} label={String(rows.length)} tone={rows.length === 0 ? "neutral" : tone} />
          <span className="text-micro text-faint">· {spec.hint}</span>
        </div>
        {action && rows.length > 0 && (
          <button onClick={() => setSelected(allSelected ? new Set() : new Set(rows.map((c) => c.id)))}
            className="text-micro font-medium text-indigo-700 hover:underline">
            {allSelected ? "Clear all" : "Select all"}
          </button>
        )}
      </div>

      {rows.length === 0 && echoes.length === 0 ? (
        <p className="px-5 py-3 text-tiny text-faint">Nothing here right now.</p>
      ) : (
        <>
          <ul className="divide-y divide-line">
            {rows.slice(0, 15).map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-5 py-2">
                {action && (
                  <input type="checkbox" checked={selected.has(c.id)}
                    disabled={busy} onChange={() => toggle(c.id)} />
                )}
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
              +{rows.length - 15} more — use All Campaigns to see the rest
            </p>
          )}

          {echoes.length > 0 && (
            <>
              <p className="px-5 pt-2 text-micro font-medium uppercase tracking-wide text-faint">
                Just sent — no longer actionable here
              </p>
              <ul className="divide-y divide-line opacity-45">
                {echoes.map((c) => (
                  // No checkbox, not selectable, not counted. Rendered as a
                  // static row rather than a button so it cannot be clicked.
                  <li key={`sent-${c.id}`} className="flex items-center gap-3 px-5 py-2"
                      aria-disabled="true">
                    {action && <span className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                    <div className="min-w-0 flex-1">
                      <span className="text-[13px] font-medium text-heading line-through decoration-1">
                        {c.campaign_name}
                      </span>
                      <span className="ml-2 text-micro text-faint">
                        {fmtDate(c.launch_date)} · {fmtTime(c.launch_time)}
                        {c.brand ? ` · ${c.brand}` : ""}
                      </span>
                    </div>
                    {c.is_emergency && <Pill label="Emergency" tone="danger" />}
                    <Pill dot={false} label={c.pncc_segment_label ?? "—"} tone="neutral" />
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {(action || spec.footer) && (
        <div className="flex flex-wrap items-center gap-3 px-5 pb-3.5 pt-1">
          {action && (
            <Button size="sm" disabled={busy || selected.size === 0} onClick={run}>
              {busy
                ? <><span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" /> Working...</>
                : selected.size > 0 ? `${action.label} (${selected.size})` : action.label}
            </Button>
          )}
          {spec.footer && <span className="text-micro text-faint">{spec.footer}</span>}
          {done && (
            <span className="flex items-center gap-1.5 text-micro text-success-700">
              {Icon.check(12)} {done}
            </span>
          )}
          {error && (
            <span className="flex items-start gap-1.5 text-micro text-danger-700">
              {Icon.alert(12)} {error}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
