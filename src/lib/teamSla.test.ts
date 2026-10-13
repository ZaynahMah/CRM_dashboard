import { describe, it, expect } from "vitest";
import {
  healthOf, healthSummary, requiresAttention, deadlineCalendar,
  accountabilityRows, missingInputs, defaultPercent, deadlineText,
  completionPercent, HEALTH_LABEL, HEALTH_URGENCY, type SlaRowLike,
} from "./teamSla";
import { slaStatus, daysPastDeadline } from "./businessWeeks";
import { toDate } from "./format";

const row = (o: Partial<SlaRowLike> = {}): SlaRowLike => ({
  id: "r", category: "Beauty", week_key: "2026-10-W3",
  week_start: "2026-10-15", week_end: "2026-10-21", deadline: "2026-10-08",
  pn_count: 20, submitted_count: 20, status: "SUBMITTED_ON_TIME", ...o,
});
const at = (iso: string) => toDate(iso);

/* ═══ the existing calculations must not change ═══ */
describe("existing SLA calculations are untouched", () => {
  it("the escalation ladder still returns the stored statuses", () => {
    const d = "2026-10-25";
    expect(slaStatus({ deadline: d, submitted: false }, at("2026-10-25"))).toBe("OVERDUE");
    expect(slaStatus({ deadline: d, submitted: false }, at("2026-10-26"))).toBe("REMINDER");
    expect(slaStatus({ deadline: d, submitted: false }, at("2026-10-27"))).toBe("ESCALATION");
    expect(slaStatus({ deadline: d, submitted: false }, at("2026-10-28"))).toBe("DEFAULTED");
  });

  it("day counting is the same function, not a new one", () => {
    expect(daysPastDeadline("2026-10-25", at("2026-10-28"))).toBe(3);
  });
});

/* ═══ Card 1 ═══ */
describe("health summary", () => {
  const rows = [
    row({ id: "1", status: "SUBMITTED_ON_TIME" }),
    row({ id: "2", status: "ON_TRACK", deadline: "2026-11-30", submitted_count: 0 }),
    row({ id: "3", status: "DUE_SOON", deadline: "2026-10-10", submitted_count: 5 }),
    row({ id: "4", status: "OVERDUE", deadline: "2026-10-08", submitted_count: 5 }),
    row({ id: "5", status: "REMINDER", deadline: "2026-10-07", submitted_count: 5 }),
    row({ id: "6", status: "DEFAULTED", deadline: "2026-10-01", submitted_count: 0 }),
  ];
  const s = healthSummary(rows, at("2026-10-08"));

  it("counts every bucket and totals correctly", () => {
    expect(s.total).toBe(6);
    expect(s.completed).toBe(1);
    expect(s.defaulted).toBe(1);
    expect(s.on_track + s.due_soon + s.due_today + s.overdue
      + s.defaulted + s.completed).toBe(s.total);
  });

  it("day 0 reads as Due Today, not Overdue", () => {
    expect(healthOf(row({ status: "OVERDUE", deadline: "2026-10-08" }), at("2026-10-08")))
      .toBe("DUE_TODAY");
  });

  it("a genuinely passed deadline reads as Overdue", () => {
    expect(healthOf(row({ status: "REMINDER", deadline: "2026-10-07" }), at("2026-10-08")))
      .toBe("OVERDUE");
    expect(healthOf(row({ status: "ESCALATION", deadline: "2026-10-06" }), at("2026-10-08")))
      .toBe("OVERDUE");
  });

  it("a CRM-filled default still counts as defaulted", () => {
    expect(healthOf(row({ status: "CRM_FILLED_AFTER_DEFAULT" }), at("2026-10-08")))
      .toBe("DEFAULTED");
  });

  it("every status has a label and an urgency", () => {
    for (const h of Object.keys(HEALTH_LABEL) as (keyof typeof HEALTH_LABEL)[]) {
      expect(HEALTH_LABEL[h]).toBeTruthy();
      expect(typeof HEALTH_URGENCY[h]).toBe("number");
    }
  });

  it("an empty dataset reports all zeros", () => {
    const e = healthSummary([], at("2026-10-08"));
    expect(e.total).toBe(0);
    expect(e.overdue).toBe(0);
  });
});

