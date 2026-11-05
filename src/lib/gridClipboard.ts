import type { Campaign } from "@/types/campaign";

/**
 * Excel-style multi-cell copy and paste for the Category grid.
 *
 * Pure logic, kept out of the component so every rule — what may be
 * written, what is skipped and why — is testable without a DOM.
 *
 * Paste never submits anything. It fills the same `dirty` map typing fills,
 * and the existing Save Draft writes it in one batch.
 */

export interface CellRef { row: number; col: number }

export interface GridRange {
  top: number; left: number; bottom: number; right: number;
}

/** The rectangle between two clicks, in either direction. */
export function rangeBetween(a: CellRef, b: CellRef): GridRange {
  return {
    top: Math.min(a.row, b.row),
    bottom: Math.max(a.row, b.row),
    left: Math.min(a.col, b.col),
    right: Math.max(a.col, b.col),
  };
}

export const inRange = (r: GridRange, row: number, col: number) =>
  row >= r.top && row <= r.bottom && col >= r.left && col <= r.right;

export const rangeSize = (r: GridRange) =>
  (r.bottom - r.top + 1) * (r.right - r.left + 1);

/**
 * Clipboard text → a grid of values.
 *
 * Tab-separated columns, newline-separated rows, which is what Excel and
 * Google Sheets put on the clipboard. A trailing newline is dropped so a
 * copy from Excel does not gain an empty row.
 */
export function parseClipboard(text: string): string[][] {
  const body = text.replace(/\r\n/g, "\n").replace(/\n+$/, "");
  if (body === "") return [];
  return body.split("\n").map((line) => line.split("\t"));
}

/** A selection → clipboard text, so it also pastes into Excel. */
export function toClipboard(
  rows: Campaign[], cols: string[], range: GridRange,
  valueOf: (c: Campaign, key: string) => string
): string {
  const out: string[] = [];
  for (let r = range.top; r <= range.bottom; r++) {
    const line: string[] = [];
    for (let c = range.left; c <= range.right; c++) {
      const row = rows[r];
      line.push(row ? valueOf(row, cols[c]) : "");
    }
    out.push(line.join("\t"));
  }
  return out.join("\n");
}

export type SkipReason = "locked column" | "submitted row" | "not a valid option";

export interface PlannedWrite { rowId: string; key: string; value: string }

export interface SkippedCell {
  row: number; col: number;
  label: string;
  reason: SkipReason;
}

export interface PastePlan {
  writes: PlannedWrite[];
  skipped: SkippedCell[];
}

export interface PasteContext {
  rows: Campaign[];
  /** Column keys in display order. */
  cols: string[];
  /** Human labels, for the skipped list. */
  labels: Record<string, string>;
  /** Columns this role may write. */
  editable: Set<string>;
  /** Rows that must not be touched, by id. */
  lockedRowIds: Set<string>;
  /** Allowed values per column, when it is a dropdown. */
  options?: Record<string, readonly string[]>;
}

/**
 * Works out exactly what a paste would write, and what it would skip.
 *
 * Nothing is written past the last row or column — a paste can never create
 * a row. A single copied value fills the whole target selection, which is
 * what Excel does.
 */
export function planPaste(
  ctx: PasteContext,
  values: string[][],
  target: CellRef,
  selection?: GridRange
): PastePlan {
  const writes: PlannedWrite[] = [];
  const skipped: SkippedCell[] = [];
  if (values.length === 0) return { writes, skipped };

  const single = values.length === 1 && values[0].length === 1;
  // One value into a multi-cell selection fills all of it.
  const area: GridRange = single && selection && rangeSize(selection) > 1
    ? selection
    : {
        top: target.row,
        left: target.col,
        bottom: target.row + values.length - 1,
        right: target.col + Math.max(...values.map((v) => v.length)) - 1,
      };

  for (let r = area.top; r <= area.bottom; r++) {
    for (let c = area.left; c <= area.right; c++) {
      // Never past the last row or column.
      if (r >= ctx.rows.length || c >= ctx.cols.length) continue;

      const raw = single
        ? values[0][0]
        : (values[r - area.top]?.[c - area.left] ?? undefined);
      if (raw === undefined) continue;      // a ragged paste leaves gaps alone

      const key = ctx.cols[c];
      const row = ctx.rows[r];
      const label = ctx.labels[key] ?? key;

      if (!ctx.editable.has(key)) {
        skipped.push({ row: r, col: c, label, reason: "locked column" });
        continue;
      }
      if (ctx.lockedRowIds.has(row.id)) {
        skipped.push({ row: r, col: c, label, reason: "submitted row" });
        continue;
      }

      const allowed = ctx.options?.[key];
      let value = raw;
      if (allowed && allowed.length > 0) {
        // Case-insensitive and trimmed, but stored in the exact spelling.
        const match = allowed.find(
          (o) => o.trim().toLowerCase() === raw.trim().toLowerCase());
        if (!match) {
          skipped.push({ row: r, col: c, label, reason: "not a valid option" });
          continue;
        }
        value = match;
      }

      writes.push({ rowId: row.id, key, value });
    }
  }

  return { writes, skipped };
}

/** "Pasted 12 cells · skipped 3 (locked/invalid)" */
export function pasteSummary(plan: PastePlan): string {
  const n = plan.writes.length;
  const s = plan.skipped.length;
  const base = `Pasted ${n} cell${n === 1 ? "" : "s"}`;
  return s === 0 ? base : `${base} · skipped ${s} (locked/invalid)`;
}
