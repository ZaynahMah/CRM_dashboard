import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  istToday, addDaysIso, quickPickRange, QUICK_PICKS,
} from "./dateRange";

const read = (p: string) => readFileSync(join(__dirname, p), "utf8");
const page = read("../app/(app)/campaigns/page.tsx");
const filter = read("../components/DateRangeFilter.tsx");

/** 2026-11-12 is a Thursday. 18:30 UTC is 00:00 IST on the 13th. */
const THU = new Date("2026-11-12T06:00:00Z");

describe("IST dates, with no off-by-one", () => {
  it("resolves today in Asia/Kolkata, not the browser zone", () => {
    expect(istToday(THU)).toBe("2026-11-12");
  });

  it("late UTC on the 12th is already the 13th in IST", () => {
    // 19:00 UTC = 00:30 IST the next day.
    expect(istToday(new Date("2026-11-12T19:00:00Z"))).toBe("2026-11-13");
  });

  it("early UTC on the 12th is still the 12th in IST", () => {
    expect(istToday(new Date("2026-11-12T00:01:00Z"))).toBe("2026-11-12");
  });

  it("adds days without drifting across a month end", () => {
    expect(addDaysIso("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDaysIso("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDaysIso("2028-02-28", 1)).toBe("2028-02-29");   // leap year
  });
});

describe("the quick picks", () => {
  it("Today is a single day", () => {
    expect(quickPickRange("today", THU)).toEqual({ start: "2026-11-12", end: "2026-11-12" });
  });

  it("Tomorrow is the next single day", () => {
    expect(quickPickRange("tomorrow", THU)).toEqual({ start: "2026-11-13", end: "2026-11-13" });
  });

  it("This week runs Monday to Sunday around today", () => {
    expect(quickPickRange("this-week", THU)).toEqual({ start: "2026-11-09", end: "2026-11-15" });
  });

  it("a Sunday still belongs to the week that began on Monday", () => {
    const sun = new Date("2026-11-15T06:00:00Z");
    expect(quickPickRange("this-week", sun)).toEqual({ start: "2026-11-09", end: "2026-11-15" });
  });

  it("a Monday starts its own week", () => {
    const mon = new Date("2026-11-09T06:00:00Z");
    expect(quickPickRange("this-week", mon).start).toBe("2026-11-09");
  });

  it("Next 7 days includes today", () => {
    expect(quickPickRange("next-7", THU)).toEqual({ start: "2026-11-12", end: "2026-11-18" });
  });

  it("This month covers the whole month", () => {
    expect(quickPickRange("this-month", THU)).toEqual({ start: "2026-11-01", end: "2026-11-30" });
  });

  it("February gets the right last day", () => {
    expect(quickPickRange("this-month", new Date("2028-02-10T06:00:00Z")).end)
      .toBe("2028-02-29");
    expect(quickPickRange("this-month", new Date("2026-02-10T06:00:00Z")).end)
      .toBe("2026-02-28");
  });

  it("all five are offered", () => {
    expect(QUICK_PICKS.map((p) => p.key)).toEqual([
      "today", "tomorrow", "this-week", "next-7", "this-month"]);
  });
});

describe("it narrows, and never replaces, the other filters", () => {
  it("every filter still ANDs in one pass", () => {
    for (const f of ["if (term &&", "matchesCategoryFilter(c.category, category)",
                     "if (origin && c.campaign_origin !== origin)",
                     "if (stage && stageOf(c) !== stage)"]) {
      expect(page, f).toContain(f);
    }
    expect(page).toContain("if (dates.start || dates.end) {");
  });

  it("filters on launch_date — the column the calendar uses", () => {
    expect(page).toContain("campaignDateIso(c.launch_date)");
    expect(read("../app/(app)/calendar/page.tsx")).toContain("c.launch_date");
  });

  it("the range is inclusive at both ends", () => {
    expect(page).toContain("if (dates.start && d < dates.start) return false;");
    expect(page).toContain("if (dates.end && d > dates.end) return false;");
  });

  it("a dateless PN is hidden only while the filter is on", () => {
    expect(page).toContain("if (d === null) return false;");
    // The guard sits INSIDE the `if (dates.start || dates.end)` block.
    const block = page.slice(page.indexOf("if (dates.start || dates.end) {"),
                             page.indexOf("return true;", page.indexOf("if (dates.start || dates.end) {")));
    expect(block).toContain("if (d === null) return false;");
  });

  it("the memo recomputes when the dates change", () => {
    expect(page).toContain("}, [campaigns, q, category, origin, stage, dates]);");
  });

  it("the count shown is the fully filtered one", () => {
    expect(page).toContain("matching={rows.length}");
  });
});

describe("the control itself", () => {
  it("shows the active range", () => {
    expect(filter).toContain("{fmtDate(value.start)} – {fmtDate(value.end)}");
  });

  it("has a Clear that resets to all dates", () => {
    expect(filter).toContain("onClick={() => onChange({})}");
  });

  it("refuses an inverted range rather than showing nothing", () => {
    expect(filter).toContain("validateRange(value)");
    expect(filter).toContain("{check.error}");
  });

  it("a single day is the same date twice", () => {
    const r = quickPickRange("today", THU);
    expect(r.start).toBe(r.end);
  });
});