/* ═══ Card 2 ═══ */
describe("requires attention", () => {
  const rows = [
    row({ id: "ok", category: "Done", status: "SUBMITTED_ON_TIME" }),
    row({ id: "future", category: "Later", status: "ON_TRACK",
          deadline: "2026-12-01", submitted_count: 0 }),
    row({ id: "beauty", category: "Beauty", status: "OVERDUE",
          deadline: "2026-10-09", pn_count: 20, submitted_count: 12 }),
    row({ id: "kids", category: "Kids", status: "DEFAULTED",
          deadline: "2026-10-05", pn_count: 30, submitted_count: 16 }),
  ];
  const list = requiresAttention(rows, at("2026-10-08"));

  it("excludes completed and on-track weeks", () => {
    expect(list.map((i) => i.row.id)).not.toContain("ok");
    expect(list.map((i) => i.row.id)).not.toContain("future");
  });

  it("sorts most urgent first: defaulted before overdue", () => {
    expect(list[0].row.category).toBe("Kids");
    expect(list[1].row.category).toBe("Beauty");
  });

  it("reports the missing count, not the total", () => {
    expect(list.find((i) => i.row.category === "Kids")!.missing).toBe(14);
    expect(list.find((i) => i.row.category === "Beauty")!.missing).toBe(8);
  });

  it("describes the deadline in words CRM can act on", () => {
    expect(deadlineText("2026-10-08", at("2026-10-08"))).toBe("Deadline today");
    expect(deadlineText("2026-10-09", at("2026-10-08"))).toBe("Tomorrow");
    expect(deadlineText("2026-10-13", at("2026-10-08"))).toBe("In 5 days");
    expect(deadlineText("2026-10-07", at("2026-10-08"))).toBe("Deadline passed yesterday");
    expect(deadlineText("2026-10-05", at("2026-10-08"))).toBe("Deadline passed 3 days ago");
  });

  it("a week with nothing missing is not an action", () => {
    const full = [row({ status: "OVERDUE", pn_count: 10, submitted_count: 10 })];
    expect(requiresAttention(full, at("2026-10-08"))).toHaveLength(0);
  });
});

/* ═══ Card 3 ═══ */
describe("deadline calendar", () => {
  const rows = [
    row({ id: "a", category: "Beauty", status: "DUE_SOON", deadline: "2026-10-09", submitted_count: 0 }),
    row({ id: "b", category: "Men", status: "DUE_SOON", deadline: "2026-10-09", submitted_count: 0 }),
    row({ id: "c", category: "Luxury", status: "DUE_SOON", deadline: "2026-10-10", submitted_count: 0 }),
    row({ id: "d", category: "Kids", status: "ON_TRACK", deadline: "2026-10-13", submitted_count: 0 }),
    row({ id: "e", category: "Done", status: "SUBMITTED_ON_TIME", deadline: "2026-10-09" }),
    row({ id: "f", category: "Past", status: "REMINDER", deadline: "2026-10-01", submitted_count: 0 }),
  ];
  const cal = deadlineCalendar(rows, at("2026-10-08"));

  it("groups by when the deadline falls, soonest first", () => {
    expect(cal[0].label).toBe("Tomorrow");
    expect(cal[0].categories).toEqual(["Beauty", "Men"]);
    expect(cal[1].label).toBe("In 2 days");
    expect(cal[1].categories).toEqual(["Luxury"]);
    expect(cal[2].label).toBe("In 5 days");
    expect(cal[2].categories).toEqual(["Kids"]);
  });

  it("excludes completed weeks and past deadlines", () => {
    const all = cal.flatMap((g) => g.categories);
    expect(all).not.toContain("Done");
    expect(all).not.toContain("Past");
  });

  it("respects the horizon", () => {
    const far = [row({ category: "Far", status: "ON_TRACK", deadline: "2027-01-01", submitted_count: 0 })];
    expect(deadlineCalendar(far, at("2026-10-08"), 14)).toHaveLength(0);
  });
});

/* ═══ Card 4 + 6 ═══ */
describe("default tracker and accountability", () => {
  it("default % is missing over expected — the brief's examples", () => {
    expect(defaultPercent(row({ pn_count: 20, submitted_count: 18 }))).toBe(10);
    expect(defaultPercent(row({ pn_count: 30, submitted_count: 20 }))).toBe(33.3);
  });

  it("a complete week is 0% and a blank week is 100%", () => {
    expect(defaultPercent(row({ pn_count: 20, submitted_count: 20 }))).toBe(0);
    expect(defaultPercent(row({ pn_count: 20, submitted_count: 0 }))).toBe(100);
  });

  it("no divide-by-zero on an empty week", () => {
    expect(defaultPercent(row({ pn_count: 0, submitted_count: 0 }))).toBe(0);
    expect(completionPercent(row({ pn_count: 0 }))).toBe(0);
  });

  it("missing inputs never go negative", () => {
    expect(missingInputs(row({ pn_count: 5, submitted_count: 9 }))).toBe(0);
  });

  it("accountability rows carry every required column", () => {
    const [r] = accountabilityRows([row({ pn_count: 20, submitted_count: 12,
      status: "OVERDUE", deadline: "2026-10-07" })], at("2026-10-08"));
    expect(r.category).toBe("Beauty");
    expect(r.week).toBe("15 Oct – 21 Oct");
    expect(r.required).toBe(20);
    expect(r.submitted).toBe(12);
    expect(r.missing).toBe(8);
    expect(r.health).toBe("OVERDUE");
    expect(r.defaultPct).toBe(40);
  });

  it("accountability sorts the worst first", () => {
    const rows = accountabilityRows([
      row({ id: "1", category: "Good", status: "SUBMITTED_ON_TIME" }),
      row({ id: "2", category: "Bad", status: "DEFAULTED", submitted_count: 0 }),
    ], at("2026-10-08"));
    expect(rows[0].category).toBe("Bad");
  });

  it("completion percent drives the progress bar", () => {
    expect(completionPercent(row({ pn_count: 20, submitted_count: 18 }))).toBe(90);
  });
});

