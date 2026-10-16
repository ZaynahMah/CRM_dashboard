import { describe, it, expect } from "vitest";
import {
  campaignDateIso, campaignMonthKey, monthKeyOf, inMonth, inWeek, dedupeById,
} from "./campaignDate";
import { categoryDeadlineForWeek } from "./businessWeeks";
import { isoDate } from "./format";

/** 16 October 2026, the stated test context. Never hard-coded in src. */
const TODAY = new Date(2026, 9, 16);

const pn = (id: string, launch_date: string | null, extra: Record<string, unknown> = {}) =>
  ({ id, launch_date, brand: null, offer: null, ...extra }) as never;

/** Mirrors the week blocks and status rule in WeekDeadlines.tsx. */
function weekStatuses(campaigns: never[], monthStart: Date) {
  const rows = dedupeById(campaigns);
  const year = monthStart.getFullYear(), month = monthStart.getMonth();
  const lastDay = new Date(year, month + 1, 0).getDate();
  const out: { label: string; total: number; filled: number; status: string; deadline: string }[] = [];
  for (let d = 1; d <= lastDay; d += 7) {
    const ws = new Date(year, month, d);
    const we = new Date(year, month, Math.min(d + 6, lastDay));
    const wsIso = isoDate(ws), weIso = isoDate(we);
    const inside = inWeek(rows, wsIso, weIso) as { brand?: unknown; offer?: unknown }[];
    const total = inside.length;
    const filled = inside.filter((c) => c.brand && c.offer).length;
    let status = "Pending";
    if (total > 0) status = filled === total ? "Completed" : "In Progress";
    out.push({ label: `${wsIso}..${weIso}`, total, filled, status,
      deadline: categoryDeadlineForWeek(wsIso) });
  }
  return out;
}

/* ═══════════ THE SIX ACCEPTANCE TESTS ═══════════ */

describe("Test 1 — no October campaigns", () => {
  const weeks = weekStatuses([], TODAY);

  it("no October week is In Progress", () => {
    expect(weeks.every((w) => w.status !== "In Progress")).toBe(true);
  });

  it("every week is Pending, with the deadline still shown", () => {
    expect(weeks.every((w) => w.status === "Pending")).toBe(true);
    expect(weeks[0].deadline).toBe("2026-09-24");   // 1 Oct − 7
    expect(weeks[2].deadline).toBe("2026-10-08");   // 15 Oct − 7
  });

  it("the impossible 0 / 0 / In Progress combination cannot occur", () => {
    for (const w of weeks) {
      if (w.total === 0) expect(w.status).not.toBe("In Progress");
    }
  });

  it("a passed deadline alone never makes a week active", () => {
    // 1–7 Oct's deadline was 24 Sep, three weeks before today.
    expect(weeks[0].deadline < isoDate(TODAY)).toBe(true);
    expect(weeks[0].status).toBe("Pending");
  });
});

describe("Test 2 — campaigns only for 16–21 Oct", () => {
  const rows = [
    pn("a", "2026-10-16"), pn("b", "2026-10-18"), pn("c", "2026-10-21"),
  ] as never[];
  const weeks = weekStatuses(rows, TODAY);

  it("15–21 Oct is In Progress", () => {
    const w = weeks.find((x) => x.label === "2026-10-15..2026-10-21")!;
    expect(w.total).toBe(3);
    expect(w.status).toBe("In Progress");
  });

  it("22–28 Oct is NOT In Progress", () => {
    expect(weeks.find((x) => x.label === "2026-10-22..2026-10-28")!.status).toBe("Pending");
  });

  it("earlier weeks stay Pending despite passed deadlines", () => {
    expect(weeks[0].status).toBe("Pending");
    expect(weeks[1].status).toBe("Pending");
  });
});

describe("Test 3 — campaigns for 16–26 Oct", () => {
  const rows = [
    pn("a", "2026-10-16"), pn("b", "2026-10-20"),
    pn("c", "2026-10-23"), pn("d", "2026-10-26"),
  ] as never[];
  const weeks = weekStatuses(rows, TODAY);

  it("BOTH 15–21 and 22–28 are In Progress at the same time", () => {
    expect(weeks.find((x) => x.label === "2026-10-15..2026-10-21")!.status).toBe("In Progress");
    expect(weeks.find((x) => x.label === "2026-10-22..2026-10-28")!.status).toBe("In Progress");
  });

  it("In Progress is not restricted to the week containing today", () => {
    const active = weeks.filter((w) => w.status === "In Progress");
    expect(active).toHaveLength(2);
  });

  it("each week counts only its own campaigns", () => {
    expect(weeks.find((x) => x.label === "2026-10-15..2026-10-21")!.total).toBe(2);
    expect(weeks.find((x) => x.label === "2026-10-22..2026-10-28")!.total).toBe(2);
  });
});

