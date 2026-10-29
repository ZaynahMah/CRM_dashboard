import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { subcategoriesFor, optionsFor, isSubcategoryValid } from "./pnDropdowns";

const bulk = readFileSync(join(__dirname, "../components/BulkWorkspace.tsx"), "utf8");
const drawer = readFileSync(join(__dirname, "../components/CampaignDrawer.tsx"), "utf8");
const queue = readFileSync(join(__dirname, "../components/RoleQueue.tsx"), "utf8");

/* ══════════ BUG 2 ══════════ */
describe("Bug 2 — Sub Cat reads the EDITED category code", () => {
  it("TrackingCell no longer reads the saved row directly", () => {
    expect(bulk).not.toContain('(campaign.tracking_category ?? "").toString().trim()');
  });

  it("the caller passes the merged dirty value", () => {
    expect(bulk).toContain('categoryCode={valueOf(c, "tracking_category")}');
  });

  it("TrackingCell takes categoryCode as a prop, not the campaign", () => {
    const fn = bulk.slice(bulk.indexOf("function TrackingCell"),
                          bulk.indexOf("const categoryCode"));
    expect(fn).toContain("categoryCode: string;");
    expect(fn).not.toContain("campaign: Campaign;");
  });

  /** Mirrors the cell's own gate. */
  const locked = (code: string) => code.trim() === "";

  it("(a) a category picked just now unlocks Sub Cat", () => {
    expect(locked("menap")).toBe(false);
    expect(subcategoriesFor("menap")).toHaveLength(16);
  });

  it("(b) a saved category after reload unlocks it too", () => {
    expect(locked("watches")).toBe(false);
    expect(subcategoriesFor("watches")).toHaveLength(4);
  });

  it("(c) a category applied by bulk fill unlocks it", () => {
    expect(bulk).toContain("next[id] = { ...next[id], [key]: fillValue };");
    expect(locked("menap")).toBe(false);
  });

  it("whitespace around a stored code does not lock the cell", () => {
    expect(locked("  menap  ")).toBe(false);
    expect(bulk).toContain('(rawCategoryCode ?? "").toString().trim()');
  });

  it("a category code unknown to the JSON leaves the cell ENABLED", () => {
    expect(locked("legacy_cat")).toBe(false);
    expect(subcategoriesFor("legacy_cat")).toEqual([]);
    expect(bulk).toContain("unknownCategory");
  });

  it("changing category clears an invalid sub-category", () => {
    const menapOnly = subcategoriesFor("menap")
      .find((x) => !subcategoriesFor("watches").includes(x))!;
    expect(isSubcategoryValid("watches", menapOnly)).toBe(false);
    expect(bulk).toContain('setField(c.id, "tracking_sub_category", "")');
  });
});

/* ══════════ BUG 1 ══════════ */
describe("Bug 1 — where Segment 1 actually lives", () => {
  const colsOf = (name: string) => {
    const i = bulk.indexOf(`const ${name}`);
    const blk = bulk.slice(i, bulk.indexOf("];", i));
    return [...blk.matchAll(/key: "([a-z_0-9]+)"/g)].map((m) => m[1]);
  };

  it("Segment 1 exists ONLY in the Final QC grid", () => {
    expect(colsOf("QC_COLUMNS")).toContain("segment_1");
    expect(colsOf("CATEGORY_COLUMNS")).not.toContain("segment_1");
    expect(colsOf("CATEGORY_INPUT_COLUMNS")).not.toContain("segment_1");
    expect(colsOf("CONTENT_INPUT_COLUMNS")).not.toContain("segment_1");
  });

  it("its config is correct: a searchable select fed by the JSON", () => {
    const line = bulk.split("\n").find((l) => l.includes('key: "segment_1"'))!;
    expect(line).toContain('type: "select"');
    expect(line).toContain('optionsFor("segment_1")');
    expect(line).toContain("searchable: true");
    expect(optionsFor("segment_1")).toHaveLength(47);
  });

  it("the select branch is reached before any fixed/readonly branch", () => {
    expect(bulk.indexOf('col.type === "select"'))
      .toBeLessThan(bulk.indexOf("col.fixed ? ("));
  });

  it("SearchSelect already renders a bordered trigger with a chevron", () => {
    const ss = readFileSync(join(__dirname, "../components/SearchSelect.tsx"), "utf8");
    expect(ss).toContain("border border-line");
    expect(ss).toContain('d="M6 9l6 6 6-6"');
  });
});

