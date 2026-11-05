"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Campaign, QcChecklist } from "@/types/campaign";
import { updateCampaign, saveQc, type BulkCalendarOutcome } from "@/services/campaigns";
import {
  buildFromCampaign, suggestTrackingFields, buildLandingPlusTracking,
  shouldGenerate, trackingCheck,
} from "@/lib/trackingCode";
import { fmtDate, fmtTime, slotDisplay } from "@/lib/format";
import {
  pnDeadlineDate, timeLeftLabel, deadlinePassed, deadlineImminent,
} from "@/lib/deadlines";
import { Button, Pill } from "./ui";
import { SendBackModal } from "./SendBackModal";
import { bulkSendBackToContent } from "@/services/sendBack";
import {
  CAMPAIGN_CATEGORY_FILTER_OPTIONS, ALL_CATEGORIES_LABEL, filterByCategory,
} from "@/lib/categoryFilter";
import { creativeRequired, QC_NA_LABEL } from "@/lib/workflow";
import { Icon } from "./icons";
import { markRowDirty, isRowDirty, onDashboardReset } from "./useCampaigns";
import { SearchSelect } from "./SearchSelect";
import masterData from "@/data/masterData.json";
import { CHANNEL_FORMATS, LANDING_VALUES } from "@/lib/trackingMasters";
import {
  optionsFor, subcategoriesFor, isSubcategoryValid, isOffList,
  BULK_FILL_KEYS, isValidNewBrandCode, mergeOptions, isDuplicateOption,
} from "@/lib/pnDropdowns";
import { PN_TEMPLATES, PN_TYPES, TITLE_BRIEFS } from "@/config/pnOptions";
import {
  CATEGORY_REQUIRED, validateCategorySelection, isCategoryFieldFilled,
  type IncompleteCategoryPn,
} from "@/lib/categoryValidation";
import { campaignDateIso } from "@/lib/campaignDate";
import {
  rangeBetween, inRange, parseClipboard, toClipboard, planPaste, pasteSummary,
  type CellRef, type PastePlan,
} from "@/lib/gridClipboard";
import { rowLabel } from "@/services/campaigns";
import { listCustomOptions, addCustomOption } from "@/services/customOptions";
import { FIXED_TRACKING_VALUES } from "@/lib/trackingFields";

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

/**
 * Writes are sent in batches so a 3,000-row action does not open 3,000
 * concurrent requests. Each batch runs its writes in parallel; batches run
 * in sequence.
 */
const WRITE_BATCH_SIZE = 500;

/**
 * The Deadline cell. Shows the date plus a live countdown, ambers under 24
 * hours, and reads Submitted or Defaulted once those are settled.
 */
function DeadlineCell({ campaign, now }: { campaign: Campaign; now: Date }) {
  const submitted = campaign.category_status === "LOCKED"
    || campaign.category_status === "SUBMITTED";
  if (submitted) {
    return <span className="block px-2 py-1.5 text-[12.5px] text-success-700">Submitted</span>;
  }
  if (campaign.defaulted_at || deadlinePassed(campaign.launch_date, now)) {
    return <span className="block px-2 py-1.5 text-[12.5px] font-medium text-danger-700">Defaulted</span>;
  }
  const due = pnDeadlineDate(campaign.launch_date);
  const left = timeLeftLabel(campaign.launch_date, now);
  if (!due || !left) {
    return <span className="block px-2 py-1.5 text-[12.5px] text-muted">—</span>;
  }
  const soon = deadlineImminent(campaign.launch_date, now);
  return (
    <span className={`block px-2 py-1.5 text-[12.5px] ${
      soon ? "font-medium text-warning-700" : "text-muted"}`}>
      {fmtDate(due)} · {left}
    </span>
  );
}

/**
 * A tracking dropdown cell.
 *
 * Handles the three behaviours the plain <select> could not: a dependent
 * sub-category list, type-to-filter for long lists, and showing a stored
 * value that is no longer in the option list instead of wiping it.
 */
const TrackingCell = memo(function TrackingCell({
  col, categoryCode: rawCategoryCode, value, onPick,
  mergedList, onCreate, createError,
}: {
  col: ColumnDef;
  /**
   * The row's category code AS CURRENTLY EDITED.
   *
   * BUG FIX: this used to read `campaign.tracking_category`, the SAVED row.
   * A pick in the grid goes into the `dirty` map, never onto the campaign,
   * so a category code chosen moments ago was invisible here and Sub Cat
   * stayed locked. The caller now passes `valueOf(c, "tracking_category")`,
   * which merges dirty over saved — the same accessor every other cell uses.
   */
  categoryCode: string;
  value: string;
  onPick: (v: string) => void;
  /** JSON options plus anything CRM has added, merged ONCE by the caller. */
  mergedList?: readonly string[];
  /** Adds a new value to the shared list. Brand only, today. */
  onCreate?: (v: string) => Promise<void>;
  createError?: string | null;
}) {
  // Trimmed, because a stored value may carry whitespace the JSON keys lack.
  const categoryCode = (rawCategoryCode ?? "").toString().trim();
  const dependent = col.dependsOnCategoryCode === true;
  const opts = dependent ? subcategoriesFor(categoryCode) : (col.options ?? []);
  /**
   * Locked ONLY while no category code is set. A code that is set but
   * unknown to the JSON (an older value) leaves the cell enabled with an
   * empty list plus the off-list hint, rather than locked — locking it would
   * tell CRM to "select a category code first" when one is already there.
   */
  const locked = dependent && categoryCode === "";
  const unknownCategory = dependent && categoryCode !== "" && opts.length === 0;
  const offList = isOffList(String(col.key), value);
  // JSON first, added values appended in the order they were added.
  /**
   * Already merged by the caller. Merging here cost a 3,598-entry Set per
   * cell per render, which is what made scrolling stutter.
   */
  const mergedOptions = mergedList ?? opts;
  const onCreateValue = onCreate;

  if (locked) {
    return (
      <span className="block px-2 py-1.5 text-[11.5px] italic text-faint">
        Select category code first
      </span>
    );
  }

  if (col.searchable) {
    return (
      <div className="relative px-1 py-0.5">
        <SearchSelect portal value={value} onChange={onPick}
          options={mergedOptions as string[]}
          allowCreate={col.allowCreate}
          onCreate={col.allowCreate ? onCreateValue : undefined}
          createLabel="+ Add new brand code"
          createError={createError}
          placeholder={col.label} />
        {offList && <OffListHint />}
      </div>
    );
  }

  return (
    <span className="relative block">
      <select value={value} onChange={(e) => onPick(e.target.value)}
        className="!m-0 !w-full !rounded-none !border-0 !bg-transparent !px-1.5 !py-1.5 !text-[12px]">
        {!col.fixed && <option value="">—</option>}
        {/* A stored value outside the list stays selectable, so saving the
            row cannot silently change it. */}
        {offList && <option value={value}>{value}</option>}
        {opts.map((o) => (
          <option key={o} value={o}>{col.labels?.[o] ?? o}</option>
        ))}
      </select>
      {offList && <OffListHint />}
      {unknownCategory && (
        <span title={`No sub-categories are defined for “${categoryCode}”.`}
          className="pointer-events-none absolute right-0.5 top-0.5 text-[10px] leading-none text-warning-700">
          •
        </span>
      )}
    </span>
  );
});

/** Marks a saved value that is not in the current option list. */
/**
 * A marker, not a second line: an extra line changed the row height and fed
 * the vibration loop. The text is kept in `title` so the meaning survives.
 */
const OffListHint = () => (
  <span title="This saved value is not in the current option list."
    className="pointer-events-none absolute right-0.5 top-0.5 text-[10px] leading-none text-warning-700">
    •
  </span>
);

