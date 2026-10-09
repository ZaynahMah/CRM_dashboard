import { describe, it, expect } from "vitest";
import { applyReset, previewReset, rowsToDelete } from "./uploadReset";
import type { Campaign } from "@/types/campaign";

const PN = (o: Record<string, unknown>) => ({
  id: String(o.id ?? "x"), is_crm_self: false, is_emergency: false,
  content_status: "NOT_ASSIGNED", calendar_status: "NOT_UPDATED",
  qc_status: "PENDING", ...o,
}) as unknown as Campaign;

/** One PN in every stage, both flows, plus an emergency. */
const everyStage: Campaign[] = [
  PN({ id: "cat",      content_status: "NOT_ASSIGNED" }),
  PN({ id: "content",  content_status: "PENDING" }),
  PN({ id: "changes",  content_status: "NEEDS_CHANGES" }),
  PN({ id: "qc",       content_status: "SUBMITTED" }),
  PN({ id: "calendar", content_status: "SUBMITTED", calendar_status: "UPDATED" }),
  PN({ id: "emerg",    is_emergency: true }),
  PN({ id: "self",     is_crm_self: true, content_status: "PENDING" }),
];
const newSheet = [PN({ id: "n1" }), PN({ id: "n2" })];

describe("preview counts every stage", () => {
  const p = previewReset(everyStage, 3);
  it("totals every PN regardless of status or flow", () => expect(p.total).toBe(7));
  it("breaks down by stage", () => {
    expect(p.at_category).toBe(2);   // cat + emerg
    expect(p.with_content).toBe(3);  // content + changes + self
    expect(p.in_qc).toBe(1);
    expect(p.on_calendar).toBe(1);
  });
  it("surfaces emergencies and change requests", () => {
    expect(p.emergencies).toBe(1);
    expect(p.change_requests).toBe(3);
  });
  it("the breakdown adds up to the total", () => {
    expect(p.at_category + p.with_content + p.in_qc + p.on_calendar).toBe(p.total);
  });
});

describe("reset deletes EVERYTHING", () => {
  it("targets every row, both flows, every status, including Calendar", () => {
    expect(rowsToDelete(everyStage)).toHaveLength(everyStage.length);
    expect(rowsToDelete(everyStage).some((c) => c.calendar_status === "UPDATED")).toBe(true);
    expect(rowsToDelete(everyStage).some((c) => c.is_crm_self)).toBe(true);
  });

  it("leaves only the new sheet behind — zero leftovers", () => {
    const r = applyReset({ role: "CRM", existing: everyStage, incoming: newSheet });
    expect(r.ok).toBe(true);
    expect(r.campaigns.map((c) => c.id)).toEqual(["n1", "n2"]);
    for (const old of everyStage) {
      expect(r.campaigns.find((c) => c.id === old.id)).toBeUndefined();
    }
  });

  it("every post-reset count is zero except the new rows", () => {
    const r = applyReset({ role: "CRM", existing: everyStage, incoming: newSheet });
    const p = previewReset(r.campaigns, 0);
    expect(p.on_calendar).toBe(0);
    expect(p.with_content).toBe(0);
    expect(p.in_qc).toBe(0);
    expect(p.emergencies).toBe(0);
    expect(p.change_requests).toBe(0);
    expect(p.total).toBe(2);
  });
});

describe("archive", () => {
  it("archives exactly as many rows as it deletes", () => {
    const r = applyReset({ role: "CRM", existing: everyStage, incoming: newSheet });
    expect(r.archive).toHaveLength(everyStage.length);
    expect(r.archive).toHaveLength(rowsToDelete(everyStage).length);
  });

  it("archives the calendar rows too, not just the drafts", () => {
    const r = applyReset({ role: "CRM", existing: everyStage, incoming: newSheet });
    expect(r.archive.find((c) => c.id === "calendar")).toBeDefined();
  });

  it("appends to earlier batches rather than replacing them", () => {
    const first = applyReset({ role: "CRM", existing: everyStage, incoming: newSheet });
    const second = applyReset({
      role: "CRM", existing: first.campaigns, incoming: [PN({ id: "n3" })],
      existingArchive: first.archive,
    });
    expect(second.archive).toHaveLength(everyStage.length + newSheet.length);
  });

  it("returns a batch id for recovery", () => {
    expect(applyReset({ role: "CRM", existing: everyStage, incoming: newSheet }).archiveBatchId)
      .toBeTruthy();
  });
});

describe("failure mid-transaction deletes nothing", () => {
  it.each(["archive", "delete", "insert"] as const)("failure at %s rolls back", (failAt) => {
    const r = applyReset({ role: "CRM", existing: everyStage, incoming: newSheet, failAt });
    expect(r.ok).toBe(false);
    // The dashboard is exactly as it was — no partial wipe.
    expect(r.campaigns).toEqual(everyStage);
    expect(r.campaigns).toHaveLength(7);
    expect(r.campaigns.find((c) => c.id === "calendar")).toBeDefined();
  });

  it("a failure leaves no half-written archive", () => {
    const r = applyReset({ role: "CRM", existing: everyStage, incoming: newSheet, failAt: "archive" });
    expect(r.archive).toEqual([]);
  });

  it("an empty sheet is refused and changes nothing", () => {
    const r = applyReset({ role: "CRM", existing: everyStage, incoming: [] });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("no rows");
    expect(r.campaigns).toEqual(everyStage);
  });
});

describe("only CRM may reset", () => {
  it.each(["CATEGORY", "CONTENT", "EXECUTIVE"] as const)("%s is rejected", (role) => {
    const r = applyReset({ role, existing: everyStage, incoming: newSheet });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("Only CRM");
  });

  it("a rejected call deletes nothing and archives nothing", () => {
    const r = applyReset({ role: "CONTENT", existing: everyStage, incoming: newSheet });
    expect(r.campaigns).toEqual(everyStage);
    expect(r.archive).toEqual([]);
  });

  it("CRM is allowed", () => {
    expect(applyReset({ role: "CRM", existing: everyStage, incoming: newSheet }).ok).toBe(true);
  });
});
