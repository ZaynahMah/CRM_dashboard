import { describe, it, expect } from "vitest";
import {
  pnDeadlineDate, pnDeadlineInstant, timeLeftLabel, deadlinePassed,
  deadlineImminent, weekDeadlineRange,
} from "./deadlines";

/* ══ CHANGE 1: per PN, per day ══ */
describe("the deadline is the PN's own campaign date minus 7", () => {
  it.each([
    ["2026-11-01", "2026-10-25"],
    ["2026-11-02", "2026-10-26"],
    ["2026-11-03", "2026-10-27"],
    ["2026-11-04", "2026-10-28"],
  ])("%s is due %s", (launch, due) => {
    expect(pnDeadlineDate(launch)).toBe(due);
  });

  it("is per PN, NOT per week — four PNs in one week have four deadlines", () => {
    const week = ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"];
    const dues = week.map(pnDeadlineDate);
    expect(new Set(dues).size).toBe(4);
  });

  it("crosses a month and a year boundary", () => {
    expect(pnDeadlineDate("2026-01-03")).toBe("2025-12-27");
  });

  it("a PN with no date has no deadline", () => {
    expect(pnDeadlineDate(null)).toBeNull();
    expect(pnDeadlineDate("")).toBeNull();
  });
});

describe("the instant is 23:59 IST on the deadline date", () => {
  const due = pnDeadlineInstant("2026-11-01")!;

  it("is the end of 25 Oct in IST, not UTC midnight", () => {
    // 23:59:59.999 IST == 18:29:59.999 UTC the same day.
    expect(due.toISOString()).toBe("2026-10-25T18:29:59.999Z");
  });

  it("a PN is still open at 23:00 IST on its deadline day", () => {
    const at2300IST = new Date("2026-10-25T17:30:00.000Z");
    expect(deadlinePassed("2026-11-01", at2300IST)).toBe(false);
  });

  it("and defaulted just after midnight IST", () => {
    const at0001IST = new Date("2026-10-25T18:31:00.000Z");
    expect(deadlinePassed("2026-11-01", at0001IST)).toBe(true);
  });
});

describe("the countdown label", () => {
  it('reads "2d 5h left"', () => {
    // 2 days 5 hours before 25 Oct 23:59 IST.
    const now = new Date("2026-10-23T13:29:59.999Z");
    expect(timeLeftLabel("2026-11-01", now)).toBe("2d 5h left");
  });

  it("drops to hours inside a day", () => {
    // 10:29:59.999Z to 18:29:59.999Z is exactly 8 hours.
    const now = new Date("2026-10-25T10:29:59.999Z");
    expect(timeLeftLabel("2026-11-01", now)).toBe("8h left");
  });

  it("drops to minutes in the last hour", () => {
    const now = new Date("2026-10-25T18:00:00.000Z");
    expect(timeLeftLabel("2026-11-01", now)).toMatch(/^\d+m left$/);
  });

  it("reads overdue once passed", () => {
    expect(timeLeftLabel("2026-11-01", new Date("2026-10-26T00:00:00Z"))).toBe("overdue");
  });

  it("under 24h is the amber state, over 24h is not", () => {
    expect(deadlineImminent("2026-11-01", new Date("2026-10-25T10:00:00Z"))).toBe(true);
    expect(deadlineImminent("2026-11-01", new Date("2026-10-23T10:00:00Z"))).toBe(false);
    // Already passed is not "imminent", it is defaulted.
    expect(deadlineImminent("2026-11-01", new Date("2026-10-27T10:00:00Z"))).toBe(false);
  });
});

describe("week ranges are derived from the PN deadlines", () => {
  it("1–7 Nov yields 25 Oct – 31 Oct", () => {
    const week = ["2026-11-01", "2026-11-03", "2026-11-07"];
    expect(weekDeadlineRange(week)).toEqual({ first: "2026-10-25", last: "2026-10-31" });
  });

  it("an empty week has no range", () => {
    expect(weekDeadlineRange([])).toBeNull();
    expect(weekDeadlineRange([null, undefined])).toBeNull();
  });
});