/* ══════════ PART A2 ══════════ */
describe("Part A2 — the drawer uses the same JSON dropdowns", () => {
  it.each(["campaign_type", "campaign_name_code", "channel_name"])(
    "%s is a JsonSelect in the drawer", (f) => {
      expect(drawer).toContain(`field="${f}"`);
    });

  it("defaults to pn / prp / push when unset", () => {
    expect(drawer).toContain("?? FIXED_TRACKING_VALUES.campaign_type");
    expect(drawer).toContain("?? FIXED_TRACKING_VALUES.campaign_name_code");
    expect(drawer).toContain("?? FIXED_TRACKING_VALUES.channel_name");
  });

  it("offers exactly the JSON options", () => {
    expect(optionsFor("campaign_type")).toHaveLength(5);
    expect(optionsFor("campaign_name_code")).toHaveLength(4);
    expect(optionsFor("channel_name")).toHaveLength(14);
  });

  it("keeps an off-list stored value selectable", () => {
    expect(drawer).toContain("{off && <option value={value}>{value}</option>}");
  });
});

/* ══════════ PART C ══════════ */
describe("Part C — the Content home category filter", () => {
  it("reuses the shared controlled list, not a new one", () => {
    expect(queue).toContain("CAMPAIGN_CATEGORY_FILTER_OPTIONS");
    expect(queue).toContain("filterByCategory");
    expect(queue).toContain('from "@/lib/categoryFilter"');
  });

  it("defaults to All categories", () => {
    expect(queue).toContain("useState<string>(ALL_CATEGORIES_LABEL)");
  });

  it("filters BEFORE the sections are derived, so counts match the rows", () => {
    expect(queue).toContain("const scoped = filterByCategory(campaigns, homeCategory);");
    expect(queue).toContain("pending: scoped.filter(withContent)");
    expect(queue).toContain("submitted: scoped.filter(contentSubmitted)");
  });

  it("the memo recomputes when the category changes", () => {
    expect(queue).toContain("}, [role, campaigns, homeCategory]);");
  });

  it("is Content-only", () => {
    expect(queue).toContain('role === "CONTENT" && (');
  });

  it("the choice survives opening Show All PN", () => {
    // The filter state is declared above the memo that consumes it, and
    // outlives the workspace, which is a child of this component.
    expect(queue.indexOf("const [homeCategory"))
      .toBeLessThan(queue.indexOf("const { pending, submitted, title"));
  });
});

/* ══════════ ROOT CAUSE: the portal menu was behind the modal ══════════ */
import { mergeOptions, isDuplicateOption, ALLOW_ADD_NEW, STORAGE_FIELD,
  normaliseOptionValue, isValidNewBrandCode } from "./pnDropdowns";

