import * as XLSX from "xlsx";

/**
 * Header-row auto-detection. Real-world exports very often have a merged
 * title cell ("Category Performance") sitting in row 1 with everything else
 * blank, and the actual column headers ("Month", "Category", "Visits"...)
 * one or more rows below it. Reading row 1 as the header (SheetJS's default
 * via sheet_to_json) produces useless "__EMPTY", "__EMPTY_1" column names —
 * this scans the first several rows and scores each one to find the real
 * header row, instead of assuming it's row 1.
 */

export interface HeaderDetection {
  headerRowIndex: number;
  headers: string[];
}

export function readRawRows(ws: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null });
}

function isBlankRow(row: unknown[] | undefined): boolean {
  if (!row) return true;
  return row.every((c) => c === null || c === undefined || String(c).trim() === "");
}

function nonEmptyCount(row: unknown[]): number {
  return row.filter((c) => c !== null && c !== undefined && String(c).trim() !== "").length;
}

/** Scores how "header-like" a row is: short text labels, not long sentences or raw numbers. */
function labelLikeCount(row: unknown[]): number {
  return row.filter((c) => {
    if (c === null || c === undefined) return false;
    const s = String(c).trim();
    return s.length > 0 && s.length <= 40 && isNaN(Number(s));
  }).length;
}

export function detectHeaderRow(rows: unknown[][], scanLimit = 15): HeaderDetection {
  let bestIdx = 0;
  let bestScore = -1;
  const limit = Math.min(rows.length, scanLimit);

  for (let i = 0; i < limit; i++) {
    const row = rows[i];
    if (isBlankRow(row)) continue;
    const filled = nonEmptyCount(row);
    if (filled < 2) continue; // a single merged title cell can't be a real header row

    const labels = labelLikeCount(row);
    const nextRow = rows[i + 1];
    const nextFilled = nextRow ? nonEmptyCount(nextRow) : 0;
    // A real header row is followed by data with a comparable number of filled columns.
    const followedByData = nextFilled >= Math.max(2, Math.floor(filled * 0.5));

    const score = filled + labels * 2 + (followedByData ? 5 : 0);
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  }

  const headerRow = rows[bestIdx] ?? [];
  const width = Math.max(headerRow.length, ...rows.slice(bestIdx, bestIdx + 5).map((r) => r?.length ?? 0));
  const headers: string[] = [];
  const seen = new Map<string, number>();
  for (let c = 0; c < width; c++) {
    const raw = headerRow[c];
    let label = raw !== null && raw !== undefined && String(raw).trim() !== "" ? String(raw).trim() : `Column ${c + 1}`;
    const count = seen.get(label) ?? 0;
    if (count > 0) label = `${label} (${count + 1})`;
    seen.set(label, count + 1);
    headers.push(label);
  }
  return { headerRowIndex: bestIdx, headers };
}

/** Converts the rows below a detected header into plain objects, skipping any fully-blank row. */
export function rowsToObjects(rows: unknown[][], detection: HeaderDetection): Record<string, unknown>[] {
  const { headerRowIndex, headers } = detection;
  const out: Record<string, unknown>[] = [];
  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (isBlankRow(row)) continue;
    const obj: Record<string, unknown> = {};
    headers.forEach((h, c) => { obj[h] = row[c] ?? null; });
    out.push(obj);
  }
  return out;
}

/**
 * Splits a sheet into blank-row-separated blocks, so a sheet holding more
 * than one table (a title block, then a real table, or two stacked tables)
 * gets each candidate table profiled independently rather than merged.
 */
export function splitIntoBlocks(rows: unknown[][]): unknown[][][] {
  const blocks: unknown[][][] = [];
  let current: unknown[][] = [];
  for (const row of rows) {
    if (isBlankRow(row)) {
      if (current.length > 1) blocks.push(current);
      current = [];
    } else {
      current.push(row);
    }
  }
  if (current.length > 1) blocks.push(current);
  return blocks.length > 0 ? blocks : [rows];
}

/** Profiles every block in a sheet and returns the objects for the block with the most usable data rows. */
export function profileSheet(ws: XLSX.WorkSheet): { headers: string[]; rows: Record<string, unknown>[] } {
  const raw = readRawRows(ws);
  const blocks = splitIntoBlocks(raw);

  let best: { headers: string[]; rows: Record<string, unknown>[] } = { headers: [], rows: [] };
  for (const block of blocks) {
    const detection = detectHeaderRow(block);
    const objects = rowsToObjects(block, detection);
    if (objects.length > best.rows.length) best = { headers: detection.headers, rows: objects };
  }
  return best;
}
