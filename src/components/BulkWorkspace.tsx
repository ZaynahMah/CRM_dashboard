"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Campaign, QcChecklist } from "@/types/campaign";
import { updateCampaign, saveQc, type BulkCalendarOutcome } from "@/services/campaigns";
import {
  buildFromCampaign, suggestTrackingFields, buildLandingPlusTracking,
  shouldGenerate, trackingCheck,
} from "@/lib/trackingCode";
import { fmtDate, fmtTime } from "@/lib/format";
import { Button, Pill } from "./ui";
import { creativeRequired, QC_NA_LABEL } from "@/lib/workflow";
import { Icon } from "./icons";
import { markRowDirty, isRowDirty } from "./useCampaigns";
import { SearchSelect } from "./SearchSelect";
import masterData from "@/data/masterData.json";
import {
  CAMPAIGN_TYPE_PN, CAMPAIGN_NAME_PRP, CHANNEL_NAME_PUSH, CHANNEL_FORMATS,
  SEGMENT_1_VALUES, SEGMENT_2_VALUES, SEGMENT_2_LABELS, CATEGORY_VALUES, SUB_CATEGORY_VALUES,
  LANDING_VALUES, OFFER_VALUES, KEYWORD_VALUES,
} from "@/lib/trackingMasters";

/**
 * The bulk operations workspace: every PN as a row, every field as a column,
 * edited in place without opening a single record.
 *
 * One component serves both queues — they differ only in which columns they
 * show and what the primary action does — because two near-identical
 * spreadsheets would drift apart within a month.
 *
 * Edits are held in a dirty map keyed by campaign UUID and flushed on Save.
 * Nothing autosaves: in a grid this dense, a stray keystroke writing to the
 * database immediately is worse than an explicit save.
 */

export type WorkspaceMode = "CATEGORY_REVIEW" | "FINAL_QC" | "CATEGORY_INPUT" | "CONTENT_INPUT";

type Dirty = Record<string, Partial<Campaign>>;
type DirtyQc = Record<string, Partial<QcChecklist>>;

interface ColumnDef {
  key: keyof Campaign;
  label: string;
  width: number;
  type?: "text" | "bool" | "brand" | "readonly" | "select";
  /** Allowed values when type is "select". */
  options?: readonly string[];
  /** Optional display labels, keyed by value. The stored value is unchanged. */
  labels?: Record<string, string>;
  /**
   * A fixed tracking value (cid / pn / prp / push). Rendered without a
   * blank option so it cannot be cleared — a blank here would silently
   * produce an invalid code.
   */
  fixed?: boolean;
}

/** What Category fills in. Mirrors categoryValidation's mandatory set. */
const CATEGORY_INPUT_COLUMNS: ColumnDef[] = [
  { key: "campaign_name", label: "Campaign Name", width: 190, type: "readonly" },
  { key: "sub_category", label: "Sub Category", width: 140 },
  { key: "brand", label: "Brand", width: 150, type: "brand" },
  { key: "offer", label: "Offer", width: 160 },
  { key: "brief", label: "Brief", width: 220 },
  { key: "landing", label: "Landing", width: 200 },
  { key: "expected_cvr", label: "Exp. CVR", width: 90 },
  { key: "expected_rpv", label: "Exp. RPV", width: 90 },
  { key: "additional_notes", label: "Comments", width: 180 },
];

/** What Content fills in. H/S counts stay derived, never typed. */
const CONTENT_INPUT_COLUMNS: ColumnDef[] = [
  { key: "campaign_name", label: "Campaign Name", width: 190, type: "readonly" },
  { key: "brand", label: "Brand", width: 140, type: "readonly" },
  { key: "offer", label: "Offer", width: 150, type: "readonly" },
  { key: "title_brief", label: "Title Brief", width: 190, type: "readonly" },
  { key: "message_brief", label: "Message Brief", width: 190, type: "readonly" },
  { key: "header", label: "Header", width: 220 },
  { key: "sub_copy_text", label: "Sub Copy", width: 220 },
  { key: "reference_link", label: "Reference Link", width: 180 },
];