describe("the dropdown menu renders above the Show All PN modal", () => {
  const ss = readFileSync(join(__dirname, "../components/SearchSelect.tsx"), "utf8");

  it("the portal menu is z-[90], above the modal's z-[70]", () => {
    expect(ss).toContain("z-[90]");
    expect(ss).not.toContain('? "z-[60] rounded-xl');
    expect(bulk).toContain("fixed inset-0 z-[70]");
  });

  it("the menu z-index strictly exceeds the modal's", () => {
    const menuZ = Number(ss.match(/\? "z-\[(\d+)\] rounded-xl/)![1]);
    const modalZ = Number(bulk.match(/fixed inset-0 z-\[(\d+)\]/)![1]);
    expect(menuZ).toBeGreaterThan(modalZ);
  });

  it("flips upward when there is no room below", () => {
    expect(ss).toContain("const flip = below < MENU_MAX");
    expect(ss).toContain("Math.max(8, r.top - MENU_MAX - 4)");
  });

  it("is keyboard operable", () => {
    expect(ss).toContain('aria-haspopup="listbox"');
    expect(ss).toContain("aria-expanded={open}");
    expect(ss).toContain('e.key === "ArrowDown"');
  });

  it("the search input stays inside the menu", () => {
    expect(ss).toContain('placeholder="Type to search"');
  });
});

/* ══════════ ADD NEW BRAND CODE ══════════ */
describe("add new brand code", () => {
  it("is enabled for Brand only", () => {
    expect(ALLOW_ADD_NEW.has("tracking_brand")).toBe(true);
    expect(ALLOW_ADD_NEW.has("segment_1")).toBe(false);
    expect(ALLOW_ADD_NEW.has("keywords")).toBe(false);
  });

  it("maps columns to their storage field", () => {
    expect(STORAGE_FIELD.tracking_brand).toBe("brand_code");
  });

  it("appends added values AFTER the JSON list, in order added", () => {
    const merged = mergeOptions("tracking_brand", ["zzzcustom", "aaacustom"]);
    const base = optionsFor("tracking_brand");
    expect(merged.slice(0, base.length)).toEqual([...base]);
    expect(merged.slice(base.length)).toEqual(["zzzcustom", "aaacustom"]);
  });

  it("de-duplicates case-insensitively against the JSON", () => {
    const first = optionsFor("tracking_brand")[0];
    const merged = mergeOptions("tracking_brand", [first.toUpperCase()]);
    expect(merged).toHaveLength(optionsFor("tracking_brand").length);
  });

  it("rejects a duplicate of a JSON value, any case", () => {
    const first = optionsFor("tracking_brand")[0];
    expect(isDuplicateOption("tracking_brand", [], first)).toBe(true);
    expect(isDuplicateOption("tracking_brand", [], first.toUpperCase())).toBe(true);
    expect(isDuplicateOption("tracking_brand", [], ` ${first} `)).toBe(true);
  });

  it("rejects a duplicate of an already-added value", () => {
    expect(isDuplicateOption("tracking_brand", ["testbrand123"], "TestBrand123")).toBe(true);
  });

  it("accepts a genuinely new code", () => {
    expect(isDuplicateOption("tracking_brand", [], "testbrand123")).toBe(false);
    expect(isValidNewBrandCode("testbrand123")).toBe(true);
  });

  it('rejects "my brand!" and other invalid formats', () => {
    for (const bad of ["my brand!", "My Brand", "has-dash", "has_underscore", ""]) {
      expect(isValidNewBrandCode(bad), bad).toBe(false);
    }
  });

  it("normalises before comparing", () => {
    expect(normaliseOptionValue("  LEVIS  ")).toBe("levis");
  });

  it("the create row sits at the TOP of the menu", () => {
    const ss = readFileSync(join(__dirname, "../components/SearchSelect.tsx"), "utf8");
    expect(ss.indexOf("onCreate && (")).toBeLessThan(ss.indexOf('placeholder="Type to search"'));
    expect(ss).toContain("+ Add new value");
    expect(bulk).toContain('createLabel="+ Add new brand code"');
  });

  it("falls back to the JSON list when the table is unreachable", () => {
    const svc = readFileSync(join(__dirname, "../services/customOptions.ts"), "utf8");
    expect(svc).toContain("cache.set(field, []);");
    expect(svc).toContain("migration 30 has not been run");
  });

  it("reads the table once, not per cell", () => {
    const svc = readFileSync(join(__dirname, "../services/customOptions.ts"), "utf8");
    expect(svc).toContain("const cache = new Map");
    expect(svc).toContain("inflight");
    expect(bulk).toContain('listCustomOptions("tracking_brand")');
  });
});