/** Fixed row height, in px, that the virtualizer's arithmetic depends on. */
const ROW_HEIGHT = 33;

/**
 * Applied to every cell in a fixed-height mode, so nothing inside a row can
 * make it taller than the virtualizer believes it is.
 */
const FIXED_CELL = "h-[33px] max-h-[33px] overflow-hidden align-middle";

async function inBatches<T>(
  items: T[], fn: (item: T) => Promise<unknown>,
  onProgress?: (done: number, total: number) => void
) {
  for (let i = 0; i < items.length; i += WRITE_BATCH_SIZE) {
    const slice = items.slice(i, i + WRITE_BATCH_SIZE);
    await Promise.all(slice.map(fn));
    onProgress?.(Math.min(i + slice.length, items.length), items.length);
  }
}

export type WorkspaceMode = "CATEGORY_REVIEW" | "FINAL_QC" | "CATEGORY_INPUT" | "CONTENT_INPUT";

type Dirty = Record<string, Partial<Campaign>>;
type DirtyQc = Record<string, Partial<QcChecklist>>;

interface ColumnDef {
  key: keyof Campaign;
  label: string;
  width: number;
  type?: "text" | "bool" | "brand" | "readonly" | "select" | "deadline";
  /** Allowed values when type is "select". */
  options?: readonly string[];
  /**
   * Long copy. Rendered wrapped and in full — never clipped, never behind
   * a tooltip. Content has to scan 60 rows without opening each one.
   */
  longText?: boolean;
  /** Optional display labels, keyed by value. The stored value is unchanged. */
  labels?: Record<string, string>;
  /**
   * A fixed tracking value (cid / pn / prp / push). Rendered without a
   * blank option so it cannot be cleared — a blank here would silently
   * produce an invalid code.
   */
  fixed?: boolean;
  /** Group heading above the column: CRM / Category / Content / Tracking. */
  group?: "CRM" | "Category" | "Content" | "Tracking";
  /** Sub-category: its options depend on the row's category code. */
  dependsOnCategoryCode?: boolean;
  /** Type-to-filter, for long option lists. */
  searchable?: boolean;
  /** Brand code only: CRM may type a value that is not in the list. */
  allowCreate?: boolean;
}

/** What Category fills in. Mirrors categoryValidation's mandatory set. */
const CATEGORY_INPUT_COLUMNS: ColumnDef[] = [
  // Deadline FIRST: it is the thing Category must act on.
  { key: "launch_date", label: "Deadline", width: 150, type: "deadline" },
  // The original CRM/category input context, read-only: Category needs to
  // see what it is writing against. Date and Time are SEPARATE columns —
  // the sticky left block already shows a combined "Date / Time", and a
  // combined cell cannot be read or scanned per field.
  { key: "launch_date", label: "Date", width: 100, type: "readonly" },
  { key: "launch_time", label: "Time", width: 80, type: "readonly" },
  { key: "slot_label", label: "Slot", width: 64, type: "readonly" },
  { key: "pncc_segment_label", label: "Segment", width: 150, type: "readonly" },
  { key: "category", label: "Category", width: 130, type: "readonly" },
  { key: "campaign_name", label: "Campaign Name", width: 190, type: "readonly" },
  { key: "sub_category", label: "Sub Category", width: 140 },
  // Free text, not a brand picker: Category must be able to type any value,
  // including several brands in one cell ("Nike, Adidas, Puma").
  { key: "brand", label: "Brand", width: 150 },
  { key: "offer", label: "Offer", width: 160 },
  { key: "brief", label: "Brief", width: 220 },
  { key: "landing", label: "Landing", width: 200 },
  { key: "expected_cvr", label: "Exp. CVR", width: 90 },
  { key: "expected_rpv", label: "Exp. RPV", width: 90 },
  { key: "additional_notes", label: "Comments", width: 180 },
];

/** What Content fills in. H/S counts stay derived, never typed. */
/**
 * Content's list view. Every copy field is marked longText so it wraps and
 * shows in full: Content was opening each record one at a time just to read
 * a sentence.
 *
 * Widths are kept moderate on purpose. The brief asked for taller rows and
 * wrapped text rather than a table so wide it scrolls sideways forever.
 */
/**
 * ADDITION C — the full input chain Content needs, in the agreed order.
 *
 * 1-17 are read-only: they come from CRM Step 1, Category and CRM Part 2.
 * Ownership is unchanged — Content still writes only Header and Sub Copy,
 * and `enforce_column_ownership()` enforces that in Postgres regardless of
 * what this grid shows. H Count and S Count stay derived from the text.
 */
const CONTENT_INPUT_COLUMNS: ColumnDef[] = [
  // ── A. From CRM Step 1 and Category (read-only) ──
  { group: "CRM",      key: "launch_date",        label: "Date",          width: 100, type: "readonly" },
  { group: "CRM",      key: "launch_time",        label: "Time",          width: 90,  type: "readonly" },
  { group: "CRM",      key: "category",           label: "Category",      width: 130, type: "readonly" },
  { group: "CRM",      key: "pncc_segment_label", label: "Segment",       width: 150, type: "readonly" },
  { group: "CRM",      key: "slot_label",         label: "Slot",          width: 70,  type: "readonly" },
  { group: "Category", key: "sub_category",       label: "Sub Category",  width: 140, type: "readonly" },
  { group: "Category", key: "brand",              label: "Brand",         width: 150, type: "readonly" },
  { group: "Category", key: "offer",              label: "Offer",         width: 160, type: "readonly" },
  { group: "Category", key: "landing",            label: "Landing",       width: 220, type: "readonly" },
  { group: "Category", key: "expected_cvr",       label: "Exp. CVR",      width: 100, type: "readonly" },
  { group: "Category", key: "expected_rpv",       label: "Exp. RPV",      width: 100, type: "readonly" },
  { group: "Category", key: "brief",              label: "Category Brief",width: 230, type: "readonly", longText: true },
  // ── CRM Part 2, shown exactly as CRM entered it ──
  { group: "CRM",      key: "title_brief",        label: "Title Brief",   width: 220, type: "readonly", longText: true },
  { group: "CRM",      key: "message_brief",      label: "Message Brief", width: 220, type: "readonly", longText: true },
  { group: "CRM",      key: "pn_template",        label: "PN Template",   width: 150, type: "readonly" },
  { group: "CRM",      key: "creative_requirements", label: "Creative Reqs", width: 200, type: "readonly", longText: true },
  { group: "CRM",      key: "pn_type",            label: "PN Type",       width: 100, type: "readonly" },
  // ── B. Content's own inputs, editing unchanged ──
  { group: "Content",  key: "header",             label: "Header",        width: 220, longText: true },
  { group: "Content",  key: "sub_copy_text",      label: "Sub Copy",      width: 280, longText: true },
  { group: "Content",  key: "h_count",            label: "H Count",       width: 80,  type: "readonly" },
  { group: "Content",  key: "s_count",            label: "S Count",       width: 80,  type: "readonly" },
  { group: "Content",  key: "reference_link",     label: "Reference Link",width: 170 },
  // Decision 1: Comments restored as the LAST column, behaving as before.
  { group: "Content",  key: "additional_notes",   label: "Comments",      width: 200, longText: true },
];


/** CRM Part 2 — what has to be filled before work goes to Content. */
/**
 * CRM's review of Category input ("Incoming Inputs From Category" → Show
 * All PN). CRM-login only; the Category login's own Show All PN uses
 * CATEGORY_INPUT_COLUMNS and is untouched.
 *
 * Category, Segment and Slot are what CRM uploaded, so they are read-only
 * here. Category Brief is Category's own field and is read-only for CRM.
 * Title Brief, Message Brief, PN Template and Creative Reqs stay editable,
 * with the same save and submit behaviour as before.
 *
 * Campaign Name is removed from THIS view only — not from the data, and
 * not from any other table.
 */
