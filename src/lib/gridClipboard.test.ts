import { describe, it, expect } from "vitest";
import {
  rangeBetween, inRange, rangeSize, parseClipboard, toClipboard,
  planPaste, pasteSummary, type PasteContext,
} from "./gridClipboard";
import type { Campaign } from "@/types/campaign";

const COLS = ["launch_date", "sub_category", "brand", "offer", "brief"];
const EDITABLE = new Set(["sub_category", "brand", "offer", "brief"]);
const LABELS: Record<string, string> = {
  launch_date: "Date", sub_category: "Sub Category",
  brand: "Brand", offer: "Offer", brief: "Brief",
};

const pn = (id: string, o: Partial<Campaign> = {}) =>
  ({ id, launch_date: "2026-11-12", sub_category: "", brand: "",
     offer: "", brief: "", ...o }) as unknown as Campaign;

const ctx = (o: Partial<PasteContext> = {}): PasteContext => ({
  rows: [pn("r0"), pn("r1"), pn("r2")],
  cols: COLS, labels: LABELS, editable: EDITABLE,
  lockedRowIds: new Set(), ...o,
});

describe("selecting a range", () => {
  it("works in any direction", () => {
    const a = rangeBetween({ row: 5, col: 3 }, { row: 2, col: 1 });
    expect(a).toEqual({ top: 2, bottom: 5, left: 1, right: 3 });
    expect(rangeBetween({ row: 2, col: 1 }, { row: 5, col: 3 })).toEqual(a);
  });

  it("knows what is inside", () => {
    const r = rangeBetween({ row: 1, col: 1 }, { row: 2, col: 2 });
    expect(inRange(r, 1, 2)).toBe(true);
    expect(inRange(r, 0, 1)).toBe(false);
    expect(rangeSize(r)).toBe(4);
  });
});

describe("clipboard text", () => {
  it("parses tab and newline separated values", () => {
    expect(parseClipboard("a\tb\nc\td")).toEqual([["a", "b"], ["c", "d"]]);
  });

  it("handles Windows line endings and a trailing newline", () => {
    expect(parseClipboard("a\tb\r\nc\td\r\n")).toEqual([["a", "b"], ["c", "d"]]);
  });

  it("an empty clipboard yields nothing", () => {
    expect(parseClipboard("")).toEqual([]);
    expect(parseClipboard("\n")).toEqual([]);
  });

  it("keeps empty cells inside a row", () => {
    expect(parseClipboard("a\t\tc")).toEqual([["a", "", "c"]]);
  });

  it("copies a selection out as TSV, so Excel can read it", () => {
    const rows = [pn("r0", { brand: "Biba", offer: "40% off" }),
                  pn("r1", { brand: "W", offer: "30% off" })];
    const text = toClipboard(rows, COLS,
      { top: 0, bottom: 1, left: 2, right: 3 },
      (c, k) => String((c as unknown as Record<string, unknown>)[k] ?? ""));
    expect(text).toBe("Biba\t40% off\nW\t30% off");
  });
});

describe("planning a paste", () => {
  it("fills right and down from the target, in order", () => {
    const plan = planPaste(ctx(), [["a", "b"], ["c", "d"]], { row: 0, col: 1 });
    expect(plan.writes).toEqual([
      { rowId: "r0", key: "sub_category", value: "a" },
      { rowId: "r0", key: "brand",        value: "b" },
      { rowId: "r1", key: "sub_category", value: "c" },
      { rowId: "r1", key: "brand",        value: "d" },
    ]);
    expect(plan.skipped).toEqual([]);
  });

  it("a single value fills a whole selection", () => {
    const plan = planPaste(ctx(), [["x"]], { row: 0, col: 1 },
      { top: 0, bottom: 1, left: 1, right: 2 });
    expect(plan.writes).toHaveLength(4);
    expect(plan.writes.every((w) => w.value === "x")).toBe(true);
  });

  it("a single value into a single cell writes once", () => {
    expect(planPaste(ctx(), [["x"]], { row: 0, col: 1 }).writes).toHaveLength(1);
  });

  it("never writes past the last row", () => {
    const plan = planPaste(ctx(), [["a"], ["b"], ["c"], ["d"]], { row: 1, col: 1 });
    expect(plan.writes).toHaveLength(2);          // only r1 and r2 exist
    expect(plan.writes.map((w) => w.rowId)).toEqual(["r1", "r2"]);
  });

  it("never writes past the last column", () => {
    const plan = planPaste(ctx(), [["a", "b", "c"]], { row: 0, col: 3 });
    expect(plan.writes.map((w) => w.key)).toEqual(["offer", "brief"]);
  });

  it("skips a locked column and says why", () => {
    const plan = planPaste(ctx(), [["a", "b"]], { row: 0, col: 0 });
    expect(plan.writes).toEqual([{ rowId: "r0", key: "sub_category", value: "b" }]);
    expect(plan.skipped).toEqual([
      { row: 0, col: 0, label: "Date", reason: "locked column" },
    ]);
  });

  it("skips a submitted row entirely", () => {
    const plan = planPaste(ctx({ lockedRowIds: new Set(["r1"]) }),
      [["a"], ["b"]], { row: 0, col: 1 });
    expect(plan.writes).toEqual([{ rowId: "r0", key: "sub_category", value: "a" }]);
    expect(plan.skipped[0].reason).toBe("submitted row");
  });

  it("a dropdown accepts a case-insensitive match, stored in its own spelling", () => {
    const plan = planPaste(
      ctx({ options: { brand: ["Biba", "W"] } }),
      [["  biba  "]], { row: 0, col: 2 });
    expect(plan.writes).toEqual([{ rowId: "r0", key: "brand", value: "Biba" }]);
  });

  it("a dropdown rejects anything else", () => {
    const plan = planPaste(
      ctx({ options: { brand: ["Biba", "W"] } }),
      [["Nike"]], { row: 0, col: 2 });
    expect(plan.writes).toEqual([]);
    expect(plan.skipped[0].reason).toBe("not a valid option");
  });

  it("an empty clipboard changes nothing", () => {
    expect(planPaste(ctx(), [], { row: 0, col: 1 }))
      .toEqual({ writes: [], skipped: [] });
  });

  it("a ragged paste leaves the missing cells alone", () => {
    const plan = planPaste(ctx(), [["a", "b"], ["c"]], { row: 0, col: 1 });
    expect(plan.writes).toHaveLength(3);
  });

  it("an empty string IS a value — it clears the cell", () => {
    const plan = planPaste(ctx(), [[""]], { row: 0, col: 1 });
    expect(plan.writes).toEqual([{ rowId: "r0", key: "sub_category", value: "" }]);
  });
});

