import * as XLSX from "xlsx";
import type { Campaign } from "@/types/campaign";
import { fmtDate, fmtTime } from "./format";

/**
 * Content team bulk Excel round-trip.
 *
 * THE GUARANTEE: not a single row may be lost between export and import.
 * Three mechanisms enforce it, none cosmetic:
 *
 *  1. Every exported row carries its campaign UUID in a `Campaign ID`
 *     column. Identity never depends on row order, a name, or a position.
 *  2. The export records the row count in the workbook's custom properties.
 *     The import compares what it parsed against that number, so a file
 *     that lost rows in Excel is REJECTED rather than half-imported.
 *  3. The import reconciles every parsed row against the exact set the
 *     export covered, and names anything missing or unexpected. Nothing is
 *     written unless the whole file validates.
 *
 * Read-only context is exported for Content to work against and IGNORED on
 * import — Content does not own those columns, and the migration-17
 * ownership trigger would reject them anyway.
 */

export const ID_COLUMN = "Campaign ID";

export const READONLY_COLUMNS = [
  "Date", "Time", "Segment", "Category", "Sub Category", "Brand", "Offer",
  "Category Brief", "Landing Link", "Expected CVR", "Expected RPV",
  "Comments", "Title Brief", "Message Brief", "Creative Requirements",
] as const;

export const EDITABLE_COLUMNS = [
  "Header", "Sub Copy", "H Count", "S Count", "Reference Link",
] as const;

export const ALL_COLUMNS = [ID_COLUMN, ...READONLY_COLUMNS, ...EDITABLE_COLUMNS] as const;

export const SHEET_NAME = "Content Worklist";
/** Travels with the file so the import can prove nothing went missing. */
export const MANIFEST_PROP = "cliqRowCount";

/* ───────────────────────── export ───────────────────────── */

export function campaignToRow(c: Campaign): Record<string, string | number> {
  return {
    [ID_COLUMN]: c.id,
    "Date": c.launch_date ? fmtDate(c.launch_date) : "",
    "Time": c.launch_time ? fmtTime(c.launch_time) : "",
    "Segment": c.pncc_segment_label ?? "",
    "Category": c.category ?? c.pncc_category_code ?? "",
    "Sub Category": c.sub_category ?? "",
    "Brand": c.brand ?? "",
    "Offer": c.offer ?? "",
    "Category Brief": c.brief ?? "",
    "Landing Link": c.landing ?? "",
    "Expected CVR": c.expected_cvr ?? "",
    "Expected RPV": c.expected_rpv ?? "",
    "Comments": c.additional_notes ?? "",
    "Title Brief": c.title_brief ?? "",
    "Message Brief": c.message_brief ?? "",
    "Creative Requirements": c.creative_requirements ?? "",
    "Header": c.header ?? "",
    "Sub Copy": c.sub_copy_text ?? "",
    "H Count": c.h_count ?? 0,
    "S Count": c.s_count ?? 0,
    "Reference Link": c.reference_link ?? "",
  };
}

/** Builds the workbook and returns the bytes, so this stays pure. */
export function buildContentWorkbook(campaigns: Campaign[]): ArrayBuffer {
  const rows = campaigns.map(campaignToRow);
  const sheet = XLSX.utils.json_to_sheet(rows, { header: [...ALL_COLUMNS] });

  // Wide columns for the briefs: Content should not have to resize to read.
  sheet["!cols"] = ALL_COLUMNS.map((c) =>
    c === ID_COLUMN ? { wch: 38 }
    : (["Category Brief", "Title Brief", "Message Brief",
        "Creative Requirements", "Header", "Sub Copy"] as readonly string[]).includes(c)
      ? { wch: 46 } : { wch: 16 });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, SHEET_NAME);
  wb.Custprops = { [MANIFEST_PROP]: String(campaigns.length) };
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

/* ───────────────────────── import ───────────────────────── */

export interface ParsedContentRow {
  campaignId: string;
  header: string;
  sub_copy_text: string;
  reference_link: string;
  /** Excel row number, so an error names something the user can find. */
  excelRow: number;
}

export interface ImportResult {
  ok: boolean;
  rows: ParsedContentRow[];
  errors: string[];
  warnings: string[];
  declaredCount: number | null;
  parsedCount: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Parses and FULLY validates before anything is written. Returns ok=false
 * with every problem listed rather than importing what it can — a partial
 * import is how data gets quietly corrupted.
 *
 * `expectedIds` is the set the export covered. Supplying it turns "did we
 * lose a row?" from a hope into a check.
 */
export function parseContentWorkbook(
  buffer: ArrayBuffer, expectedIds?: string[]
): ImportResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let wb: XLSX.WorkBook;

  try {
    wb = XLSX.read(buffer, { type: "array", cellDates: false });
  } catch {
    return { ok: false, rows: [], errors: ["This file is not a readable .xlsx workbook."],
      warnings, declaredCount: null, parsedCount: 0 };
  }

  const sheetName = wb.SheetNames.includes(SHEET_NAME) ? SHEET_NAME : wb.SheetNames[0];
  if (!sheetName) {
    return { ok: false, rows: [], errors: ["The workbook has no sheets."],
      warnings, declaredCount: null, parsedCount: 0 };
  }
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(
    wb.Sheets[sheetName], { defval: "" });