/** CRM Part 2 — what has to be filled before work goes to Content. */
const CATEGORY_COLUMNS: ColumnDef[] = [
  { key: "campaign_name", label: "Campaign Name", width: 190 },
  { key: "sub_category", label: "Sub Category", width: 140 },
  { key: "brand", label: "Brand", width: 150, type: "brand" },
  { key: "offer", label: "Offer", width: 160 },
  { key: "landing", label: "Landing", width: 200 },
  { key: "title_brief", label: "Title Brief", width: 200 },
  { key: "message_brief", label: "Message Brief", width: 200 },
  { key: "pn_template", label: "PN Template", width: 140 },
  { key: "creative_requirements", label: "Creative Reqs", width: 190 },
  { key: "expected_cvr", label: "Exp. CVR", width: 90 },
  { key: "expected_rpv", label: "Exp. RPV", width: 90 },
];

/** Final QC — every field CRM used to open each record to check. */
const QC_COLUMNS: ColumnDef[] = [
  { key: "campaign_name", label: "Campaign Name", width: 190 },
  { key: "header", label: "Header", width: 200 },
  { key: "sub_copy_text", label: "Sub Copy", width: 200 },
  { key: "creative_link", label: "Creative Link", width: 190 },
  { key: "sound", label: "Sound", width: 70, type: "bool" },
  { key: "global_limit", label: "GL", width: 60, type: "bool" },
  // Tracking short codes — dropdowns, never free text. Master lists live
  // in lib/trackingMasters.ts so new values need no code change.
  { fixed: true, key: "campaign_type", label: "Campaign Type", width: 110, type: "select", options: [CAMPAIGN_TYPE_PN] },
  { fixed: true, key: "campaign_name_code", label: "Campaign Name", width: 110, type: "select", options: [CAMPAIGN_NAME_PRP] },
  { fixed: true, key: "channel_name", label: "Channel Name", width: 110, type: "select", options: [CHANNEL_NAME_PUSH] },
  { key: "channel_format", label: "Channel Format", width: 110, type: "select", options: CHANNEL_FORMATS },
  { key: "segment_1", label: "Segment 1", width: 130, type: "select", options: SEGMENT_1_VALUES },
  { key: "segment_2", label: "Segment 2", width: 110, type: "select", options: SEGMENT_2_VALUES, labels: SEGMENT_2_LABELS },
  { key: "tracking_category", label: "Category (code)", width: 130, type: "select", options: CATEGORY_VALUES },
  { key: "tracking_sub_category", label: "Sub Cat (code)", width: 130, type: "select", options: SUB_CATEGORY_VALUES },
  { key: "tracking_brand", label: "Brand (code)", width: 130 },
  { key: "tracking_landing", label: "Landing (code)", width: 110, type: "select", options: LANDING_VALUES },
  { key: "tracking_offer", label: "Offer (code)", width: 110, type: "select", options: OFFER_VALUES },
  { key: "keywords", label: "Keywords", width: 120, type: "select", options: KEYWORD_VALUES },
  { key: "tracking_code_check", label: "Check", width: 130, type: "readonly" },
  { key: "cid", label: "CID", width: 120 },
  { key: "campaign_id_ext", label: "Campaign ID", width: 130 },
  { key: "tracking_code", label: "Tracking Code", width: 280 },
  { key: "collapse", label: "Collapse ID", width: 120 },
  { key: "group_id", label: "Group ID", width: 120 },
  { key: "ops_details", label: "Ops Details", width: 180 },
  { key: "feedback_1", label: "Feedback 1", width: 160 },
  { key: "feedback_2", label: "Feedback 2", width: 160 },
];

/** The ten Final QC checklist boxes, edited inline rather than in a drawer. */
const QC_CHECKS: { key: keyof QcChecklist; label: string }[] = [
  { key: "category_verified", label: "Cat" },
  { key: "brand_verified", label: "Brand" },
  { key: "offer_verified", label: "Offer" },
  { key: "landing_verified", label: "Landing" },
  { key: "date_verified", label: "Date" },
  { key: "time_verified", label: "Time" },
  { key: "audience_verified", label: "Audience" },
  { key: "creative_verified", label: "Creative" },
  { key: "copy_verified", label: "Copy" },
  { key: "tracking_verified", label: "Tracking" },
];