const CATEGORY_COLUMNS: ColumnDef[] = [
  { key: "launch_date", label: "Date", width: 100, type: "readonly" },
  { key: "launch_time", label: "Time", width: 80, type: "readonly" },
  { key: "category", label: "Category", width: 130, type: "readonly" },
  { key: "pncc_segment_label", label: "Segment", width: 150, type: "readonly" },
  // The RAW uploaded Slot. Never slot_type, never "Standard".
  { key: "slot_label", label: "Slot", width: 70, type: "readonly" },
  { key: "sub_category", label: "Sub Category", width: 140 },
  { key: "brand", label: "Brand", width: 150 },
  { key: "offer", label: "Offer", width: 160 },
  { key: "landing", label: "Landing", width: 200 },
  { key: "expected_cvr", label: "Exp. CVR", width: 90 },
  { key: "expected_rpv", label: "Exp. RPV", width: 90 },
  // Category's own brief, read-only for CRM. Wrapped, never clipped.
  { key: "brief", label: "Category Brief", width: 230, type: "readonly", longText: true },
  // Still editable by CRM, exactly as before.
  { key: "title_brief", label: "Title Brief", width: 190, type: "select",
    options: TITLE_BRIEFS },
  { key: "message_brief", label: "Message Brief", width: 230, longText: true },
  // Ten options from src/config/pnOptions. An old stored value still shows,
  // flagged "not in list" by the off-list check in TrackingCell.
  { key: "pn_template", label: "PN Template", width: 170, type: "select",
    options: PN_TEMPLATES },
  { key: "creative_requirements", label: "Creative Reqs", width: 200, longText: true },
  // ITEM 2: PN Type — CRM's fifth Part 2 field, given TO Content.
  { key: "pn_type", label: "PN Type", width: 110, type: "select", options: PN_TYPES },
];

