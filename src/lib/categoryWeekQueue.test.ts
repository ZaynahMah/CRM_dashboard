import { describe, it, expect } from "vitest";
import { businessWeekOf } from "./businessWeeks";
import { campaignDateIso } from "./campaignDate";
import type { Campaign } from "@/types/campaign";

/**
 * The Category week-wise incoming queue.
 *
 * Mirrors the grouping in RoleQueue.tsx. The handoff, pending and submitted
 * rules are the PRE-EXISTING ones, reused unchanged:
 *   handoff   : !is_crm_self && crm_status !== "NOT_STARTED"
 *   pending   : category_status !== "LOCKED"
 *   submitted : category_status === "LOCKED"
 */

const pn = (o: Partial<Campaign>) => ({
  id: String(o.id ?? "x"), campaign_name: `PN ${o.id ?? "x"}`,
  is_crm_self: false, crm_status: "AWAITING_REVIEW",
  category_status: "EMPTY", launch_date: "2026-10-03",
  ...o,
}) as Campaign;

/** The handoff filter, exactly as RoleQueue applies it. */
const mine = (rows: Campaign[]) =>
  rows.filter((c) => !c.is_crm_self && c.crm_status !== "NOT_STARTED");

function weekSections(all: Campaign[]) {
  const rows = mine(all);
  const byWeek = new Map<string, { label: string; start: string; rows: Campaign[] }>();
  for (const c of rows) {
    const iso = campaignDateIso(c.launch_date);
    if (!iso) continue;
    const w = businessWeekOf(iso);
    if (!byWeek.has(w.key)) byWeek.set(w.key, { label: w.label, start: w.start, rows: [] });
    byWeek.get(w.key)!.rows.push(c);
  }
  return [...byWeek.entries()]
    .sort((a, b) => a[1].start.localeCompare(b[1].start))
    .map(([key, w]) => ({
      key, label: w.label, all: w.rows,
      pending: w.rows.filter((c) => c.category_status !== "LOCKED"),
      submitted: w.rows.filter((c) => c.category_status === "LOCKED"),
    }));
}

describe("weeks are the October calendar buckets", () => {
  const rows = [
    pn({ id: "a", launch_date: "2026-10-03" }),
    pn({ id: "b", launch_date: "2026-10-12" }),
    pn({ id: "c", launch_date: "2026-10-18" }),
    pn({ id: "d", launch_date: "2026-10-25" }),
    pn({ id: "e", launch_date: "2026-10-30" }),
  ];
  const w = weekSections(rows);

  it("produces the five October sections, in order", () => {
    expect(w.map((x) => x.label)).toEqual([
      "1 Oct – 7 Oct", "8 Oct – 14 Oct", "15 Oct – 21 Oct",
      "22 Oct – 28 Oct", "29 Oct – 31 Oct",
    ]);
  });

  it("each PN lands in exactly one week", () => {
    expect(w.flatMap((x) => x.all).map((c) => c.id).sort())
      .toEqual(["a", "b", "c", "d", "e"]);
    expect(w.every((x) => x.all.length === 1)).toBe(true);
  });

  it("only weeks with PNs are shown", () => {
    expect(weekSections([pn({ id: "only", launch_date: "2026-10-18" })]))
      .toHaveLength(1);
  });
});

describe("the week comes from the CAMPAIGN date, not the handoff date", () => {
  it("sent 1 Oct, scheduled 12 Oct -> appears under 8–14 October", () => {
    const sentEarly = pn({
      id: "late", launch_date: "2026-10-12",
      created_at: "2026-10-01T09:00:00Z",
      updated_at: "2026-10-01T09:00:00Z",
      submitted_at: "2026-10-01T09:00:00Z",
    } as Partial<Campaign>);
    const w = weekSections([sentEarly]);
    expect(w).toHaveLength(1);
    expect(w[0].label).toBe("8 Oct – 14 Oct");
  });

  it("several future weeks sent together distribute immediately", () => {
    const batch = [
      pn({ id: "w1", launch_date: "2026-10-05" }),
      pn({ id: "w2", launch_date: "2026-10-13" }),
      pn({ id: "w3", launch_date: "2026-10-20" }),
    ].map((c) => ({ ...c, created_at: "2026-10-01T09:00:00Z" } as Campaign));
    expect(weekSections(batch).map((x) => x.label)).toEqual([
      "1 Oct – 7 Oct", "8 Oct – 14 Oct", "15 Oct – 21 Oct",
    ]);
  });

  it("rolls into the next month without a change", () => {
    const nov = weekSections([pn({ id: "n", launch_date: "2026-11-03" })]);
    expect(nov[0].label).toBe("1 Nov – 7 Nov");
  });
});

describe("the existing status rules are reused unchanged", () => {
  const rows = [
    pn({ id: "p1", launch_date: "2026-10-03", category_status: "EMPTY" }),
    pn({ id: "p2", launch_date: "2026-10-03", category_status: "DRAFT" }),
    pn({ id: "s1", launch_date: "2026-10-03", category_status: "LOCKED" }),
  ];
  const [week] = weekSections(rows);

  it("All PN = pending + submitted", () => {
    expect(week.all).toHaveLength(3);
    expect(week.pending.length + week.submitted.length).toBe(week.all.length);
  });

  it("Pending your input is category_status !== LOCKED", () => {
    expect(week.pending.map((c) => c.id).sort()).toEqual(["p1", "p2"]);
  });

  it("Submitted to CRM is category_status === LOCKED", () => {
    expect(week.submitted.map((c) => c.id)).toEqual(["s1"]);
  });

  it("the counts are per week, not global", () => {
    const two = weekSections([
      ...rows,
      pn({ id: "other", launch_date: "2026-10-20", category_status: "LOCKED" }),
    ]);
    expect(two[0].all).toHaveLength(3);
    expect(two[1].all).toHaveLength(1);
    expect(two[1].submitted).toHaveLength(1);
  });
});

describe("CRM Self and unreleased PNs are excluded", () => {
  it("CRM Self never appears — Category owes no input", () => {
    expect(weekSections([pn({ id: "self", is_crm_self: true })])).toHaveLength(0);
  });

  it("a PN CRM has not released does not appear", () => {
    expect(weekSections([pn({ id: "ns", crm_status: "NOT_STARTED" })])).toHaveLength(0);
  });

  it("a mixed set keeps only Category's own work", () => {
    const w = weekSections([
      pn({ id: "keep", launch_date: "2026-10-03" }),
      pn({ id: "self", launch_date: "2026-10-03", is_crm_self: true }),
      pn({ id: "ns", launch_date: "2026-10-03", crm_status: "NOT_STARTED" }),
    ]);
    expect(w[0].all.map((c) => c.id)).toEqual(["keep"]);
  });
});

describe("no PN is silently lost", () => {
  it("a PN with no campaign date is not placed in a week", () => {
    expect(weekSections([pn({ id: "u", launch_date: null as never })])).toHaveLength(0);
  });

  it("but it is still identifiable, so the UI can surface it separately", () => {
    const rows = [pn({ id: "u", launch_date: null as never })];
    const undated = mine(rows).filter((c) => !campaignDateIso(c.launch_date));
    expect(undated).toHaveLength(1);
  });

  it("every released, dated, non-self PN appears in exactly one section", () => {
    const rows = Array.from({ length: 40 }, (_, i) =>
      pn({ id: `r${i}`, launch_date: `2026-10-${String((i % 28) + 1).padStart(2, "0")}` }));
    const placed = weekSections(rows).flatMap((w) => w.all.map((c) => c.id));
    expect(new Set(placed).size).toBe(40);
  });
});