export function BulkWorkspace({
  mode, campaigns, qc, profileId, onClose, onSaved, onPrimary, staleIds, onReloadRow,
}: {
  mode: WorkspaceMode;
  campaigns: Campaign[];
  qc: Record<string, QcChecklist | undefined>;
  profileId: string;
  onClose: () => void;
  onSaved: () => void;
  /** Returns one outcome per campaign when the action can partially fail. */
  onPrimary: (ids: string[]) => Promise<BulkCalendarOutcome[] | void>;
  /** Rows a realtime update arrived for while they had unsaved edits. */
  staleIds?: Set<string>;
  onReloadRow?: (id: string) => void;
}) {
  const [dirty, setDirty] = useState<Dirty>({});
  const [dirtyQc, setDirtyQc] = useState<DirtyQc>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<null | "save" | "primary">(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  /** Per-PN results of the last bulk action, shown until dismissed. */
  const [outcomes, setOutcomes] = useState<BulkCalendarOutcome[] | null>(null);
  /** "Apply to selected rows": which column, and which value. */
  const [fillKey, setFillKey] = useState<string>("");
  const [fillValue, setFillValue] = useState<string>("");

  const columns =
    mode === "FINAL_QC" ? QC_COLUMNS
    : mode === "CATEGORY_INPUT" ? CATEGORY_INPUT_COLUMNS
    : mode === "CONTENT_INPUT" ? CONTENT_INPUT_COLUMNS
    : CATEGORY_COLUMNS;
  const isQc = mode === "FINAL_QC";
  const dirtyCount = Object.keys(dirty).length + Object.keys(dirtyQc).length;

  /**
   * Publish which rows are mid-edit so realtime leaves them alone (#11),
   * and clear the flags on unmount so a closed workspace never keeps a row
   * frozen.
   */
  useEffect(() => {
    const ids = new Set([...Object.keys(dirty), ...Object.keys(dirtyQc)]);
    ids.forEach((id) => markRowDirty(id, true));
    return () => { ids.forEach((id) => markRowDirty(id, false)); };
  }, [dirty, dirtyQc]);

  /**
   * Escape closes only when there is nothing unsaved; otherwise a reflex
   * keypress would discard a screen of work. The X in the top right is
   * always available and warns.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dirtyCount === 0) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [dirtyCount, onClose]);

  const valueOf = useCallback((c: Campaign, key: keyof Campaign) => {
    const patch = dirty[c.id];
    const v = patch && key in patch ? patch[key] : c[key];
    return v === null || v === undefined ? "" : String(v);
  }, [dirty]);

  const boolOf = useCallback((c: Campaign, key: keyof Campaign) => {
    const patch = dirty[c.id];
    return Boolean(patch && key in patch ? patch[key] : c[key]);
  }, [dirty]);

  const qcOf = useCallback((c: Campaign, key: keyof QcChecklist) => {
    const patch = dirtyQc[c.id];
    if (patch && key in patch) return Boolean(patch[key]);
    return Boolean(qc[c.id]?.[key]);
  }, [dirtyQc, qc]);

  const setField = useCallback((id: string, key: keyof Campaign, value: unknown) => {
    setDirty((prev) => ({ ...prev, [id]: { ...prev[id], [key]: value } }));
    setDone(null);
  }, []);

  const setQcField = useCallback((id: string, key: keyof QcChecklist, value: boolean) => {
    setDirtyQc((prev) => ({ ...prev, [id]: { ...prev[id], [key]: value } }));
    setDone(null);
  }, []);

  /* ---------------- tracking code ---------------- */

  /**
   * Generates for the selected rows, or all rows when none are selected.
   * Under the "once" rule an existing code is left alone unless `force` is
   * set, so a routine pass cannot silently rewrite codes already live in
   * analytics.
   */
  const generateTracking = (force: boolean) => {
    const targets = selected.size > 0 ? campaigns.filter((c) => selected.has(c.id)) : campaigns;
    let written = 0, skipped = 0, incomplete = 0;
    const patch: Dirty = {};
    for (const c of targets) {
      const merged = { ...c, ...dirty[c.id] } as Campaign;
      if (!shouldGenerate(merged, force)) { skipped++; continue; }
      const { code, valid } = buildFromCampaign(merged);
      if (!valid) { incomplete++; continue; }   // no "na" padding — see trackingCode.ts
      const landing = buildLandingPlusTracking(merged.landing, code);
      patch[c.id] = {
        ...dirty[c.id],
        tracking_code: code,
        landing_plus_tracking: landing.url || null,
        tracking_code_check: trackingCheck(suggestTrackingFields(merged)).label,
      };
      written++;
    }
    setDirty((prev) => ({ ...prev, ...patch }));
    setDone(
      `${written} code${written === 1 ? "" : "s"} generated` +
      (skipped ? `, ${skipped} left alone (already set — use Regenerate to overwrite)` : "") +
      (incomplete ? `, ${incomplete} blocked by missing tracking fields` : "") +
      ". Not saved yet."
    );
  };

  /* ---------------- bulk fill ---------------- */

  /** Columns that can be bulk-filled: the dropdown tracking fields. */
  const fillableColumns = columns.filter((c) => c.type === "select" && !c.fixed);
  const fillColumn = fillableColumns.find((c) => String(c.key) === fillKey);

  /**
   * Writes one value into one column for the SELECTED rows only.
   *
   * Goes into the dirty map exactly like a typed edit, so it respects the
   * explicit Save — nothing reaches the database until Save Draft. Rows that
   * are not selected are never touched, which is why this iterates the
   * selection rather than the whole grid.
   *
   * Built for Segment 2 and Sub Category: neither can be derived from the
   * source sheet, so CRM sets them by hand on every row, and doing that one
   * cell at a time across a hundred PNs is the slowest thing on this screen.
   */
  const applyToSelected = () => {
    if (!fillColumn || selected.size === 0) return;
    const key = fillColumn.key;
    setDirty((prev) => {
      const next = { ...prev };
      for (const id of selected) {
        next[id] = { ...next[id], [key]: fillValue };
      }
      return next;
    });
    setDone(
      `${fillColumn.label} set to "${fillValue || "(blank)"}" on ${selected.size} ` +
      `selected row${selected.size === 1 ? "" : "s"}. Not saved yet — press Save Draft.`
    );
  };

  /* ---------------- persistence ---------------- */

  const saveAll = async () => {
    if (dirtyCount === 0) return;
    setBusy("save"); setError(null); setDone(null);
    try {
      // One write per campaign UUID, as everywhere else in this app.
      for (const [id, patch] of Object.entries(dirty)) {
        await updateCampaign(id, patch);
      }
      for (const [id, patch] of Object.entries(dirtyQc)) {
        await saveQc(id, patch);
      }
      const n = dirtyCount;
      setDirty({}); setDirtyQc({});
      setDone(`Saved ${n} campaign${n === 1 ? "" : "s"}.`);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(null);
  };

  const runPrimary = async () => {
    if (selected.size === 0) return;
    setBusy("primary"); setError(null); setDone(null);
    try {
      // Unsaved edits are flushed first, so the action never operates on a
      // version of the row the user cannot see.
      if (dirtyCount > 0) {
        for (const [id, patch] of Object.entries(dirty)) await updateCampaign(id, patch);
        for (const [id, patch] of Object.entries(dirtyQc)) await saveQc(id, patch);
        setDirty({}); setDirtyQc({});
      }
      const ids = [...selected];
      const result = await onPrimary(ids);
      if (Array.isArray(result)) {
        // Partial success is the normal case, not an error: each PN was
        // validated on its own and the failures are still in QC.
        const ok = result.filter((r) => r.ok);
        setOutcomes(result);
        // Keep the failures selected so the operator can fix and retry
        // without hunting for them again.
        setSelected(new Set(result.filter((r) => !r.ok).map((r) => r.campaignId)));
        setDone(`${ok.length} of ${result.length} pushed to calendar.`);
      } else {
        setSelected(new Set());
        setDone(`${ids.length} campaign${ids.length === 1 ? "" : "s"} processed.`);
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(null);
  };

  const attemptClose = () => {
    if (dirtyCount > 0 &&
        !confirm(`You have unsaved changes to ${dirtyCount} campaign${dirtyCount === 1 ? "" : "s"}. Close and discard them?`)) {
      return;
    }
    onClose();
  };

  const allSelected = campaigns.length > 0 && campaigns.every((c) => selected.has(c.id));
  const primaryLabel =
    mode === "FINAL_QC" ? "Bulk Push To Calendar"
    : mode === "CATEGORY_INPUT" ? "Lock & Submit To CRM"
    : mode === "CONTENT_INPUT" ? "Submit To CRM"
    : "Bulk Send To Content";

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
      {/* No click-outside-to-close: in a grid this dense, a misplaced click
          would throw away a screen of unsaved work. Only the X closes. */}
      <div className="flex h-[92vh] w-[88vw] flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-pop">

        {/* ---------- header ---------- */}
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-line px-5 py-3">
          <div className="flex items-center gap-3">
            <h2 className="font-display text-[16px] font-600 text-heading">
              {mode === "FINAL_QC" ? "Final QC — all PNs"
                : mode === "CATEGORY_INPUT" ? "Category input — all PNs"
                : mode === "CONTENT_INPUT" ? "Content copy — all PNs"
                : "Category inputs — all PNs"}
            </h2>
            <Pill dot={false} label={`${campaigns.length} rows`} tone="indigo" />
            {dirtyCount > 0 && <Pill dot={false} label={`${dirtyCount} unsaved`} tone="warning" />}
            {selected.size > 0 && <Pill dot={false} label={`${selected.size} selected`} tone="success" />}
          </div>
          <button onClick={attemptClose} aria-label="Close workspace"
            className="rounded-lg px-2.5 py-1.5 text-[18px] leading-none text-faint hover:bg-[#F9FAFB] hover:text-heading">
            ✕
          </button>
        </div>

        {/* ---------- toolbar ---------- */}
        <div className="flex shrink-0 flex-wrap items-center gap-2.5 border-b border-line bg-[#FCFCFD] px-5 py-2.5">
          <Button size="sm" variant="ghost" disabled={busy !== null || dirtyCount === 0} onClick={saveAll}>
            {busy === "save" ? "Saving..." : "Save Draft"}
          </Button>
          <Button size="sm" disabled={busy !== null || selected.size === 0} onClick={runPrimary}>
            {busy === "primary" ? "Working..." : `${primaryLabel}${selected.size ? ` (${selected.size})` : ""}`}
          </Button>
          {isQc && (
            <>
              <span className="mx-1 h-4 w-px bg-line" />
              <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => generateTracking(false)}>
                Generate Tracking Codes
              </Button>
              <button
                disabled={busy !== null}
                onClick={() => {
                  if (confirm("Regenerate will OVERWRITE tracking codes that already exist. Codes already live in analytics will change. Continue?")) {
                    generateTracking(true);
                  }
                }}
                className="text-micro font-medium text-indigo-700 hover:underline disabled:opacity-40">
                Regenerate (overwrite)
              </button>
            </>
          )}
          {fillableColumns.length > 0 && (
            <>
              <span className="mx-1 h-4 w-px bg-line" />
              <div className="flex items-center gap-1.5">
                <select
                  value={fillKey}
                  onChange={(e) => { setFillKey(e.target.value); setFillValue(""); }}
                  className="!m-0 !w-[150px] !py-1 !text-[12px]">
                  <option value="">Bulk fill column…</option>
                  {fillableColumns.map((c) => (
                    <option key={String(c.key)} value={String(c.key)}>{c.label}</option>
                  ))}
                </select>
                <select
                  value={fillValue}
                  disabled={!fillColumn}
                  onChange={(e) => setFillValue(e.target.value)}
                  className="!m-0 !w-[130px] !py-1 !text-[12px]">
                  <option value="">Value…</option>
                  {(fillColumn?.options ?? []).map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
                <Button size="sm" variant="ghost"
                  disabled={busy !== null || !fillColumn || !fillValue || selected.size === 0}
                  onClick={applyToSelected}>
                  Apply to selected{selected.size ? ` (${selected.size})` : ""}
                </Button>
              </div>
            </>
          )}

          <div className="ml-auto flex items-center gap-3">
            {done && <span className="flex items-center gap-1.5 text-micro text-success-700">{Icon.check(12)} {done}</span>}
            {error && <span className="flex items-center gap-1.5 text-micro text-danger-700">{Icon.alert(12)} {error}</span>}
          </div>
        </div>

        {/* ---------- per-PN result summary ---------- */}
        {outcomes && (
          <div className="shrink-0 border-b border-line bg-[#FCFCFD] px-5 py-3">
            <div className="mb-2 flex items-center gap-3">
              <Pill dot={false} label={`${outcomes.filter((o) => o.ok).length} succeeded`} tone="success" />
              <Pill dot={false} label={`${outcomes.filter((o) => !o.ok).length} failed`} tone={
                outcomes.some((o) => !o.ok) ? "danger" : "neutral"} />
              <span className="text-micro text-faint">
                Failed PNs stay in QC and remain selected below.
              </span>
              <button onClick={() => setOutcomes(null)}
                className="ml-auto text-micro font-medium text-indigo-700 hover:underline">
                Dismiss
              </button>
            </div>
            <div className="max-h-[22vh] overflow-y-auto rounded-lg border border-line bg-surface">
              <table className="w-full text-tiny">
                <tbody>
                  {outcomes.map((o) => (
                    <tr key={o.campaignId} className="border-b border-line last:border-b-0">
                      <td className="w-6 px-2 py-1.5">
                        {o.ok
                          ? <span className="text-success-700">{Icon.check(12)}</span>
                          : <span className="text-danger-700">{Icon.alert(12)}</span>}
                      </td>
                      <td className="px-2 py-1.5 font-medium text-heading">{o.campaignName}</td>
                      <td className="px-2 py-1.5 font-mono text-[10px] text-faint">{o.campaignId}</td>
                      <td className="px-2 py-1.5 text-muted">{o.ok ? "Pushed to calendar" : o.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ---------- grid ---------- */}
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="border-separate border-spacing-0 text-[12.5px]">
            <thead>
              <tr>
                {/* Sticky in both axes: the header stays while scrolling down,
                    the first two columns stay while scrolling right, so a row
                    never loses its identity. */}
                <th className="sticky left-0 top-0 z-30 w-10 border-b border-r border-line bg-[#F9FAFB] px-2 py-2">
                  <input type="checkbox" checked={allSelected}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(campaigns.map((c) => c.id)))} />
                </th>
                <th className="sticky left-10 top-0 z-30 w-[150px] border-b border-r border-line bg-[#F9FAFB] px-2 py-2 text-left text-micro font-600 uppercase tracking-wide text-faint">
                  Date / Time
                </th>
                {columns.map((col) => (
                  <th key={String(col.key)} style={{ minWidth: col.width }}
                    className="sticky top-0 z-20 border-b border-r border-line bg-[#F9FAFB] px-2 py-2 text-left text-micro font-600 uppercase tracking-wide text-faint">
                    {col.label}
                  </th>
                ))}
                {isQc && QC_CHECKS.map((q) => (
                  <th key={String(q.key)} style={{ minWidth: 56 }}
                    className="sticky top-0 z-20 border-b border-r border-line bg-indigo-50 px-1 py-2 text-center text-micro font-600 uppercase tracking-wide text-indigo-700">
                    {q.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c, i) => (
                <tr key={c.id} className={i % 2 ? "bg-[#FCFCFD]" : "bg-surface"}>
                  <td className={`sticky left-0 z-10 border-b border-r border-line px-2 py-1 ${i % 2 ? "bg-[#FCFCFD]" : "bg-surface"}`}>
                    <input type="checkbox" checked={selected.has(c.id)} onChange={() => setSelected((p) => {
                      const n = new Set(p); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n;
                    })} />
                  </td>
                  <td className={`sticky left-10 z-10 whitespace-nowrap border-b border-r border-line px-2 py-1 text-tiny ${i % 2 ? "bg-[#FCFCFD]" : "bg-surface"}`}>
                    <span className="font-medium text-heading">{fmtDate(c.launch_date)}</span>
                    <span className="ml-1.5 text-faint">{fmtTime(c.launch_time)}</span>
                    {c.is_emergency && <span className="ml-1 text-danger-700">●</span>}
                    {staleIds?.has(c.id) && (
                      <button onClick={() => onReloadRow?.(c.id)}
                        title="Someone else changed this row while you were editing it"
                        className="ml-1.5 rounded bg-warning-50 px-1 py-0.5 text-[9px] font-600 text-warning-700 hover:underline">
                        Changed by someone else – reload row
                      </button>
                    )}
                  </td>

                  {columns.map((col) => (
                    <td key={String(col.key)} className="border-b border-r border-line p-0">
                      {col.type === "bool" ? (
                        <div className="flex justify-center py-1.5">
                          <input type="checkbox" checked={boolOf(c, col.key)}
                            onChange={(e) => setField(c.id, col.key, e.target.checked)} />
                        </div>
                      ) : col.type === "brand" ? (
                        <div className="px-1 py-0.5">
                          <SearchSelect portal allowCreate value={valueOf(c, col.key)}
                            onChange={(v) => setField(c.id, col.key, v)}
                            options={masterData.brands} placeholder="Brand" />
                        </div>
                      ) : col.type === "select" ? (
                        <select
                          value={valueOf(c, col.key)}
                          onChange={(e) => setField(c.id, col.key, e.target.value)}
                          className="!m-0 !w-full !rounded-none !border-0 !bg-transparent !px-1.5 !py-1.5 !text-[12px]">
                          {!col.fixed && <option value="">—</option>}
                          {(col.options ?? []).map((o) => (
                            // Label is display only; the stored value is `o`.
                            <option key={o} value={o}>{col.labels?.[o] ?? o}</option>
                          ))}
                        </select>
                      ) : col.type === "readonly" ? (
                        <span className="block px-2 py-1.5 text-[12.5px] text-muted">
                          {valueOf(c, col.key) || "—"}
                        </span>
                      ) : (
                        <input
                          value={valueOf(c, col.key)}
                          onChange={(e) => setField(c.id, col.key, e.target.value)}
                          className={`!m-0 !w-full !rounded-none !border-0 !bg-transparent !px-2 !py-1.5 !text-[12.5px] !shadow-none focus:!bg-indigo-50 focus:!ring-1 focus:!ring-indigo-300 ${
                            col.key === "tracking_code" ? "!font-mono !text-[11px]" : ""}`}
                        />
                      )}
                    </td>
                  ))}

                  {isQc && QC_CHECKS.map((q) => {
                    // Creative verification does not apply without a creative
                    // link — shown as N/A rather than an unticked box (#7).
                    const na = q.key === "creative_verified" && !creativeRequired(c);
                    return (
                      <td key={String(q.key)} className="border-b border-r border-line bg-indigo-50/30 text-center">
                        {na ? (
                          <span title={QC_NA_LABEL} className="text-[10px] text-faint">N/A</span>
                        ) : (
                          <input type="checkbox" checked={qcOf(c, q.key)}
                            onChange={(e) => setQcField(c.id, q.key, e.target.checked)} />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {campaigns.length === 0 && (
            <p className="px-5 py-10 text-center text-tiny text-muted">Nothing in this queue right now.</p>
          )}
        </div>

        {/* ---------- footer ---------- */}
        <div className="flex shrink-0 items-center justify-between border-t border-line bg-[#FCFCFD] px-5 py-2 text-micro text-faint">
          <span>
            {mode === "FINAL_QC"
              ? "Tick all ten QC boxes for a row before pushing it to the calendar."
              : mode === "CATEGORY_INPUT"
                ? "Fill every column, then select rows and submit them to CRM."
                : mode === "CONTENT_INPUT"
                  ? "Write the header and sub copy, then select rows and submit them to CRM."
                  : "Fill CRM Part 2, then select rows and send them to Content."}
          </span>
          <span>Scroll right for more columns · Esc closes when nothing is unsaved</span>
        </div>
      </div>
    </div>
  );
}
