import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  missingCategoryFields, isCategoryFieldFilled, categoryReadyToSubmit,
  validateCategorySelection, CATEGORY_REQUIRED,
} from "./categoryValidation";
import type { Campaign } from "@/types/campaign";

const read = (p: string) => readFileSync(join(__dirname, p), "utf8");
const bulk = read("../components/BulkWorkspace.tsx");

const full = (o: Partial<Campaign> = {}) => ({
  id: "c1", campaign_name: "PN A", launch_date: "2026-11-12",
  pncc_segment_label: "Push_Women", slot_label: "3",
  sub_category: "Shoes", brand: "Biba", offer: "40% off", brief: "Festive",
  landing: "https://www.tatacliq.com/x", expected_cvr: "2", expected_rpv: "50",
  additional_notes: "", date_time_brief: "", ...o,
}) as unknown as Campaign;

/* ══════════ ADDITION A ══════════ */
describe("A — the seven Category fields gate the bulk send", () => {
  it("a complete PN passes", () => {
    expect(missingCategoryFields(full())).toEqual([]);
    expect(categoryReadyToSubmit(full())).toBe(true);
  });

  it.each([...CATEGORY_REQUIRED])("missing %s blocks it", (field) => {
    const c = full({ [field]: null } as Partial<Campaign>);
    expect(categoryReadyToSubmit(c)).toBe(false);
    expect(missingCategoryFields(c)).toHaveLength(1);
  });

  it("Comments and Date / Time Brief never block", () => {
    expect(categoryReadyToSubmit(
      full({ additional_notes: "", date_time_brief: "" }))).toBe(true);
  });

  it('empty, whitespace and "-" all count as missing', () => {
    for (const v of ["", "   ", "-", "—", "Select", null, undefined]) {
      expect(isCategoryFieldFilled(v), String(v)).toBe(false);
    }
    expect(isCategoryFieldFilled("Shoes")).toBe(true);
    expect(isCategoryFieldFilled(0)).toBe(true);        // a real 0 is a value
  });

  it("a mixed selection blocks EVERYTHING and lists the incomplete", () => {
    const rows = [full({ id: "a" }), full({ id: "b" }),
      full({ id: "c", brand: null }), full({ id: "d", expected_rpv: "  " })];
    const r = validateCategorySelection(rows);
    expect(r.ok).toBe(false);
    expect(r.incomplete.map((x) => x.id)).toEqual(["c", "d"]);
    expect(r.incomplete[0].missing).toEqual(["Brand"]);
    expect(r.incomplete[1].missing).toEqual(["Expected RPV"]);
  });

  it("names an incomplete PN by name, date, segment and slot", () => {
    const r = validateCategorySelection([full({ brand: null })]);
    expect(r.incomplete[0].label).toBe("PN A · 2026-11-12 · Push_Women · slot 3");
  });

  it("an all-complete selection passes", () => {
    expect(validateCategorySelection([full({ id: "a" }), full({ id: "b" })]).ok)
      .toBe(true);
  });

  it("the grid blocks before sending and sends nothing", () => {
    expect(bulk).toContain('if (mode === "CATEGORY_INPUT") {');
    expect(bulk).toContain("validateCategorySelection(rows)");
    expect(bulk).toContain("Nothing was sent.");
  });

  it("marks the seven headers and the blocking cells", () => {
    expect(bulk).toContain('mode === "CATEGORY_INPUT"');
    expect(bulk).toContain('text-danger-500">*</span>');
    expect(bulk).toContain("ring-1 ring-inset ring-[#FDA29B]");
  });

  it("offers a way to select only the incomplete rows", () => {
    expect(bulk).toContain("Select only the incomplete (");
    expect(bulk).toContain("setSelected(new Set(incomplete.map((r) => r.id)))");
  });

  it("uses unsaved edits, not just the saved row", () => {
    expect(bulk).toContain("...(dirty[c.id] ?? {})");
  });
});

