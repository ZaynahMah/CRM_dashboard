import { describe, it, expect } from "vitest";
import {
  businessWeekOf, categoryDeadlineForWeek, slaStatus, daysPastDeadline,
  crmMayFill, SLA_LABEL, type SlaStatus,
} from "./businessWeeks";
import { toDate } from "./format";

describe("business week buckets (1-7, 8-14, 15-21, 22-28, 29-end)", () => {
  it.each([
    ["2026-11-01", 1, "2026-11-01", "2026-11-07"],
    ["2026-11-07", 1, "2026-11-01", "2026-11-07"],
    ["2026-11-08", 2, "2026-11-08", "2026-11-14"],
    ["2026-11-14", 2, "2026-11-08", "2026-11-14"],
    ["2026-11-15", 3, "2026-11-15", "2026-11-21"],
    ["2026-11-22", 4, "2026-11-22", "2026-11-28"],
    ["2026-11-29", 5, "2026-11-29", "2026-11-30"],
    ["2026-11-30", 5, "2026-11-29", "2026-11-30"],
  ])("%s -> W%i (%s..%s)", (d, idx, start, end) => {
    const w = businessWeekOf(d as string);
    expect(w.index).toBe(idx);
    expect(w.start).toBe(start);
    expect(w.end).toBe(end);
  });

  it("is NOT Monday-Sunday: 1 Nov 2026 is a Sunday yet starts W1", () => {
    expect(toDate("2026-11-01").getDay()).toBe(0);      // Sunday
    expect(businessWeekOf("2026-11-01").start).toBe("2026-11-01");
  });

  it("W5 runs to the end of the month, however long that is", () => {
    expect(businessWeekOf("2026-02-28").end).toBe("2026-02-28");   // 28-day Feb
    expect(businessWeekOf("2026-01-31").end).toBe("2026-01-31");   // 31-day Jan
    expect(businessWeekOf("2026-04-30").end).toBe("2026-04-30");   // 30-day Apr
  });

  it("every day of a month lands in exactly one bucket", () => {
    const seen = new Set<string>();
    for (let d = 1; d <= 31; d++) {
      const iso = `2026-07-${String(d).padStart(2, "0")}`;
      const w = businessWeekOf(iso);
      expect(iso >= w.start && iso <= w.end).toBe(true);
      seen.add(w.key);
    }
    expect(seen.size).toBe(5);
  });

  it("week keys are stable and sortable", () => {
    expect(businessWeekOf("2026-11-03").key).toBe("2026-11-W1");
    expect(businessWeekOf("2026-11-30").key).toBe("2026-11-W5");
  });
});

describe("the one deadline rule: week start - 7", () => {
  it("reproduces the business example: 1 Nov - 7 Nov -> 25 Oct", () => {
    const w = businessWeekOf("2026-11-01");
    expect(w.deadline).toBe("2026-10-25");
  });

  it("every campaign in the week inherits the SAME deadline", () => {
    for (const d of ["2026-11-01", "2026-11-03", "2026-11-07"]) {
      expect(businessWeekOf(d).deadline).toBe("2026-10-25");
    }
  });

  it("crosses a month boundary correctly", () => {
    expect(categoryDeadlineForWeek("2026-11-01")).toBe("2026-10-25");
    expect(categoryDeadlineForWeek("2026-01-01")).toBe("2025-12-25");
  });

  it("is 7 days, never 9 — the old buffer is gone", () => {
    const w = businessWeekOf("2026-11-08");
    expect(w.deadline).toBe("2026-11-01");
    expect(w.deadline).not.toBe("2026-10-30");
  });
});

describe("SLA progression: 0 overdue, 1 reminder, 2 escalation, 3 defaulted", () => {
  const deadline = "2026-10-25";
  const at = (iso: string) => toDate(iso);

  it.each([
    ["2026-10-20", "ON_TRACK"],
    ["2026-10-22", "DUE_SOON"],
    ["2026-10-24", "DUE_SOON"],
    ["2026-10-25", "OVERDUE"],      // day 0 — the deadline day has passed
    ["2026-10-26", "REMINDER"],
    ["2026-10-27", "ESCALATION"],
    ["2026-10-28", "DEFAULTED"],
    ["2026-11-05", "DEFAULTED"],
  ])("as of %s -> %s", (asOf, expected) => {
    expect(slaStatus({ deadline, submitted: false }, at(asOf as string))).toBe(expected);
  });

  it("is NOT defaulted the moment the deadline passes", () => {
    expect(slaStatus({ deadline, submitted: false }, at("2026-10-25"))).not.toBe("DEFAULTED");
    expect(slaStatus({ deadline, submitted: false }, at("2026-10-26"))).not.toBe("DEFAULTED");
    expect(slaStatus({ deadline, submitted: false }, at("2026-10-27"))).not.toBe("DEFAULTED");
  });

  it("submitting before the deadline is on time", () => {
    expect(slaStatus({ deadline, submitted: true, submittedOn: "2026-10-22" }, at("2026-11-01")))
      .toBe("SUBMITTED_ON_TIME");
  });

  it("submitting EXACTLY on the deadline is on time", () => {
    expect(slaStatus({ deadline, submitted: true, submittedOn: "2026-10-25" }, at("2026-11-01")))
      .toBe("SUBMITTED_ON_TIME");
  });

  it("a CRM override is the end state and outranks everything", () => {
    expect(slaStatus({ deadline, submitted: false, crmFilled: true }, at("2026-11-05")))
      .toBe("CRM_FILLED_AFTER_DEFAULT");
    expect(slaStatus({ deadline, submitted: true, crmFilled: true }, at("2026-11-05")))
      .toBe("CRM_FILLED_AFTER_DEFAULT");
  });

  it("CRM may fill only once defaulted", () => {
    const s = (asOf: string) => slaStatus({ deadline, submitted: false }, at(asOf));
    expect(crmMayFill(s("2026-10-25"))).toBe(false);   // overdue
    expect(crmMayFill(s("2026-10-27"))).toBe(false);   // escalation
    expect(crmMayFill(s("2026-10-28"))).toBe(true);    // defaulted
  });

  it("day counting is exact", () => {
    expect(daysPastDeadline(deadline, at("2026-10-25"))).toBe(0);
    expect(daysPastDeadline(deadline, at("2026-10-28"))).toBe(3);
    expect(daysPastDeadline(deadline, at("2026-10-24"))).toBe(-1);
  });

  it("every status has a label", () => {
    const all: SlaStatus[] = ["SUBMITTED_ON_TIME","DUE_SOON","ON_TRACK","OVERDUE",
      "REMINDER","ESCALATION","DEFAULTED","CRM_FILLED_AFTER_DEFAULT"];
    for (const s of all) expect(SLA_LABEL[s]).toBeTruthy();
  });
});