/* ═══ QC from the brief ═══ */
import { readFileSync } from "fs";
import { join } from "path";
import { canVisit } from "./accessPolicy";

describe("visibility: CRM and Executive only", () => {
  it.each(["CRM", "EXECUTIVE"] as const)("%s can reach /sla", (role) => {
    expect(canVisit(role, "/sla")).toBe(true);
  });

  it.each(["CATEGORY", "CONTENT"] as const)("%s CANNOT reach /sla", (role) => {
    expect(canVisit(role, "/sla")).toBe(false);
  });

  it("DESIGN cannot reach it either — the role no longer exists at all", () => {
    expect(canVisit("DESIGN" as never, "/sla")).toBe(false);
  });

  it("the nav entry is restricted to the same two roles", () => {
    const shell = readFileSync(join(__dirname, "../components/AppShell.tsx"), "utf8");
    const line = shell.split("\n").find((l) => l.includes('href:"/sla"'))!;
    expect(line).toContain('roles:["CRM","EXECUTIVE"]');
    expect(line).not.toContain("CATEGORY");
    expect(line).not.toContain("CONTENT");
  });

  it("middleware and the mirrored policy agree", () => {
    const mw = readFileSync(join(__dirname, "../middleware.ts"), "utf8");
    const slaLine = mw.split("\n").find((l) => l.includes('"/sla"'))!;
    expect(slaLine).toContain('["CRM", "EXECUTIVE"]');
  });
});

describe('no user-facing "Category SLA" remains', () => {
  const files = [
    "../components/AppShell.tsx",
    "../components/TeamSlaDashboard.tsx",
    "../components/CategorySlaTracker.tsx",
    "../components/CategorySlaStrip.tsx",
    "../components/ExecutiveSlaSummary.tsx",
    "../app/(app)/sla/page.tsx",
    "../services/categorySla.ts",
    "./businessWeeks.ts",
    "./teamSla.ts",
  ];

  it.each(files)("%s has no 'Category SLA' string", (f) => {
    const src = readFileSync(join(__dirname, f), "utf8");
    expect(src).not.toMatch(/Category SLA/);
  });

  it("the new name is used", () => {
    const shell = readFileSync(join(__dirname, "../components/AppShell.tsx"), "utf8");
    expect(shell).toContain("Team SLA & Accountability");
    const page = readFileSync(join(__dirname, "../app/(app)/sla/page.tsx"), "utf8");
    expect(page).toContain("Team SLA & Accountability");
  });
});

describe("all six cards are present", () => {
  const dash = readFileSync(join(__dirname, "../components/TeamSlaDashboard.tsx"), "utf8");
  const page = readFileSync(join(__dirname, "../app/(app)/sla/page.tsx"), "utf8");

  it.each([
    ["Team Health Summary", dash],
    ["Requires Attention", dash],
    ["Deadline Calendar", dash],
    ["Default Tracker", dash],
    ["Team Accountability", dash],
  ])("card: %s", (title, src) => expect(src).toContain(title));

  it("card 5: the activity feed is inside this experience, not a separate screen", () => {
    expect(page).toContain("ActivitiesPanel");
    expect(page).toContain("Activity Feed");
  });

  it("every KPI the brief listed is a card", () => {
    for (const k of ["Total Campaign Weeks", "On Track", "Due Soon",
                     "Due Today", "Overdue", "Defaulted", "Completed"]) {
      expect(dash).toContain(k);
    }
  });

  it("dashboard-first: progress bars and status chips, not only tables", () => {
    expect(dash).toContain("rounded-full");       // progress bars
    expect(dash).toContain("Pill");               // status chips
  });
});