/* ══════════ ADDITION B ══════════ */
describe("B — the vibration", () => {
  it("rows are pinned to the height the virtualiser assumes", () => {
    expect(bulk).toContain("style={wrapRows ? undefined : { height: rowH }}");
  });

  it("cells cannot exceed that height", () => {
    expect(bulk).toContain('const FIXED_CELL = "h-[33px] max-h-[33px] overflow-hidden align-middle"');
    expect(bulk).toContain('wrapRows ? "align-top" : FIXED_CELL');
  });

  it("the off-list hints no longer add a line", () => {
    expect(bulk).toContain("absolute right-0.5 top-0.5");
    expect(bulk).not.toContain('className="block px-2 pb-1 text-[10px] text-warning-700"');
  });

  it("wrapped modes keep their taller rows", () => {
    expect(bulk).toContain("wrapRows ? undefined :");
  });

  it("the Phase 1 work is still in place", () => {
    expect(bulk).toContain("if (renderAllRef.current) return;");
    expect(bulk).toContain("const pickHandlerFor = useCallback");
  });

  it("rows are keyed by PN id", () => {
    expect(bulk).toContain("<tr key={c.id}");
  });
});

/* ══════════ ADDITION C ══════════ */
describe("C — the Content input chain", () => {
  const block = bulk.slice(bulk.indexOf("const CONTENT_INPUT_COLUMNS"),
                           bulk.indexOf("];", bulk.indexOf("const CONTENT_INPUT_COLUMNS")));
  const keys = [...block.matchAll(/key: "([a-z_0-9]+)"/g)].map((m) => m[1]);

  it("is in exactly the agreed order", () => {
    expect(keys.slice(0, 21)).toEqual([
      "launch_date", "launch_time", "category", "pncc_segment_label", "slot_label",
      "sub_category", "brand", "offer", "landing", "expected_cvr", "expected_rpv",
      "brief", "title_brief", "message_brief", "pn_template",
      "creative_requirements", "pn_type",
      "header", "sub_copy_text", "h_count", "s_count"]);
  });

  it("columns 1-17 are read-only", () => {
    for (const k of keys.slice(0, 17)) {
      const line = block.split("\n").find((l) => l.includes(`key: "${k}"`))!;
      expect(line, k).toContain('type: "readonly"');
    }
  });

  it("Content still edits only Header and Sub Copy", () => {
    for (const k of ["header", "sub_copy_text"]) {
      const line = block.split("\n").find((l) => l.includes(`key: "${k}"`))!;
      expect(line, k).not.toContain('type: "readonly"');
    }
  });

  it("H Count and S Count stay derived, not typed", () => {
    for (const k of ["h_count", "s_count"]) {
      expect(block.split("\n").find((l) => l.includes(`key: "${k}"`))!).toContain('type: "readonly"');
    }
    expect(read("../services/contentBulk.ts")).toContain("h_count: countOf(");
  });

  it("the other roles' column sets are UNCHANGED", () => {
    const qc = bulk.slice(bulk.indexOf("const QC_COLUMNS"),
                          bulk.indexOf("];", bulk.indexOf("const QC_COLUMNS")));
    expect([...qc.matchAll(/key: "([a-z_0-9]+)"/g)]).toHaveLength(43);
    const cat = bulk.slice(bulk.indexOf("const CATEGORY_COLUMNS"),
                           bulk.indexOf("];", bulk.indexOf("const CATEGORY_COLUMNS")));
    expect(cat).toContain('key: "pn_type"');
    const catIn = bulk.slice(bulk.indexOf("const CATEGORY_INPUT_COLUMNS"),
                             bulk.indexOf("];", bulk.indexOf("const CATEGORY_INPUT_COLUMNS")));
    expect(catIn).toContain('key: "brand"');
  });

  it("ownership is unchanged — this is display only", () => {
    // pn_type stays CRM-owned; the Content grid shows it read-only.
    const line = block.split("\n").find((l) => l.includes('key: "pn_type"'))!;
    expect(line).toContain('type: "readonly"');
  });
});
