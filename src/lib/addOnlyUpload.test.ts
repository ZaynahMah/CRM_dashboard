import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { buildUploadPlan, rowsToInsert } from "@/services/uploadBatch";
import { BULK_FILL_KEYS } from "./pnDropdowns";
import type { Campaign } from "@/types/campaign";

const read = (p: string) => readFileSync(join(__dirname, p), "utf8");
const up = read("../components/CrmInputUpload.tsx");

const row = (o: Record<string, unknown> = {}) => ({
  launch_date: "2026-11-15", launch_time: "19:30:00", slot_label: "3",
  pncc_segment_label: "Push_Women", category: "Westside", ...o,
});
const existing = (o: Record<string, unknown> = {}) =>
  ({ ...row(), id: "e1", ...o }) as unknown as Campaign;

/* ══════════ the reset screen is gone ══════════ */
describe("an upload never offers a reset", () => {
  it("the confirm step goes straight to the add-only send", () => {
    expect(up).toContain("if (BATCH_UPLOAD_ENABLED) {\n      await handleConfirmReplace();");
  });

  it("upload_reset_preview is unreachable by default", () => {
    // It survives only inside the opt-in legacy branch, after the early return.
    expect(up.indexOf("await handleConfirmReplace();"))
      .toBeLessThan(up.indexOf('"upload_reset_preview"'));
  });

  it("the confirm button states the number added, with no RESET step", () => {
    expect(up).toContain("`Add ${uploadPlan?.toAdd ?? parsed.length} new PNs`");
  });
});

/* ══════════ the duplicate guard ══════════ */
describe("existing PNs are skipped, never overwritten", () => {
  it("a file of only new dates adds everything", () => {
    const plan = buildUploadPlan([row({ launch_date: "2026-11-20" })],
      [existing()], "2026-11-01");
    expect(plan.toAdd).toBe(1);
    expect(plan.skipped).toHaveLength(0);
  });

  it("a matching row is skipped and named", () => {
    const plan = buildUploadPlan([row()], [existing()], "2026-11-01");
    expect(plan.toAdd).toBe(0);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0]).toEqual({
      date: "2026-11-15", slot: "3", category: "Westside", segment: "Push_Women" });
  });

  it("changed and deleted are always zero", () => {
    const plan = buildUploadPlan([row(), row({ launch_date: "2026-11-21" })],
      [existing()], "2026-11-01");
    expect(plan.changed).toBe(0);
    expect(plan.deleted).toBe(0);
  });

  it("a second PN in the same slot is genuinely new", () => {
    const plan = buildUploadPlan([row(), row()], [existing()], "2026-11-01");
    expect(plan.toAdd).toBe(1);
    expect(plan.skipped).toHaveLength(1);
  });

  it("a different segment in the same slot is not a duplicate", () => {
    const plan = buildUploadPlan([row({ pncc_segment_label: "Push_Men" })],
      [existing()], "2026-11-01");
    expect(plan.toAdd).toBe(1);
  });

  it("warns when a date is already in the tool", () => {
    const plan = buildUploadPlan([row({ slot_label: "9" })], [existing()], "2026-11-01");
    expect(plan.days[0].dateAlreadyInTool).toBe(true);
    const fresh = buildUploadPlan([row({ launch_date: "2026-11-25" })],
      [existing()], "2026-11-01");
    expect(fresh.days[0].dateAlreadyInTool).toBe(false);
  });

  it("rowsToInsert returns only the new rows", () => {
    const out = rowsToInsert(
      [row(), row({ launch_date: "2026-11-22" })], [existing()]);
    expect(out).toHaveLength(1);
    expect(out[0].launch_date).toBe("2026-11-22");
  });

  it("the 928-row case: a file of new dates leaves existing rows alone", () => {
    const old = Array.from({ length: 5 }, (_, i) =>
      existing({ id: `e${i}`, slot_label: String(i) }));
    const file = Array.from({ length: 3 }, (_, i) =>
      row({ launch_date: "2026-11-18", slot_label: String(i) }));
    const plan = buildUploadPlan(file, old, "2026-11-01");
    expect(plan.toAdd).toBe(3);
    expect(plan.skipped).toHaveLength(0);
    expect(plan.changed).toBe(0);
    expect(plan.deleted).toBe(0);
    // The existing objects are never mutated by planning.
    expect(old[0].slot_label).toBe("0");
  });

  it("the insert is skipped entirely when nothing is new", () => {
    expect(up).toContain("Every row in this file is already in the tool. Nothing was added.");
  });

  it("only the fresh rows go to add_upload_batch, so the batch is accurate", () => {
    expect(up).toContain("const fresh = rowsToInsert(");
    expect(up).toContain("await addUploadBatch(\n          fresh,");
  });
});

describe("the preview states all four numbers", () => {
  it.each(["New PNs to add:", "Already in the tool, skipped:",
           "Existing PNs changed: 0", "Deleted: 0"])("shows %s", (t) => {
    expect(up).toContain(t);
  });

  it("lists skipped rows by date, slot and category", () => {
    expect(up).toContain("Skipped: {fmtDate(r.date)} · slot {r.slot} · {r.category}");
  });
});

/* ══════════ step 3 ══════════ */
describe("bulk PN Type", () => {
  it("is in the shared bulk-fill set", () => {
    expect(BULK_FILL_KEYS.has("pn_type")).toBe(true);
  });

  it("uses the existing bulk-fill pattern, only that column", () => {
    const bulk = read("../components/BulkWorkspace.tsx");
    expect(bulk).toContain("BULK_FILL_KEYS.has(String(c.key))");
    expect(bulk).toContain("// ONLY this column. Every other field on the row is untouched.");
  });

  it("reports the count and names rejected rows", () => {
    const bulk = read("../components/BulkWorkspace.tsx");
    expect(bulk).toContain('Applied "${fillValue || "(blank)"}" to ${ids.length}');
    expect(bulk).toContain("label: c ? rowLabel(c) : id");
  });

  it("the column is a PN_TYPES select in the CRM review grid", () => {
    const bulk = read("../components/BulkWorkspace.tsx");
    const cat = bulk.slice(bulk.indexOf("const CATEGORY_COLUMNS"),
                           bulk.indexOf("];", bulk.indexOf("const CATEGORY_COLUMNS")));
    expect(cat).toContain('key: "pn_type"');
    expect(cat).toContain("options: PN_TYPES");
  });
});

/* ══════════ batch scoping is intact ══════════ */
describe("Reset last upload still removes only its own batch", () => {
  it("targets the batch's untouched rows only", () => {
    const sql = readFileSync(
      join(__dirname, "../../supabase/32_upload_batches_and_reset.sql"), "utf8");
    expect(sql).toContain("delete from campaigns where id = any(v_now)");
    expect(sql).not.toMatch(/delete from campaigns where upload_batch_id/);
    expect(sql).toContain("Only the latest batch can be reset");
  });
});