  const headers = Object.keys(raw[0] ?? {});
  const missing = [ID_COLUMN, "Header", "Sub Copy"].filter((h) => !headers.includes(h));
  if (missing.length > 0) {
    errors.push(`This does not look like a Content worklist export — missing column(s): `
      + `${missing.join(", ")}. Export a fresh worklist and fill that file in.`);
    return { ok: false, rows: [], errors, warnings, declaredCount: null, parsedCount: 0 };
  }
  if (raw.length === 0) {
    errors.push("The sheet has headers but no rows.");
    return { ok: false, rows: [], errors, warnings, declaredCount: null, parsedCount: 0 };
  }

  const rows: ParsedContentRow[] = [];
  const seen = new Map<string, number>();
  raw.forEach((r, i) => {
    const excelRow = i + 2;                       // +1 header, +1 one-based
    const id = String(r[ID_COLUMN] ?? "").trim();
    if (!id) {
      errors.push(`Row ${excelRow}: the ${ID_COLUMN} is blank. Do not delete or reorder that column.`);
      return;
    }
    if (!UUID_RE.test(id)) {
      errors.push(`Row ${excelRow}: "${id}" is not a valid ${ID_COLUMN}.`);
      return;
    }
    if (seen.has(id)) {
      errors.push(`Row ${excelRow}: duplicate ${ID_COLUMN} — the same campaign also appears on row ${seen.get(id)}.`);
      return;
    }
    seen.set(id, excelRow);
    rows.push({
      campaignId: id,
      header: String(r["Header"] ?? "").trim(),
      sub_copy_text: String(r["Sub Copy"] ?? "").trim(),
      reference_link: String(r["Reference Link"] ?? "").trim(),
      excelRow,
    });
  });

  const props = (wb.Custprops ?? {}) as Record<string, unknown>;
  const declared = Number(props[MANIFEST_PROP]);
  const declaredCount = Number.isFinite(declared) ? declared : null;

  if (declaredCount !== null && raw.length !== declaredCount) {
    errors.push(
      `Row count mismatch: this file was exported with ${declaredCount} rows but contains `
      + `${raw.length}. ${raw.length < declaredCount
        ? `${declaredCount - raw.length} row(s) appear to have been deleted.`
        : `${raw.length - declaredCount} extra row(s) were added.`} Nothing has been imported.`);
  }

  if (expectedIds && expectedIds.length > 0) {
    const got = new Set(rows.map((r) => r.campaignId));
    const expected = new Set(expectedIds);
    const missingIds = expectedIds.filter((id) => !got.has(id));
    const unknown = rows.filter((r) => !expected.has(r.campaignId));
    if (missingIds.length > 0) {
      errors.push(`${missingIds.length} campaign(s) from the exported batch are not in this `
        + `file. First missing: ${missingIds.slice(0, 3).join(", ")}. Nothing has been imported.`);
    }
    if (unknown.length > 0) {
      errors.push(`${unknown.length} row(s) reference campaigns that were not in the exported `
        + `batch (first on row ${unknown[0].excelRow}). Nothing has been imported.`);
    }
  }

  const blank = rows.filter((r) => !r.header || !r.sub_copy_text);
  if (blank.length > 0) {
    warnings.push(`${blank.length} row(s) have no Header or Sub Copy yet. They will import, `
      + `but cannot be sent to CRM until both are filled.`);
  }

  return {
    ok: errors.length === 0,
    rows: errors.length === 0 ? rows : [],
    errors, warnings, declaredCount, parsedCount: raw.length,
  };
}

/** Counts are derived here too, so Excel can never disagree with the app. */
export const countOf = (s: string) => (s ?? "").trim().length;

/* Row-range export was REMOVED: Content plans by date, not by row number.
   Date-range filtering lives in lib/dateRange.ts, which is deliberately
   generic so CRM, Category, Executive and audit exports can reuse it. */

/* ───────────────────────── validation ───────────────────────── */

export interface RowValidation {
  campaignId: string;
  ready: boolean;
  problems: string[];
}

/**
 * The mandatory Content fields and their limits, in one place, so the
 * preview, the send button and the tests cannot disagree.
 */
export function validateContentRow(
  row: { id: string; header?: string | null; sub_copy_text?: string | null },
  headerLimit: number, subCopyLimit: number
): RowValidation {
  const h = (row.header ?? "").trim();
  const s = (row.sub_copy_text ?? "").trim();
  const problems: string[] = [];
  if (!h) problems.push("Header is required.");
  if (!s) problems.push("Sub Copy is required.");
  if (h.length > headerLimit) problems.push(`Header is ${h.length} characters, over the ${headerLimit} limit.`);
  if (s.length > subCopyLimit) problems.push(`Sub Copy is ${s.length} characters, over the ${subCopyLimit} limit.`);
  return { campaignId: row.id, ready: problems.length === 0, problems };
}

/* ───────────────────────── diff ───────────────────────── */

export const CONTENT_DIFF_FIELDS = ["header", "sub_copy_text", "reference_link"] as const;
export type ContentDiffField = (typeof CONTENT_DIFF_FIELDS)[number];

export const DIFF_LABEL: Record<ContentDiffField, string> = {
  header: "Header Updated",
  sub_copy_text: "Sub Copy Updated",
  reference_link: "Reference Link Updated",
};

/**
 * Which Content-owned fields actually changed. Compared on trimmed values,
 * so re-importing an untouched file records no change — CRM should only
 * see fields Content really edited.
 */
export function diffContentFields(
  before: Partial<Record<ContentDiffField, string | null>>,
  after: Partial<Record<ContentDiffField, string | null>>
): ContentDiffField[] {
  return CONTENT_DIFF_FIELDS.filter((f) =>
    ((before[f] ?? "") as string).trim() !== ((after[f] ?? "") as string).trim());
}