/** Final QC — every field CRM used to open each record to check. */
const QC_COLUMNS: ColumnDef[] = [
  // ── CRM Step 1, read-only: what CRM uploaded ──
  { group: "CRM", key: "launch_date", label: "Date", width: 100, type: "readonly" },
  { group: "CRM", key: "launch_time", label: "Time", width: 90, type: "readonly" },
  // Slot shows the uploaded value. Its logic is UNCHANGED — no dropdown.
  { group: "CRM", key: "slot_label", label: "Slot", width: 70, type: "readonly" },
  { group: "CRM", key: "pncc_segment_label", label: "Segment", width: 150, type: "readonly" },
  { group: "CRM", key: "category", label: "Category", width: 130, type: "readonly" },
  // ── Category input, read-only here ──
  { group: "Category", key: "campaign_name", label: "Campaign Name", width: 190 },
  { group: "Category", key: "sub_category", label: "Sub Category", width: 140, type: "readonly" },
  { group: "Category", key: "brand", label: "Brand", width: 150, type: "readonly" },
  { group: "Category", key: "offer", label: "Offer", width: 160, type: "readonly" },
  { group: "Category", key: "landing", label: "Landing Link", width: 220, type: "readonly" },
  { group: "Category", key: "expected_cvr", label: "Expected CVR", width: 110, type: "readonly" },
  { group: "Category", key: "expected_rpv", label: "Expected RPV", width: 110, type: "readonly" },
  { group: "Category", key: "brief", label: "Category Brief", width: 230, type: "readonly", longText: true },
  { group: "Category", key: "additional_notes", label: "Comments", width: 200, type: "readonly", longText: true },
  // ── Content input ──
  { group: "Content", key: "header", label: "Header", width: 200 },
  { group: "Content", key: "sub_copy_text", label: "Sub Copy", width: 200 },
  { group: "Content", key: "h_count", label: "H Count", width: 80, type: "readonly" },
  { group: "Content", key: "s_count", label: "S Count", width: 80, type: "readonly" },
  { group: "Content", key: "pn_type", label: "PN Type", width: 100, type: "readonly" },
  { group: "Content", key: "creative_link", label: "Creative Link", width: 190 },
  { group: "Tracking", key: "sound", label: "Sound", width: 70, type: "bool" },
  { group: "Tracking", key: "global_limit", label: "GL", width: 60, type: "bool" },
  // Tracking short codes — dropdowns, never free text. Master lists live
  // in lib/trackingMasters.ts so new values need no code change.
  // Entry method from lib/trackingFields.ts — the SAME config the drawer
  // uses, so Solo PN and Show All PN cannot drift apart.
  // Options come from src/config/pn_dropdown_options.json via lib/pnDropdowns.
  // Nothing is hard-coded here, so CRM updates the JSON and the lists follow.
  { group: "Tracking", key: "campaign_type", label: "Campaign Type", width: 130, type: "select", options: optionsFor("campaign_type") },
  { group: "Tracking", key: "campaign_name_code", label: "Campaign Name", width: 130, type: "select", options: optionsFor("campaign_name_code") },
  { group: "Tracking", key: "channel_name", label: "Channel Name", width: 130, type: "select", options: optionsFor("channel_name") },
  { group: "Tracking", key: "channel_format", label: "Channel Format", width: 130, type: "select", options: optionsFor("channel_format") },
  { group: "Tracking", key: "segment_1", label: "Segment 1", width: 150, type: "select", options: optionsFor("segment_1"), searchable: true },
  { group: "Tracking", key: "segment_2", label: "Segment 2", width: 120, type: "select", options: optionsFor("segment_2") },
  { group: "Tracking", key: "tracking_category", label: "Category (code)", width: 140, type: "select", options: optionsFor("tracking_category") },
  // Dependent: disabled until Category (code) is chosen.
  { group: "Tracking", key: "tracking_sub_category", label: "Sub Cat (code)", width: 150, type: "select", dependsOnCategoryCode: true },
  // 3,598 values — searchable, and CRM may add a new code.
  { group: "Tracking", key: "tracking_brand", label: "Brand (code)", width: 150, type: "select", options: optionsFor("tracking_brand"), searchable: true, allowCreate: true },
  { group: "Tracking", key: "tracking_landing", label: "Landing (code)", width: 130, type: "select", options: optionsFor("tracking_landing") },
  { group: "Tracking", key: "tracking_offer", label: "Offer (code)", width: 130, type: "select", options: optionsFor("tracking_offer") },
  { group: "Tracking", key: "keywords", label: "Keywords", width: 150, type: "select", options: optionsFor("keywords"), searchable: true },
  { group: "Tracking", key: "tracking_code_check", label: "Check", width: 130, type: "readonly" },
  { group: "Tracking", key: "cid", label: "CID", width: 120 },
  { group: "Tracking", key: "campaign_id_ext", label: "Campaign ID", width: 130 },
  { group: "Tracking", key: "tracking_code", label: "Tracking Code", width: 280 },
  { group: "Tracking", key: "collapse", label: "Collapse ID", width: 120 },
  { group: "Tracking", key: "group_id", label: "Group ID", width: 120 },
  { group: "Tracking", key: "ops_details", label: "Ops Details", width: 180 },
  { group: "Tracking", key: "feedback_1", label: "Feedback 1", width: 160 },
  { group: "Tracking", key: "feedback_2", label: "Feedback 2", width: 160 },
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
  rejectedIds,
}: {
  mode: WorkspaceMode;
  campaigns: Campaign[];
  qc: Record<string, QcChecklist | undefined>;
  profileId: string;
  onClose: () => void;
  onSaved: () => void;
  /** Returns one outcome per campaign when the action can partially fail. */
  onPrimary: (ids: string[]) => Promise<BulkCalendarOutcome[] | void>;
  /** Ids CRM sent back, for the "Sent back by CRM only" filter. */
  rejectedIds?: Set<string>;
  /** Rows a realtime update arrived for while they had unsaved edits. */
  staleIds?: Set<string>;
  onReloadRow?: (id: string) => void;
}) {
  const [dirty, setDirty] = useState<Dirty>({});
  const [dirtyQc, setDirtyQc] = useState<DirtyQc>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<null | "save" | "primary">(null);
  /** Batch progress for a long bulk action, so 3,000 rows is not a frozen UI. */
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  /** Per-PN results of the last bulk action, shown until dismissed. */
  const [outcomes, setOutcomes] = useState<BulkCalendarOutcome[] | null>(null);
  /** "Apply to selected rows": which column, and which value. */
  /**
   * Controlled Category filter. Affects VISIBLE ROWS ONLY — see the note on
   * `visibleCampaigns` for why selection is pruned alongside it.
   */
  const [categoryFilter, setCategoryFilter] = useState<string>(ALL_CATEGORIES_LABEL);
  /**
   * Date filter on the PN's own campaign date. Both ends optional and
   * inclusive; it combines with the category filter.
   */
  const [rejectedFilter, setRejectedFilter] = useState(false);

  /* ── Excel-style copy and paste (Category grid only) ── */
  const isCategoryGrid = mode === "CATEGORY_INPUT";
  const [anchor, setAnchor] = useState<CellRef | null>(null);
  const [focusCell, setFocusCell] = useState<CellRef | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pasteNote, setPasteNote] = useState<PastePlan | null>(null);
  const [showSkipped, setShowSkipped] = useState(false);
  /** One level of undo: the dirty values a paste replaced. */
  const undoRef = useRef<{ id: string; key: string; before: unknown }[] | null>(null);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  /**
   * Ticks every minute so the "2d 5h left" countdowns stay live without a
   * reload. One timer for the whole grid, not one per row.
   */
  const [now, setNow] = useState(() => new Date());

  /**
   * Brand codes CRM has added, loaded ONCE for the whole grid rather than
   * per cell. A failed read yields an empty list and the dropdown falls back
   * to the JSON options.
   */
  const [customBrands, setCustomBrands] = useState<string[]>([]);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listCustomOptions("tracking_brand")
      .then((v) => { if (!cancelled) setCustomBrands(v); })
      .catch(() => { if (!cancelled) setCustomBrands([]); });
    return () => { cancelled = true; };
  }, []);

  /**
   * The merged Brand list, built ONCE per change of customBrands rather
   * than inside every Brand cell on every render.
   *
   * This was the scroll stutter: `mergeOptions` builds a Set over all 3,598
   * brand codes, and it ran per Brand cell per render — 43 visible rows ×
   * 3,598 = ~155,000 operations on EVERY scroll event, measured at 11.6 ms
   * per frame against a 16.7 ms budget.
   */
  const mergedBrandOptions = useMemo(
    () => mergeOptions("tracking_brand", customBrands), [customBrands]);

  /**
   * ITEM 4 — the Final QC grid.
   *
   * `TrackingCell` is wrapped in memo(), but `onPick` and `onCreate` were
   * inline arrows rebuilt on every render, so the props never compared
   * equal and memo() never bailed out. All 516 dropdown cells re-rendered
   * on every scroll frame (~31,000 a second at 60fps).
   *
   * These caches hand out ONE stable function per (row, column), so a row
   * that has not changed is skipped entirely.
   */
  const pickHandlers = useRef(new Map<string, (v: string) => void>());
  const createHandlers = useRef(new Map<string, (v: string) => Promise<void>>());
  const campaignsRef = useRef<Campaign[]>(campaigns);
  campaignsRef.current = campaigns;
  const addBrandCodeRef = useRef<(v: string) => Promise<void>>(async () => {});

  const addBrandCode = useCallback(async (raw: string) => {
    setCreateError(null);
    const v = raw.trim().toLowerCase();
    if (!v) { setCreateError("Enter a brand code."); return; }
    if (!isValidNewBrandCode(v)) {
      setCreateError("Letters and digits only, no spaces or symbols.");
      return;
    }
    if (isDuplicateOption("tracking_brand", customBrands, v)) {
      setCreateError(`"${v}" already exists.`);
      return;
    }
    try {
      const saved = await addCustomOption("tracking_brand", v, profileId);
      setCustomBrands((p) => [...p, saved]);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e));
    }
  }, [customBrands, profileId]);
  addBrandCodeRef.current = addBrandCode;
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  const [fillKey, setFillKey] = useState<string>("");
  const [fillValue, setFillValue] = useState<string>("");

  /**
   * Row virtualization. Only the rows near the viewport are in the DOM;
   * 3,000 rows x ~25 cells would otherwise be 75,000 elements and typing
   * would stutter badly.
   *
   * Implemented with two spacer rows rather than a library: every row here
   * is a fixed height, so the arithmetic is trivial, and a spacer <tr>
   * keeps the real <table> intact — which is what makes the sticky header
   * and sticky first two columns keep working.
   */
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(600);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    /**
     * Scroll fires 60-120 times a second and each setState re-rendered the
     * whole grid. Coalesced to at most one update per animation frame, so a
     * fast flick costs one render per frame instead of two.
     */
    let frame = 0;
    /**
     * ITEM 4 — the remaining scroll lag.
     *
     * `scrollTop` is only read to compute the virtual window. When
     * `renderAll` is true (wrapped modes at or under the row limit) the
     * window is the whole list, so the value is NEVER USED — yet every
     * scroll frame still set state and re-rendered every row.
     *
     * Measured on the CATEGORY_REVIEW grid (16 columns, 4 of them
     * auto-growing textareas): 400 rows = 6,400 cells and 1,600 textareas
     * re-rendered per frame, ~384,000 cell renders a second while scrolling.
     * Skipping the update when it cannot change anything takes that to zero.
     */
    const onScroll = () => {
      if (renderAllRef.current) return;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setScrollTop(el.scrollTop);
      });
    };
    const measure = () => setViewportH(el.clientHeight || 600);
    measure();
    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", measure);
    };
  }, []);

  /**
   * ITEM 3 — columns HIDDEN per mode. Display only: the fields stay in the
   * database, the drawer, every other grid and all exports, and a save
   * never touches them because a hidden column is never rendered and so
   * never becomes dirty.
   *
   * One line brings a column back.
   */
  const HIDDEN_BY_MODE: Partial<Record<WorkspaceMode, readonly string[]>> = {
    // The CATEGORY-owned Campaign Name text and Landing Link. The tracking
    // "Campaign Name" (campaign_name_code) and "Landing (code)" stay.
    FINAL_QC: ["campaign_name", "landing"],
  };

  const columns =
    (mode === "FINAL_QC" ? QC_COLUMNS
    : mode === "CATEGORY_INPUT" ? CATEGORY_INPUT_COLUMNS
    : mode === "CONTENT_INPUT" ? CONTENT_INPUT_COLUMNS
    : CATEGORY_COLUMNS)
    .filter((c) => !(HIDDEN_BY_MODE[mode] ?? []).includes(String(c.key)));
  const isQc = mode === "FINAL_QC";
  const dirtyCount = Object.keys(dirty).length + Object.keys(dirtyQc).length;

  /**
   * Publish which rows are mid-edit so realtime leaves them alone (#11),
   * and clear the flags on unmount so a closed workspace never keeps a row
   * frozen.
   */
  /**
   * A reset wipes the rows this workspace is editing, so staying open would
   * show a grid of campaigns that no longer exist. Close it and discard the
   * dirty map; the notice is shown by the dashboard behind us.
   */
  useEffect(() => onDashboardReset(() => {
    setDirty({}); setDirtyQc({}); setSelected(new Set()); setOutcomes(null);
    onClose();
  }), [onClose]);

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

  /**
   * Read-only context cells. Dates and times are formatted for reading;
   * anything genuinely absent shows an em dash rather than a blank or a
   * fabricated value.
   */
  const contextValue = useCallback((c: Campaign, key: keyof Campaign): string => {
    if (key === "launch_date") return c.launch_date ? fmtDate(c.launch_date) : "—";
    if (key === "launch_time") return c.launch_time ? fmtTime(c.launch_time) : "—";
    if (key === "slot_label") return slotDisplay(c);
    const raw = c[key];
    if (raw === null || raw === undefined || String(raw).trim() === "") return "—";
    return String(raw);
  }, []);

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

  /**
   * One stable handler per (row, column), created on first use and reused
   * afterwards, so memo() on TrackingCell can bail out.
   *
   * The handlers read `setField` and `valueOf`, which are themselves
   * useCallback-stable, so a cached closure never goes stale.
   */
  const pickHandlerFor = useCallback((id: string, key: string) => {
    const k = `${id}:${key}`;
    let fn = pickHandlers.current.get(k);
    if (!fn) {
      fn = (v: string) => {
        setField(id, key as keyof Campaign, v);
        // Changing the category code can invalidate the saved sub-category,
        // so it is cleared rather than left pointing at a code that is no
        // longer offered.
        if (key === "tracking_category") {
          const row = campaignsRef.current.find((x) => x.id === id);
          if (row && !isSubcategoryValid(v, valueOf(row, "tracking_sub_category"))) {
            setField(id, "tracking_sub_category", "");
          }
        }
      };
      pickHandlers.current.set(k, fn);
    }
    return fn;
  }, [setField, valueOf]);

  const createHandlerFor = useCallback((id: string, key: string) => {
    const k = `${id}:${key}`;
    let fn = createHandlers.current.get(k);
    if (!fn) {
      fn = async (v: string) => {
        await addBrandCodeRef.current(v);
        setField(id, key as keyof Campaign, v.trim().toLowerCase());
      };
      createHandlers.current.set(k, fn);
    }
    return fn;
  }, [setField]);


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

  /**
   * Columns CRM can bulk fill. BULK_FILL_KEYS is the agreed set (Campaign
   * Type, Campaign Name, Channel Name, Channel Format, Segment 2); the
   * dependent sub-category is excluded because a single value cannot be
   * valid across rows with different category codes.
   */
  const fillableColumns = columns.filter(
    (c) => c.type === "select" && !c.fixed && BULK_FILL_KEYS.has(String(c.key)));
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
  const applyFill = (ids: string[], scope: string) => {
    if (!fillColumn || ids.length === 0) return;
    const key = fillColumn.key;
    setDirty((prev) => {
      const next = { ...prev };
      for (const id of ids) {
        // ONLY this column. Every other field on the row is untouched.
        next[id] = { ...next[id], [key]: fillValue };
      }
      return next;
    });
    setDone(
      `Applied "${fillValue || "(blank)"}" to ${ids.length} ${scope} ` +
      `row${ids.length === 1 ? "" : "s"} (${fillColumn.label}). ` +
      `Not saved yet — press Save Draft.`
    );
  };

  const applyToSelected = () => applyFill([...selected], "selected");

  /** Every row currently visible after the category filter. */
  const applyToAllVisible = () =>
    applyFill(visibleCampaigns.map((c) => c.id), "visible");

  /* ---------------- persistence ---------------- */

  const saveAll = async () => {
    if (dirtyCount === 0) return;
    setBusy("save"); setError(null); setDone(null);
    try {
      // One write per campaign UUID, as everywhere else in this app, but
      // batched so a 3,000-row save does not fire 3,000 parallel requests.
      const entries = Object.entries(dirty);

      /**
       * Per-row outcomes rather than abort-on-first-failure: RLS can reject
       * one PN (on the calendar, not yours) while the rest save fine, and
       * the user needs to know WHICH. It must never report "saved" for a
       * row the database refused.
       */
      const rejected: { id: string; label: string; reason: string }[] = [];
      const savedIds: string[] = [];

      await inBatches(entries, async ([id, patch]) => {
        try {
          await updateCampaign(id, patch);
          savedIds.push(id);
        } catch (e) {
          const c = campaigns.find((x) => x.id === id);
          rejected.push({
            id,
            label: c ? rowLabel(c) : id,
            reason: e instanceof Error ? e.message : String(e),
          });
        }
      }, (done, total) => setBatchProgress({ done, total }));

      await inBatches(Object.entries(dirtyQc), ([id, patch]) => saveQc(id, patch));
      setBatchProgress(null);

      // Only the rows that actually saved stop being dirty, so a rejected
      // edit is not silently discarded from the grid.
      setDirty((prev) => {
        const next = { ...prev };
        for (const id of savedIds) delete next[id];
        return next;
      });
      setDirtyQc({});

      if (rejected.length > 0) {
        setError(
          `${savedIds.length} saved, ${rejected.length} rejected: `
          + rejected.slice(0, 3).map((r) => `${r.label} — ${r.reason}`).join("; ")
          + (rejected.length > 3 ? `, and ${rejected.length - 3} more.` : "."));
      } else {
        setDone(`Saved ${savedIds.length} campaign${savedIds.length === 1 ? "" : "s"}.`);
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBatchProgress(null);
    setBusy(null);
  };

  /* ── Bulk send back to Content (Final QC only) ── */
  const [sendBackOpen, setSendBackOpen] = useState(false);
  const [sendBackBusy, setSendBackBusy] = useState(false);
  const [sendBackError, setSendBackError] = useState<string | null>(null);

  const selectedRows = useMemo(
    () => campaigns.filter((c) => selected.has(c.id)), [campaigns, selected]);

  const runSendBack = async (input: { reason: string; byName: string; field?: string }) => {
    setSendBackBusy(true); setSendBackError(null);
    try {
      /**
       * Unsaved edits are flushed first, exactly as runPrimary does, so a
       * send-back never acts on a version of the row the user cannot see.
       */
      if (dirtyCount > 0) await saveAll();
      const outcomes = await bulkSendBackToContent(selectedRows, input);
      const ok = outcomes.filter((o) => o.ok).length;
      const blocked = outcomes.filter((o) => !o.ok);
      setSendBackOpen(false);
      setSelected(new Set());
      setDone(
        `${ok} PN${ok === 1 ? "" : "s"} sent back to Content.`
        + (blocked.length > 0
          ? ` ${blocked.length} could not be sent: ${
              blocked.slice(0, 3).map((b) => `${b.campaignName} — ${b.reason}`).join("; ")}`
            + (blocked.length > 3 ? `, and ${blocked.length - 3} more.` : ".")
          : ""));
      onSaved();
    } catch (e) {
      setSendBackError(e instanceof Error ? e.message : String(e));
    }
    setSendBackBusy(false);
  };

  /**
   * ADDITION A — every selected PN must be complete before ANY is sent.
   *
   * All-or-nothing: a partial send would leave Category thinking the whole
   * batch went through. The same `missingCategoryFields` the drawer uses,
   * and the same rule migration 37 enforces in Postgres.
   */
  const [incomplete, setIncomplete] = useState<IncompleteCategoryPn[]>([]);
  const incompleteIds = useMemo(
    () => new Set(incomplete.map((r) => r.id)), [incomplete]);

  const runPrimary = async () => {
    if (selected.size === 0) return;
    setBusy("primary"); setError(null); setDone(null); setIncomplete([]);

    if (mode === "CATEGORY_INPUT") {
      const rows = campaigns.filter((c) => selected.has(c.id))
        .map((c) => ({ ...c, ...(dirty[c.id] ?? {}) }));
      const check = validateCategorySelection(rows);
      if (!check.ok) {
        setIncomplete(check.incomplete);
        setError(
          `${check.incomplete.length} of ${rows.length} selected PN`
          + `${rows.length === 1 ? " is" : "s are"} incomplete. Nothing was sent.`);
        setBusy(null);
        return;
      }
    }
    try {
      // Unsaved edits are flushed first, so the action never operates on a
      // version of the row the user cannot see.
      if (dirtyCount > 0) {
        await inBatches(Object.entries(dirty), ([id, patch]) => updateCampaign(id, patch));
        await inBatches(Object.entries(dirtyQc), ([id, patch]) => saveQc(id, patch));
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
        setDone(`${ok.length} of ${result.length} succeeded.`);
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

  /**
   * Rows after the Category filter. The filter changes what is SHOWN; it
   * never alters a campaign.
   *
   * Selection is pruned to the visible set whenever the filter changes, so
   * Lock & Submit To CRM can never act on a row the user cannot see. That
   * was the risk: select 60 rows, filter to Electronics, press Lock, and
   * submit 60 instead of the 8 on screen.
   */
  const visibleCampaigns = useMemo(() => {
    let rows = filterByCategory(campaigns, categoryFilter);
    if (rejectedFilter && rejectedIds) rows = rows.filter((c) => rejectedIds.has(c.id));
    if (fromDate || toDate) {
      rows = rows.filter((c) => {
        const d = campaignDateIso(c.launch_date);
        /**
         * A PN with no usable date is KEPT when a date filter is on, rather
         * than silently dropped — hiding a dateless PN is how one gets
         * forgotten. It simply cannot be narrowed by date.
         */
        if (d === null) return true;
        if (fromDate && d < fromDate) return false;
        if (toDate && d > toDate) return false;
        return true;
      });
    }
    return rows;
  }, [campaigns, categoryFilter, fromDate, toDate, rejectedFilter, rejectedIds]);

  /**
   * Which columns Category may write, read from the column set itself so a
   * new read-only column is respected without touching this code.
   */
  const editableKeys = useMemo(
    () => new Set(columns.filter((c) => c.type !== "readonly" && c.type !== "deadline")
      .map((c) => String(c.key))), [columns]);

  /**
   * Rows a paste must not touch. Category submitted them, so typing in the
   * grid may still reach them but a bulk paste deliberately will not.
   */
  const lockedRowIds = useMemo(
    () => new Set(visibleCampaigns
      .filter((c) => c.category_status === "LOCKED" || c.category_status === "SUBMITTED")
      .map((c) => c.id)), [visibleCampaigns]);

  const selection = anchor && focusCell ? rangeBetween(anchor, focusCell) : null;

  /** Copies the selection as TSV, so it also pastes into Excel. */
  const copySelection = useCallback(() => {
    if (!selection) return;
    const text = toClipboard(
      visibleCampaigns, columns.map((c) => String(c.key)), selection,
      (c, k) => valueOf(c, k as keyof Campaign));
    void navigator.clipboard?.writeText(text);
  }, [selection, visibleCampaigns, columns, valueOf]);

  /**
   * Fills the grid from the clipboard. It writes into the same `dirty` map
   * typing writes to, so nothing is submitted and Save Draft persists it in
   * one batch — no request per cell.
   */
  const pasteInto = useCallback((text: string) => {
    if (!focusCell) return;
    const values = parseClipboard(text);
    if (values.length === 0) return;

    const plan = planPaste({
      rows: visibleCampaigns,
      cols: columns.map((c) => String(c.key)),
      labels: Object.fromEntries(columns.map((c) => [String(c.key), c.label])),
      editable: editableKeys,
      lockedRowIds,
      options: Object.fromEntries(columns
        .filter((c) => c.options && c.options.length > 0)
        .map((c) => [String(c.key), c.options as readonly string[]])),
    }, values, focusCell, selection ?? undefined);

    if (plan.writes.length > 0) {
      // Snapshot first, so one Ctrl+Z puts everything back.
      undoRef.current = plan.writes.map((w) => ({
        id: w.rowId, key: w.key,
        before: dirty[w.rowId]?.[w.key as keyof Campaign],
      }));
      setDirty((prev) => {
        const next = { ...prev };
        for (const w of plan.writes) {
          next[w.rowId] = { ...next[w.rowId], [w.key]: w.value };
        }
        return next;
      });
    }
    setPasteNote(plan);
    setShowSkipped(false);
  }, [focusCell, selection, visibleCampaigns, columns, editableKeys, lockedRowIds, dirty]);

  /** Undoes the last paste, restoring exactly what each cell held. */
  const undoPaste = useCallback(() => {
    const snap = undoRef.current;
    if (!snap) return;
    setDirty((prev) => {
      const next = { ...prev };
      for (const u of snap) {
        const row = { ...next[u.id] };
        if (u.before === undefined) delete row[u.key as keyof Campaign];
        else row[u.key as keyof Campaign] = u.before as never;
        next[u.id] = row;
      }
      return next;
    });
    undoRef.current = null;
    setPasteNote(null);
  }, []);

  /**
   * Ctrl/Cmd + C / V / Z while a cell is selected.
   *
   * Ignored when the user is typing in an input, so single-cell editing
   * behaves exactly as before.
   */
  useEffect(() => {
    if (!isCategoryGrid) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const el = e.target as HTMLElement | null;
      const typing = el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
      const key = e.key.toLowerCase();

      if (key === "c" && selection && !typing) {
        copySelection(); e.preventDefault(); return;
      }
      if (key === "v" && focusCell && !typing) {
        e.preventDefault();
        void navigator.clipboard?.readText()
          .then((t) => pasteInto(t))
          .catch(() => setPasteNote({ writes: [], skipped: [] }));
        return;
      }
      if (key === "z" && undoRef.current && !typing) {
        undoPaste(); e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isCategoryGrid, selection, focusCell, copySelection, pasteInto, undoPaste]);

  /** A drag that ends anywhere releases the selection. */
  useEffect(() => {
    if (!dragging) return;
    const up = () => setDragging(false);
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, [dragging]);

  const filtersActive =
    categoryFilter !== ALL_CATEGORIES_LABEL || fromDate !== "" || toDate !== ""
    || rejectedFilter;

  useEffect(() => {
    const visibleIds = new Set(visibleCampaigns.map((c) => c.id));
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => visibleIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [visibleCampaigns]);

  const allSelected = visibleCampaigns.length > 0
    && visibleCampaigns.every((c) => selected.has(c.id));

  /**
   * In Final QC the far-left checkbox reflects the row's QC state rather
   * than only its selection, so ticking the ten boxes one by one shows it
   * checked automatically, and a partial row shows indeterminate.
   *
   * Reads the saved checklist merged with the unsaved edits, because a tick
   * lives in `dirtyQc` until Save Draft.
   */
  const qcStateOf = useCallback((id: string): "none" | "some" | "all" => {
    const saved = (qc[id] ?? {}) as Partial<QcChecklist>;
    const pending = dirtyQc[id] ?? {};
    const ticked = QC_CHECKS.filter(
      (q) => ((pending as Partial<QcChecklist>)[q.key] ?? saved[q.key]) === true).length;
    if (ticked === 0) return "none";
    return ticked === QC_CHECKS.length ? "all" : "some";
  }, [qc, dirtyQc]);

  // Generous overscan: a dropdown open on a row scrolled just out of view
  // must not be unmounted mid-interaction.
  /**
   * Rows grow with their content here, so the fixed-height virtualizer's
   * arithmetic no longer holds. For Content's list the whole set is
   * rendered: this view exists to be scanned, and a clipped sentence is
   * worse than a longer DOM.
   *
   * Above the threshold virtualization stays on. Text still wraps in full —
   * only the scrollbar becomes approximate, which is a far smaller problem
   * than truncation.
   */
  const wrapRows = mode === "CONTENT_INPUT" || mode === "CATEGORY_REVIEW";
  const NATURAL_HEIGHT_LIMIT = 400;
  const renderAll = wrapRows && visibleCampaigns.length <= NATURAL_HEIGHT_LIMIT;
  /**
   * Read inside the scroll listener, which is registered once. A ref keeps
   * it current without re-registering the listener on every render.
   */
  const renderAllRef = useRef(renderAll);
  renderAllRef.current = renderAll;

  const OVERSCAN = 12;
  const rowH = wrapRows ? 96 : ROW_HEIGHT;      // wrapped rows are taller
  const first = renderAll ? 0 : Math.max(0, Math.floor(scrollTop / rowH) - OVERSCAN);
  const visibleCount = Math.ceil(viewportH / rowH) + OVERSCAN * 2;
  const last = renderAll ? visibleCampaigns.length
    : Math.min(visibleCampaigns.length, first + visibleCount);
  const visibleRows = visibleCampaigns.slice(first, last);
  const padTop = renderAll ? 0 : first * rowH;
  const padBottom = renderAll ? 0 : Math.max(0, (visibleCampaigns.length - last) * rowH);
  const primaryLabel =
    mode === "FINAL_QC" ? "Bulk Push To Calendar"
    : mode === "CATEGORY_INPUT" ? "Lock & Submit To CRM"
    : mode === "CONTENT_INPUT" ? "Submit To CRM"
    : "Bulk Send To Content";

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
      <SendBackModal
        campaigns={selectedRows}
        open={sendBackOpen}
        busy={sendBackBusy}
        error={sendBackError}
        onClose={() => { setSendBackOpen(false); setSendBackError(null); }}
        onConfirm={runSendBack}
        z="z-[80]" />

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

          {/* Send the selected PNs back to Content for a rewrite. Only in
              Final QC, where CRM is reviewing copy. The modal collects the
              reason and the typed name; eligibility is re-checked in
              Postgres by send_back_to_content(). */}
          {isQc && (
            <Button size="sm" variant="ghost"
              disabled={busy !== null || selected.size === 0}
              onClick={() => { setSendBackError(null); setSendBackOpen(true); }}>
              Bulk Send Back to Content ({selected.size})
            </Button>
          )}

          {/* Category filter, beside the primary action. Controlled list —
              never built from historical records. Changing it prunes the
              selection to what is visible, so the primary action above can
              never submit a hidden row. */}
          <select
            aria-label="Filter by category"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="!m-0 !w-[170px] !py-1 !text-[12px]">
            <option value={ALL_CATEGORIES_LABEL}>{ALL_CATEGORIES_LABEL}</option>
            {CAMPAIGN_CATEGORY_FILTER_OPTIONS.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          {/* PNs CRM sent back that Category has not yet resubmitted.
              Category grid only. */}
          {mode === "CATEGORY_INPUT" && rejectedIds && rejectedIds.size > 0 && (
            <label className="flex items-center gap-1.5 text-[12px] text-body">
              <input type="checkbox" checked={rejectedFilter}
                onChange={(e) => setRejectedFilter(e.target.checked)} />
              Sent back by CRM only ({rejectedIds.size})
            </label>
          )}

          {/* Date filter, on the PN's campaign date. Both ends optional. */}
          <input type="date" aria-label="From date" value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="!m-0 !w-[140px] !py-1 !text-[12px]" />
          <input type="date" aria-label="To date" value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="!m-0 !w-[140px] !py-1 !text-[12px]" />
          {filtersActive && (
            <>
              <Button size="sm" variant="ghost"
                onClick={() => {
                  setCategoryFilter(ALL_CATEGORIES_LABEL);
                  setFromDate(""); setToDate(""); setRejectedFilter(false);
                }}>
                Clear
              </Button>
              <span className="text-micro text-muted">
                Showing {visibleCampaigns.length} of {campaigns.length} PNs
              </span>
            </>
          )}
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
                <Button size="sm" variant="ghost"
                  disabled={busy !== null || !fillColumn || !fillValue
                    || visibleCampaigns.length === 0}
                  onClick={applyToAllVisible}>
                  Apply to all visible ({visibleCampaigns.length})
                </Button>
              </div>
            </>
          )}

          <div className="ml-auto flex items-center gap-3">
            {batchProgress && (
              <span className="text-micro tabular-nums text-muted">
                {batchProgress.done} / {batchProgress.total} written
              </span>
            )}
            {done && <span className="flex items-center gap-1.5 text-micro text-success-700">{Icon.check(12)} {done}</span>}
            {error && <span className="flex items-center gap-1.5 text-micro text-danger-700">{Icon.alert(12)} {error}</span>}

            {/* What the last paste did. Clicking it lists what was skipped. */}
            {pasteNote && (
              <div className="w-full">
                <button onClick={() => setShowSkipped((v) => !v)}
                  className="flex items-center gap-1.5 text-micro font-medium text-indigo-700 hover:underline">
                  {pasteSummary(pasteNote)}
                  {pasteNote.skipped.length > 0 && (showSkipped ? " — hide" : " — why?")}
                </button>
                {showSkipped && pasteNote.skipped.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {pasteNote.skipped.slice(0, 12).map((sk, n) => (
                      <li key={`${sk.row}-${sk.col}-${n}`} className="text-micro text-muted">
                        Row {sk.row + 1} · {sk.label} — {sk.reason}
                      </li>
                    ))}
                    {pasteNote.skipped.length > 12 && (
                      <li className="text-micro text-faint">
                        …and {pasteNote.skipped.length - 12} more.
                      </li>
                    )}
                  </ul>
                )}
                {undoRef.current && (
                  <button onClick={undoPaste}
                    className="mt-1 text-micro font-medium text-indigo-700 hover:underline">
                    Undo paste (Ctrl+Z)
                  </button>
                )}
              </div>
            )}

            {/* ADDITION A: exactly which PNs blocked the send, and a way to
                jump straight to them. */}
            {incomplete.length > 0 && (
              <div className="w-full rounded-lg bg-danger-50 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-micro font-600 text-danger-700">
                    Fill these before sending:
                  </span>
                  <Button size="sm" variant="ghost"
                    onClick={() => setSelected(new Set(incomplete.map((r) => r.id)))}>
                    Select only the incomplete ({incomplete.length})
                  </Button>
                </div>
                <ul className="mt-1 space-y-0.5">
                  {incomplete.slice(0, 10).map((r) => (
                    <li key={r.id} className="text-micro text-danger-700">
                      {r.label} — missing {r.missing.join(", ")}
                    </li>
                  ))}
                  {incomplete.length > 10 && (
                    <li className="text-micro text-faint">
                      …and {incomplete.length - 10} more.
                    </li>
                  )}
                </ul>
              </div>
            )}
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
                Failed PNs are unchanged and remain selected below, so you can fix and retry.
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
                      <td className="px-2 py-1.5 text-muted">{o.ok ? "Done" : o.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ---------- grid ---------- */}
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
          <table className="border-separate border-spacing-0 text-[12.5px]">
            <thead>
              <tr>
                {/* Sticky in both axes: the header stays while scrolling down,
                    the first two columns stay while scrolling right, so a row
                    never loses its identity. */}
                <th className="sticky left-0 top-0 z-30 w-10 border-b border-r border-line bg-[#F9FAFB] px-2 py-2">
                  <input type="checkbox" checked={allSelected}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(visibleCampaigns.map((c) => c.id)))} />
                </th>
                <th className="sticky left-10 top-0 z-30 w-[150px] border-b border-r border-line bg-[#F9FAFB] px-2 py-2 text-left text-micro font-600 uppercase tracking-wide text-faint">
                  Date / Time
                </th>
                {columns.map((col) => (
                  <th key={String(col.key)} style={{ minWidth: col.width }}
                    className="sticky top-0 z-20 border-b border-r border-line bg-[#F9FAFB] px-2 py-2 text-left text-micro font-600 uppercase tracking-wide text-faint">
                    {col.label}
                    {/* ADDITION A: the seven Category must-fills. */}
                    {mode === "CATEGORY_INPUT"
                      && (CATEGORY_REQUIRED as readonly string[]).includes(String(col.key))
                      && <span className="ml-0.5 text-danger-500">*</span>}
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
              {/* Spacer for the rows above the viewport. */}
              {padTop > 0 && <tr style={{ height: padTop }} aria-hidden="true" />}
              {visibleRows.map((c, vi) => {
                const i = first + vi;
                return (
                <tr key={c.id}
                  /**
                   * ADDITION B — the vibration.
                   *
                   * padTop/padBottom are computed as `index * rowH`, but a
                   * row was free to be taller: the searchable cells render a
                   * bordered trigger inside a px-1 py-0.5 wrapper (~38px vs
                   * the assumed 33px), and the "not in list" hint added a
                   * second line (~52px). Over 928 rows that is thousands of
                   * pixels of disagreement between the spacers and the real
                   * content. Scrolling changed padTop, the document height
                   * shifted, the browser corrected scrollTop, onScroll fired
                   * and set state again — a feedback loop, seen as jitter.
                   *
                   * Pinning the height makes the arithmetic true, so the
                   * loop cannot start. Wrapped modes keep their taller row.
                   */
                  style={wrapRows ? undefined : { height: rowH }}
                  className={i % 2 ? "bg-[#FCFCFD]" : "bg-surface"}>
                  <td className={`sticky left-0 z-10 border-b border-r border-line px-2 py-1 ${i % 2 ? "bg-[#FCFCFD]" : "bg-surface"}`}>
                    <input type="checkbox"
                      /* In Final QC the box shows the row's QC progress:
                         checked when all ten are ticked however they were
                         ticked, indeterminate when only some are. */
                      checked={isQc ? qcStateOf(c.id) === "all" : selected.has(c.id)}
                      ref={(el) => {
                        if (el) el.indeterminate = isQc && qcStateOf(c.id) === "some";
                      }}
                      onChange={() => {
                      const turningOn = isQc
                        ? qcStateOf(c.id) !== "all"
                        : !selected.has(c.id);
                      // The box still drives row SELECTION, so Bulk Push and
                      // every other bulk action keep working unchanged.
                      setSelected((p) => {
                        const n = new Set(p);
                        if (turningOn) n.add(c.id); else n.delete(c.id);
                        return n;
                      });
                      /**
                       * Convenience shortcut, ONLY in Final QC: ticking a
                       * row's own checkbox ticks its ten QC boxes through the
                       * SAME dirty-QC state a manual tick uses, so it
                       * satisfies the Push to Calendar gate identically.
                       *
                       * Unticking CLEARS all ten, through the same path, so
                       * the box is a true "check all / clear all" for the
                       * row. Each box stays independently clickable.
                       *
                       * Scoped to this row by c.id. The header Select all
                       * still only selects, exactly as before.
                       */
                      if (isQc) {
                        // Ticking sets all ten; unticking CLEARS all ten,
                        // through the same dirtyQc path a manual tick uses.
                        setDirtyQc((prev) => ({
                          ...prev,
                          [c.id]: {
                            ...prev[c.id],
                            ...Object.fromEntries(
                              QC_CHECKS.map((q) => [q.key, turningOn])),
                          },
                        }));
                      }
                    }} />
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

                  {columns.map((col, ci) => (
                    <td key={String(col.key)}
                      /* Excel-style selection, Category grid only. mousedown
                         starts a range, mouseenter extends it while dragging,
                         and shift+click extends from the anchor. */
                      onMouseDown={isCategoryGrid ? (e) => {
                        const cell = { row: i, col: ci };
                        if (e.shiftKey && anchor) setFocusCell(cell);
                        else { setAnchor(cell); setFocusCell(cell); setDragging(true); }
                      } : undefined}
                      onMouseEnter={isCategoryGrid && dragging
                        ? () => setFocusCell({ row: i, col: ci }) : undefined}
                      /* FIXED_CELL caps the height in virtualised modes so a
                         cell cannot make the row taller than rowH. */
                      className={`border-b border-r border-line p-0 ${
                        isCategoryGrid && selection && inRange(selection, i, ci)
                          ? "bg-indigo-50 ring-1 ring-inset ring-indigo-200 " : ""}${
                        wrapRows ? "align-top" : FIXED_CELL}${
                        // ADDITION A: the exact cells that block the send.
                        incompleteIds.has(c.id)
                          && (CATEGORY_REQUIRED as readonly string[]).includes(String(col.key))
                          && !isCategoryFieldFilled(valueOf(c, col.key))
                          ? " bg-danger-50 ring-1 ring-inset ring-[#FDA29B]" : ""}`}>
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
                        <TrackingCell col={col}
                          mergedList={col.allowCreate ? mergedBrandOptions : undefined}
                          onCreate={col.allowCreate
                            ? createHandlerFor(c.id, String(col.key))
                            : undefined}
                          createError={col.allowCreate ? createError : null}
                          categoryCode={valueOf(c, "tracking_category")}
                          value={valueOf(c, col.key)}
                          onPick={pickHandlerFor(c.id, String(col.key))} />
                      ) : col.type === "deadline" ? (
                        <DeadlineCell campaign={c} now={now} />
                      ) : col.fixed ? (
                        /* Fixed value, displayed read-only. It still feeds the
                           generator; CRM never types or picks it. */
                        <span className="block px-2 py-1.5 text-[12.5px] text-muted">
                          {valueOf(c, col.key)
                            || FIXED_TRACKING_VALUES[col.key as keyof typeof FIXED_TRACKING_VALUES]}
                        </span>
                      ) : col.type === "readonly" && col.longText ? (
                        /* Full text, wrapped, whitespace preserved. No
                           line-clamp, no ellipsis, no title tooltip. */
                        <span className="block whitespace-pre-wrap break-words px-2 py-1.5 text-[12.5px] leading-relaxed text-muted">
                          {valueOf(c, col.key) || "—"}
                        </span>
                      ) : col.type === "readonly" ? (
                        <span className="block px-2 py-1.5 text-[12.5px] text-muted">
                          {contextValue(c, col.key)}
                        </span>
                      ) : col.longText ? (
                        /* An auto-growing textarea, not a single-line input:
                           an input clips a long sentence at the cell edge and
                           forces the user to scroll inside it. */
                        <textarea
                          value={valueOf(c, col.key)}
                          rows={Math.max(2, Math.ceil((valueOf(c, col.key) || "").length / 34))}
                          onChange={(e) => setField(c.id, col.key, e.target.value)}
                          className="!m-0 !block !w-full !resize-y !rounded-none !border-0 !bg-transparent !px-2 !py-1.5 !text-[12.5px] !leading-relaxed"
                        />
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
                );
              })}
              {/* Spacer for the rows below the viewport. */}
              {padBottom > 0 && <tr style={{ height: padBottom }} aria-hidden="true" />}
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
