import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { NOT_EDITABLE, rowLabel } from "@/services/campaigns";

const read = (p: string) => readFileSync(join(__dirname, p), "utf8");
const svc = read("../services/campaigns.ts");
const bulk = read("../components/BulkWorkspace.tsx");
const sql = readFileSync(
  join(__dirname, "../../supabase/36_fix_change_alerts.sql"), "utf8");

describe("item 3 — no silent failures", () => {
  it("updateCampaign turns a zero-row write into a clear message", () => {
    expect(svc).toContain('error.code === "PGRST116"');
    expect(svc).toContain("if (!data) throw new Error(NOT_EDITABLE);");
    expect(NOT_EDITABLE).toContain("You can't edit this PN");
    expect(NOT_EDITABLE).toContain("on the calendar");
  });

  it("EVERY campaign write funnels through updateCampaign", () => {
    // One UPDATE against the campaigns table in the whole codebase.
    const updates = (svc.match(/from\(TABLE\)\.update\(/g) ?? []);
    expect(updates).toHaveLength(1);
  });

  it("a rejected row is named by PN, date and slot", () => {
    expect(rowLabel({ campaign_name: "PN A", launch_date: "2026-11-12",
      slot_label: "3" } as never)).toBe("PN A · 2026-11-12 · slot 3");
    expect(rowLabel({} as never)).toBe("PN · no date · slot —");
  });

  it("the grid bulk save collects per-row outcomes", () => {
    expect(bulk).toContain("const rejected:");
    expect(bulk).toContain("const savedIds:");
    expect(bulk).toContain("label: c ? rowLabel(c) : id");
  });

  it("it never says 'saved' when rows were rejected", () => {
    expect(bulk).toContain("if (rejected.length > 0) {");
    const block = bulk.slice(bulk.indexOf("if (rejected.length > 0) {"),
                             bulk.indexOf("onSaved();", bulk.indexOf("if (rejected.length > 0) {")));
    expect(block).toContain("rejected:");
    // The success line is only in the else branch.
    expect(block.indexOf("setDone(`Saved"))
      .toBeGreaterThan(block.indexOf("} else {"));
  });

  it("a rejected row stays dirty, so the edit is not discarded", () => {
    expect(bulk).toContain("for (const id of savedIds) delete next[id];");
  });

  it("bulk send-back and bulk calendar already report per row", () => {
    expect(read("../services/sendBack.ts")).toContain("outcomes.push({ campaignId: c.id, ok: false");
    expect(svc).toContain("BulkCalendarOutcome");
  });
});

describe("item 4 — a Category change to Brand/Offer/Landing clears the copy check", () => {
  it("is detected in the trigger", () => {
    expect(sql).toContain("v_copy_affecting := v_role = 'CATEGORY'::app_role");
    expect(sql).toContain("array['brand','offer','landing']::text[]");
  });

  it("feeds the same reset path", () => {
    expect(sql).toContain("or v_copy_affecting");
    expect(sql).toContain("update qc_checklists set copy_verified = false");
  });

  it("runs inside begin_system_write()", () => {
    const fn = sql.slice(sql.indexOf("if v_was_reviewed then"));
    expect(fn.indexOf("begin_system_write()"))
      .toBeLessThan(fn.indexOf("update qc_checklists"));
  });

  it("a Category change returns the PN to AWAITING_REVIEW", () => {
    expect(sql).toContain("then 'AWAITING_REVIEW'::crm_status");
  });
});

describe("migration 36 safety", () => {
  it("the enum guard catches cast literals too", () => {
    expect(sql).toContain("'''([A-Z_]+)''\\s*::\\s*' || v_enum");
  });

  it("ownership honours system writes", () => {
    const fn = sql.slice(sql.indexOf("function public.enforce_column_ownership"));
    expect(fn.indexOf("app.system_write")).toBeLessThan(fn.indexOf("v_role is null"));
  });

  it("the update policy has both USING and WITH CHECK", () => {
    const pol = sql.slice(sql.indexOf("create policy campaigns_update"),
                          sql.indexOf("-- EXECUTIVE appears"));
    expect(pol).toContain("using (");
    expect(pol).toContain("with check (");
    expect((pol.match(/calendar_status is distinct from 'UPDATED'/g) ?? []).length)
      .toBeGreaterThanOrEqual(4);
  });

  it("deletes nothing", () => {
    const body = sql.slice(sql.indexOf("1. DROP THE REDUNDANT POLICY"));
    expect(body).not.toMatch(/^\s*delete from/im);
    expect(body).not.toMatch(/truncate|drop table/i);
  });

  it("browser updates are limited to is_read by column grant", () => {
    expect(sql).toContain("revoke update on notifications from authenticated;");
    expect(sql).toContain("grant update (is_read) on notifications to authenticated;");
  });

  it("RED/AMBER and INPUT_CHANGED cannot be inserted from the browser", () => {
    expect(sql).toContain("coalesce(priority, 'NORMAL') = 'NORMAL'");
    expect(sql).toContain("type <> 'INPUT_CHANGED'");
  });
});