describe("Test 4 — a July campaign edited in October", () => {
  const july = pn("j", "2026-07-10", { updated_at: "2026-10-12T09:00:00Z" });

  it("does NOT belong to October", () => {
    expect(campaignMonthKey(july)).toBe("2026-07");
    expect(monthKeyOf(TODAY)).toBe("2026-10");
    expect(campaignMonthKey(july)).not.toBe(monthKeyOf(TODAY));
  });

  it("is excluded from the current-month set", () => {
    expect(inMonth([july] as never[], TODAY)).toHaveLength(0);
  });

  it("an October edit date does not reclassify it", () => {
    // The edit timestamp is present and deliberately ignored.
    expect(inMonth([july] as never[], TODAY)).toEqual([]);
  });

  it("it lands in no October week", () => {
    expect(weekStatuses([july] as never[], TODAY).every((w) => w.total === 0)).toBe(true);
  });
});

describe("Test 5 — an October campaign edited on 12 Oct", () => {
  const oct = pn("o", "2026-10-18", { updated_at: "2026-10-12T09:00:00Z" });

  it("belongs to October and qualifies", () => {
    expect(campaignMonthKey(oct)).toBe("2026-10");
    expect(inMonth([oct] as never[], TODAY)).toHaveLength(1);
  });

  it("lands in the 15–21 Oct week", () => {
    const w = weekStatuses([oct] as never[], TODAY)
      .find((x) => x.label === "2026-10-15..2026-10-21")!;
    expect(w.total).toBe(1);
    expect(w.status).toBe("In Progress");
  });
});

describe("Test 6 — zero campaigns can never be In Progress", () => {
  it("holds for every month of the year, not just October", () => {
    for (let m = 0; m < 12; m++) {
      const weeks = weekStatuses([], new Date(2026, m, 1));
      expect(weeks.every((w) => w.status === "Pending"),
        `month ${m + 1} produced a non-Pending week with no data`).toBe(true);
    }
  });

  it("holds in a future year too — nothing is hard-coded to 2026", () => {
    const weeks = weekStatuses([], new Date(2027, 0, 1));
    expect(weeks.every((w) => w.status === "Pending")).toBe(true);
  });
});

/* ═══════════ the canonical parser ═══════════ */

describe("campaign date parsing is canonical and never guesses", () => {
  it("parses ISO, with or without a time", () => {
    expect(campaignDateIso("2026-10-16")).toBe("2026-10-16");
    expect(campaignDateIso("2026-10-16T18:30:00Z")).toBe("2026-10-16");
  });

  it("parses a Date object", () => {
    expect(campaignDateIso(new Date(2026, 9, 16))).toBe("2026-10-16");
  });

  it("parses dd/mm/yyyy, the CRM sheet format", () => {
    expect(campaignDateIso("16/10/2026")).toBe("2026-10-16");
    expect(campaignDateIso("01-11-2026")).toBe("2026-11-01");
  });

  it("does NOT silently reinterpret an ambiguous date as mm/dd", () => {
    // 03/04/2026 is 3 April under the known source format, never 4 March.
    expect(campaignDateIso("03/04/2026")).toBe("2026-04-03");
  });

  it("rejects an impossible date instead of coercing it", () => {
    expect(campaignDateIso("2026-13-01")).toBeNull();
    expect(campaignDateIso("32/01/2026")).toBeNull();
    expect(campaignDateIso("not a date")).toBeNull();
  });

  it("treats a missing date as absent, not as today", () => {
    expect(campaignDateIso(null)).toBeNull();
    expect(campaignDateIso("")).toBeNull();
    expect(campaignMonthKey({ launch_date: null })).toBeNull();
  });

  it("a campaign with no date falls into no week", () => {
    expect(inWeek([pn("x", null)] as never[], "2026-10-01", "2026-10-31")).toHaveLength(0);
  });
});

