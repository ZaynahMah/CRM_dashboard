import { describe, it, expect } from "vitest";
import {
  planningWindow, planningWeeks, inPlanningWindow, withinPlanningWindow,
} from "./planningWindow";
import {
  matchesCategoryFilter, filterByCategory,
  CAMPAIGN_CATEGORY_FILTER_OPTIONS, ALL_CATEGORIES_LABEL,
} from "./categoryFilter";

/** 26 October 2026, the stated current date. Never hard-coded in src. */
const OCT26 = new Date(2026, 9, 26);

/* ══════════ TESTS A–I: the planning window ══════════ */
describe("Tests A, E, F — the window is month start -> next month 14th", () => {
  const w = planningWindow(OCT26);

  it("A — 26 Oct 2026 gives 1 Oct 2026 -> 14 Nov 2026", () => {
    expect(w.start).toBe("2026-10-01");
    expect(w.end).toBe("2026-11-14");
  });

  it("is NOT today + 14 days", () => {
    expect(w.end).not.toBe("2026-11-09");
    expect(w.start).not.toBe("2026-10-26");
  });

  it("E — 14 November is included", () => {
    expect(inPlanningWindow("2026-11-14", w)).toBe(true);
  });

  it("F — 15 November is outside", () => {
    expect(inPlanningWindow("2026-11-15", w)).toBe(false);
  });

  it("does not stop at 31 October", () => {
    expect(inPlanningWindow("2026-11-01", w)).toBe(true);
    expect(inPlanningWindow("2026-11-05", w)).toBe(true);
  });

  it("September is outside", () => {
    expect(inPlanningWindow("2026-09-30", w)).toBe(false);
  });

  it("the same window holds on any day of the month", () => {
    for (const d of [1, 15, 26, 31]) {
      const x = planningWindow(new Date(2026, 9, d));
      expect(x.start).toBe("2026-10-01");
      expect(x.end).toBe("2026-11-14");
    }
  });
});

describe("Tests B, C, D — placement is by CAMPAIGN DATE", () => {
  const w = planningWindow(OCT26);

  it("B — submitted 26 Oct, dated 5 Nov, appears", () => {
    const pn = { launch_date: "2026-11-05", created_at: "2026-10-26T10:00:00Z" };
    expect(withinPlanningWindow([pn], w)).toHaveLength(1);
  });

  it("C — submitted 28 Oct, dated 12 Nov, appears", () => {
    expect(withinPlanningWindow(
      [{ launch_date: "2026-11-12", submitted_at: "2026-10-28T10:00:00Z" }], w)).toHaveLength(1);
  });

  it("D — created_at/submitted_at/updated_at are never used", () => {
    // Dated outside, submitted inside: must NOT appear.
    const outside = {
      launch_date: "2026-12-01",
      created_at: "2026-10-26T10:00:00Z",
      submitted_at: "2026-10-26T10:00:00Z",
      updated_at: "2026-10-26T10:00:00Z",
    };
    expect(withinPlanningWindow([outside], w)).toHaveLength(0);
  });

  it("a PN with no campaign date is placed nowhere", () => {
    expect(withinPlanningWindow([{ launch_date: null }], w)).toHaveLength(0);
  });
});

describe("Test G — year boundary", () => {
  it("December 2026 gives 1 Dec 2026 -> 14 Jan 2027", () => {
    const w = planningWindow(new Date(2026, 11, 10));
    expect(w.start).toBe("2026-12-01");
    expect(w.end).toBe("2027-01-14");
  });

  it("November gives 1 Nov -> 14 Dec", () => {
    const w = planningWindow(new Date(2026, 10, 3));
    expect(w.start).toBe("2026-11-01");
    expect(w.end).toBe("2026-12-14");
  });

  it("works for every month of the year", () => {
    for (let m = 0; m < 12; m++) {
      const w = planningWindow(new Date(2026, m, 15));
      expect(w.start.endsWith("-01")).toBe(true);
      expect(w.end.endsWith("-14")).toBe(true);
      expect(w.end > w.start).toBe(true);
    }
  });

  it("February, a short month, is handled", () => {
    const w = planningWindow(new Date(2026, 1, 20));
    expect(w.start).toBe("2026-02-01");
    expect(w.end).toBe("2026-03-14");
  });
});