describe("the summary line", () => {
  it("reports only what was written when nothing was skipped", () => {
    expect(pasteSummary({ writes: [{ rowId: "a", key: "b", value: "c" }], skipped: [] }))
      .toBe("Pasted 1 cell");
  });

  it("reports both counts otherwise", () => {
    expect(pasteSummary({
      writes: new Array(12).fill({ rowId: "a", key: "b", value: "c" }),
      skipped: new Array(3).fill({ row: 0, col: 0, label: "Date", reason: "locked column" }),
    })).toBe("Pasted 12 cells · skipped 3 (locked/invalid)");
  });
});

/* ══════════ the wiring in BulkWorkspace ══════════ */
import { readFileSync } from "fs";
import { join } from "path";
const bulk = readFileSync(join(__dirname, "../components/BulkWorkspace.tsx"), "utf8");

describe("it is wired into the Category grid only", () => {
  it("every handler is gated on the Category mode", () => {
    expect(bulk).toContain('const isCategoryGrid = mode === "CATEGORY_INPUT";');
    expect(bulk).toContain("onMouseDown={isCategoryGrid ?");
    expect(bulk).toContain("if (!isCategoryGrid) return;");
  });

  it("editable columns come from the column set, not a hard-coded list", () => {
    expect(bulk).toContain('columns.filter((c) => c.type !== "readonly" && c.type !== "deadline")');
  });

  it("submitted rows are excluded from a paste", () => {
    expect(bulk).toContain('c.category_status === "LOCKED" || c.category_status === "SUBMITTED"');
  });

  it("typing is never intercepted", () => {
    expect(bulk).toContain("/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)");
    expect(bulk).toContain("&& !typing");
  });

  it("a paste writes to the SAME dirty map typing uses", () => {
    expect(bulk).toContain("next[w.rowId] = { ...next[w.rowId], [w.key]: w.value };");
    // No direct save: Save Draft still batches it.
    const fn = bulk.slice(bulk.indexOf("const pasteInto = useCallback"),
                          bulk.indexOf("const undoPaste = useCallback"));
    expect(fn).not.toContain("updateCampaign");
  });

  it("undo restores exactly what each cell held", () => {
    expect(bulk).toContain("before: dirty[w.rowId]?.[w.key as keyof Campaign]");
    expect(bulk).toContain("if (u.before === undefined) delete row[u.key as keyof Campaign];");
  });

  it("shift-click extends from the anchor; dragging extends live", () => {
    expect(bulk).toContain("if (e.shiftKey && anchor) setFocusCell(cell);");
    expect(bulk).toContain("onMouseEnter={isCategoryGrid && dragging");
  });

  it("the selection is highlighted", () => {
    expect(bulk).toContain("inRange(selection, i, ci)");
    expect(bulk).toContain("bg-indigo-50 ring-1 ring-inset ring-indigo-200");
  });

  it("the toast reports the counts and can list the skipped cells", () => {
    expect(bulk).toContain("pasteSummary(pasteNote)");
    expect(bulk).toContain("Row {sk.row + 1} · {sk.label} — {sk.reason}");
    expect(bulk).toContain("Undo paste (Ctrl+Z)");
  });

  it("the Category bulk-send rules are untouched", () => {
    expect(bulk).toContain("validateCategorySelection(rows)");
    expect(bulk).toContain("Nothing was sent.");
  });
});