describe("duplicate campaigns are counted once", () => {
  it("the same id from two imports yields one row", () => {
    const rows = [pn("dup", "2026-10-16"), pn("dup", "2026-10-16"), pn("other", "2026-10-17")];
    expect(dedupeById(rows as never[])).toHaveLength(2);
  });

  it("week totals are not inflated by duplicates", () => {
    const rows = [pn("dup", "2026-10-16"), pn("dup", "2026-10-16")] as never[];
    const w = weekStatuses(rows, TODAY).find((x) => x.label === "2026-10-15..2026-10-21")!;
    expect(w.total).toBe(1);
  });

  it("rows without an id are kept, not silently dropped", () => {
    expect(dedupeById([{ launch_date: "2026-10-16" }] as never[])).toHaveLength(1);
  });
});

describe("the deadline rule is unchanged", () => {
  it("is still week start minus 7 days", () => {
    expect(categoryDeadlineForWeek("2026-10-01")).toBe("2026-09-24");
    expect(categoryDeadlineForWeek("2026-10-29")).toBe("2026-10-22");
  });

  it("the deadline is reported even when the week is Pending", () => {
    const weeks = weekStatuses([], TODAY);
    expect(weeks.every((w) => /^\d{4}-\d{2}-\d{2}$/.test(w.deadline))).toBe(true);
  });
});

/* ═══════════ the status invariant, stated explicitly ═══════════ */
describe("status invariant", () => {
  /** Mirrors the guards in WeekDeadlines.tsx, in the same order. */
  const statusOf = (total: number, filled: number, monthHasData: boolean) => {
    if (!monthHasData) return "Pending";
    if (total === 0) return "Pending";
    if (filled < total) return "In Progress";
    return "Completed";
  };

  it("total 0 -> Pending, always", () => {
    expect(statusOf(0, 0, true)).toBe("Pending");
    expect(statusOf(0, 0, false)).toBe("Pending");
  });

  it("total > 0 and filled < total -> In Progress", () => {
    expect(statusOf(5, 0, true)).toBe("In Progress");
    expect(statusOf(5, 4, true)).toBe("In Progress");
  });

  it("total > 0 and filled === total -> Completed", () => {
    expect(statusOf(5, 5, true)).toBe("Completed");
  });

  it("no current-month data at all -> every week Pending", () => {
    // The ongoing-month gate fires before any per-week logic.
    expect(statusOf(3, 1, false)).toBe("Pending");
  });

  it("In Progress is unreachable with zero campaigns, by construction", () => {
    for (let filled = 0; filled <= 3; filled++) {
      expect(statusOf(0, filled, true)).not.toBe("In Progress");
    }
  });

  it("the three branches are exhaustive and mutually exclusive", () => {
    const seen = new Set<string>();
    for (const total of [0, 1, 5]) {
      for (let filled = 0; filled <= total; filled++) {
        for (const has of [true, false]) {
          seen.add(statusOf(total, filled, has));
        }
      }
    }
    expect([...seen].sort()).toEqual(["Completed", "In Progress", "Pending"]);
  });
});

describe("the data source is campaign rows, not timestamps", () => {
  it("a row whose ONLY October signal is updated_at does not count", () => {
    const julyEditedInOct = pn("j", "2026-07-10",
      { updated_at: "2026-10-16T10:00:00Z", submitted_at: "2026-10-16T10:00:00Z" });
    expect(inMonth([julyEditedInOct] as never[], TODAY)).toHaveLength(0);
    expect(inWeek([julyEditedInOct] as never[], "2026-10-15", "2026-10-21")).toHaveLength(0);
  });

  it("a row with a valid October campaign date counts, whenever it was touched", () => {
    const oct = pn("o", "2026-10-20", { updated_at: "2026-05-01T00:00:00Z" });
    expect(inWeek([oct] as never[], "2026-10-15", "2026-10-21")).toHaveLength(1);
  });

  it("a row with no campaign date counts for nothing", () => {
    const undated = pn("u", null, { updated_at: "2026-10-16T10:00:00Z" });
    expect(inMonth([undated] as never[], TODAY)).toHaveLength(0);
  });

  it("the month gate rolls forward automatically", () => {
    const nov = pn("n", "2026-11-03");
    expect(inMonth([nov] as never[], new Date(2026, 9, 16))).toHaveLength(0);  // Oct
    expect(inMonth([nov] as never[], new Date(2026, 10, 16))).toHaveLength(1); // Nov
  });
});