describe("Test I — week buckets are generated, never hard-coded", () => {
  const weeks = planningWeeks(planningWindow(OCT26));

  it("covers 1 Oct through 14 Nov", () => {
    expect(weeks[0].start).toBe("2026-10-01");
    expect(weeks[weeks.length - 1].end >= "2026-11-14").toBe(true);
  });

  it("produces more than the five weeks of one month", () => {
    expect(weeks.length).toBeGreaterThan(5);
    expect(weeks.length).toBeLessThanOrEqual(8);
  });

  it("includes the bucket containing 14 November", () => {
    expect(weeks.some((w) => w.start <= "2026-11-14" && w.end >= "2026-11-14")).toBe(true);
  });

  it("buckets are ordered and do not overlap", () => {
    for (let i = 1; i < weeks.length; i++) {
      expect(weeks[i].start > weeks[i - 1].start).toBe(true);
      expect(weeks[i].start > weeks[i - 1].end).toBe(true);
    }
  });

  it("the count follows the dates — December differs from October", () => {
    const dec = planningWeeks(planningWindow(new Date(2026, 11, 1)));
    expect(dec.length).toBeGreaterThan(5);
    expect(dec[dec.length - 1].end >= "2027-01-14").toBe(true);
  });
});

/* ══════════ TESTS 6, 7, 8, H: the category filter ══════════ */
describe("Tests 6-8 — the controlled category list", () => {
  it("has exactly the twenty approved labels, in order", () => {
    expect([...CAMPAIGN_CATEGORY_FILTER_OPTIONS]).toEqual([
      "Electronics", "Women AE", "MenA", "Non Fragrance", "Eyewear",
      "Westside", "Watches", "KidsA", "MenF", "Fine jewl", "Fragrance",
      "CRM", "PC/CC", "H & W", "WomenF", "Silver/Fashion Jew",
      "Women AW", "Home", "MenAcc", "WomenAcc",
    ]);
    expect(CAMPAIGN_CATEGORY_FILTER_OPTIONS).toHaveLength(20);
  });

  it("7 — Electronics shows only Electronics rows", () => {
    const rows = [
      { category: "Electronics" }, { category: "Westside" }, { category: "Home" },
    ];
    expect(filterByCategory(rows, "Electronics")).toEqual([{ category: "Electronics" }]);
  });

  it("8 — All Categories returns everything", () => {
    const rows = [{ category: "Electronics" }, { category: "Westside" }];
    expect(filterByCategory(rows, ALL_CATEGORIES_LABEL)).toHaveLength(2);
    expect(filterByCategory(rows, "")).toHaveLength(2);
  });

  it("matches stored abbreviations via the alias map", () => {
    expect(matchesCategoryFilter("WomAE", "Women AE")).toBe(true);
    expect(matchesCategoryFilter("MenAcc", "MenAcc")).toBe(true);
    expect(matchesCategoryFilter("H&W", "H & W")).toBe(true);
    expect(matchesCategoryFilter("PC/CC", "PC/CC")).toBe(true);
    expect(matchesCategoryFilter("FineJew", "Fine jewl")).toBe(true);
  });

  it("is insensitive to case and spacing, without rewriting the record", () => {
    expect(matchesCategoryFilter(" electronics ", "Electronics")).toBe(true);
    expect(matchesCategoryFilter("WESTSIDE", "Westside")).toBe(true);
  });

  it("does not match the wrong category", () => {
    expect(matchesCategoryFilter("Westside", "Electronics")).toBe(false);
    expect(matchesCategoryFilter("Women AE", "Women AW")).toBe(false);
  });

  it("a blank category never matches a specific label", () => {
    expect(matchesCategoryFilter(null, "Electronics")).toBe(false);
    expect(matchesCategoryFilter("", "Electronics")).toBe(false);
  });

  it("H — the filter spans the whole window, October AND November", () => {
    const w = planningWindow(OCT26);
    const rows = [
      { category: "Electronics", launch_date: "2026-10-12" },
      { category: "Electronics", launch_date: "2026-11-05" },
      { category: "Westside", launch_date: "2026-11-06" },
      { category: "Electronics", launch_date: "2026-11-20" },   // outside
    ];
    const visible = withinPlanningWindow(rows, w);
    const electronics = filterByCategory(visible, "Electronics");
    expect(electronics).toHaveLength(2);
    expect(electronics.map((r) => r.launch_date)).toEqual(["2026-10-12", "2026-11-05"]);
  });
});
