import { describe, it, expect } from "vitest";
import {
  validateRange, inRange, filterByDateRange, summariseRange,
  currentMonthRange, shiftRange,
} from "./dateRange";

const octCampaigns = [
  { id: "a", launch_date: "2026-10-01", category: "Beauty" },
  { id: "b", launch_date: "2026-10-05", category: "Men" },
  { id: "c", launch_date: "2026-10-10", category: "Kids" },
  { id: "d", launch_date: "2026-10-11", category: "Beauty" },
  { id: "e", launch_date: "2026-10-20", category: "Men" },
  { id: "f", launch_date: "2026-10-21", category: "Home" },
  { id: "g", launch_date: "2026-10-31", category: "Home" },
  { id: "h", launch_date: "2026-11-01", category: "Beauty" },
];
const dateOf = (c: { launch_date: string }) => c.launch_date;
const catOf = (c: { category: string }) => c.category;

describe("validation", () => {
  it("accepts a well-formed range", () => {
    expect(validateRange({ start: "2026-10-01", end: "2026-10-10" }).valid).toBe(true);
  });

  it("rejects an end date before the start date, with that exact message", () => {
    const v = validateRange({ start: "2026-10-10", end: "2026-10-01" });
    expect(v.valid).toBe(false);
    expect(v.error).toBe("End date cannot be before start date.");
  });

  it("allows a single-day range", () => {
    expect(validateRange({ start: "2026-10-05", end: "2026-10-05" }).valid).toBe(true);
  });

  it("requires both dates", () => {
    expect(validateRange({ end: "2026-10-10" }).error).toBe("Choose a start date.");
    expect(validateRange({ start: "2026-10-01" }).error).toBe("Choose an end date.");
  });

  it("rejects malformed dates", () => {
    expect(validateRange({ start: "01/10/2026", end: "2026-10-10" }).valid).toBe(false);
  });
});

describe("the range is INCLUSIVE on both ends", () => {
  const r = { start: "2026-10-01", end: "2026-10-10" };
  it("includes the first day", () => expect(inRange("2026-10-01", r)).toBe(true));
  it("includes the last day", () => expect(inRange("2026-10-10", r)).toBe(true));
  it("excludes the day before", () => expect(inRange("2026-09-30", r)).toBe(false));
  it("excludes the day after", () => expect(inRange("2026-10-11", r)).toBe(false));
  it("ignores a time component", () => expect(inRange("2026-10-05T18:30:00Z", r)).toBe(true));
  it("treats a missing date as out of range", () => {
    expect(inRange(null, r)).toBe(false);
    expect(inRange("", r)).toBe(false);
  });
});

describe("the three business fortnights partition October exactly", () => {
  const first = { start: "2026-10-01", end: "2026-10-10" };
  const second = { start: "2026-10-11", end: "2026-10-20" };
  const third = { start: "2026-10-21", end: "2026-10-31" };

  it("1–10 Oct", () => {
    expect(filterByDateRange(octCampaigns, first, dateOf).map((c) => c.id))
      .toEqual(["a", "b", "c"]);
  });
  it("11–20 Oct", () => {
    expect(filterByDateRange(octCampaigns, second, dateOf).map((c) => c.id))
      .toEqual(["d", "e"]);
  });
  it("21–31 Oct", () => {
    expect(filterByDateRange(octCampaigns, third, dateOf).map((c) => c.id))
      .toEqual(["f", "g"]);
  });

  it("no campaign appears in two ranges, and none is skipped", () => {
    const all = [first, second, third].flatMap((r) =>
      filterByDateRange(octCampaigns, r, dateOf).map((c) => c.id));
    expect(new Set(all).size).toBe(all.length);           // no overlap
    expect(all.sort()).toEqual(["a", "b", "c", "d", "e", "f", "g"]);  // no gap
  });

  it("a November campaign is in none of them", () => {
    expect([first, second, third].every((r) => !inRange("2026-11-01", r))).toBe(true);
  });
});

describe("export modal summary", () => {
  it("reports the count, the categories and the range in words", () => {
    const s = summariseRange(octCampaigns, { start: "2026-10-01", end: "2026-10-10" },
      dateOf, catOf);
    expect(s.count).toBe(3);
    expect(s.categories).toEqual(["Beauty", "Kids", "Men"]);
    expect(s.label).toBe("1 Oct → 10 Oct");
  });

  it("categories are distinct and sorted", () => {
    const s = summariseRange(octCampaigns, { start: "2026-10-01", end: "2026-10-31" },
      dateOf, catOf);
    expect(s.categories).toEqual(["Beauty", "Home", "Kids", "Men"]);
  });

  it("blank categories are dropped, not shown as empty entries", () => {
    const s = summariseRange(
      [{ launch_date: "2026-10-02", category: "" }, { launch_date: "2026-10-03", category: "Men" }],
      { start: "2026-10-01", end: "2026-10-10" }, dateOf, catOf);
    expect(s.categories).toEqual(["Men"]);
  });

  it("an empty range reports zero, so the UI can refuse to export", () => {
    const s = summariseRange(octCampaigns, { start: "2026-12-01", end: "2026-12-31" },
      dateOf, catOf);
    expect(s.count).toBe(0);
    expect(s.items).toEqual([]);
  });
});

describe("reusable beyond Content", () => {
  it("works on any shape, via the accessor", () => {
    const reports = [{ when: "2026-10-03", team: "CRM" }, { when: "2026-11-03", team: "CRM" }];
    expect(filterByDateRange(reports, { start: "2026-10-01", end: "2026-10-31" },
      (r) => r.when)).toHaveLength(1);
  });

  it("works with no category accessor at all", () => {
    const s = summariseRange(octCampaigns, { start: "2026-10-01", end: "2026-10-10" }, dateOf);
    expect(s.count).toBe(3);
    expect(s.categories).toEqual([]);
  });
});

describe("helpers", () => {
  it("defaults to the current calendar month", () => {
    const r = currentMonthRange(new Date(2026, 9, 15));   // Oct 2026
    expect(r.start).toBe("2026-10-01");
    expect(r.end).toBe("2026-10-31");
  });

  it("handles a 30-day month and February", () => {
    expect(currentMonthRange(new Date(2026, 3, 10)).end).toBe("2026-04-30");
    expect(currentMonthRange(new Date(2026, 1, 10)).end).toBe("2026-02-28");
  });

  it("shifts a range by whole days", () => {
    expect(shiftRange({ start: "2026-10-01", end: "2026-10-10" }, 10))
      .toEqual({ start: "2026-10-11", end: "2026-10-20" });
  });
});
