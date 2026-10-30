import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { canSendBack, willResetQc } from "@/services/sendBack";
import { SUB_COPY_LIMIT, HEADER_LIMIT } from "./workflow";
import { validateContentRow } from "./contentExcel";
import type { Campaign } from "@/types/campaign";

const read = (p: string) => readFileSync(join(__dirname, p), "utf8");
const sql = readFileSync(join(__dirname, "../../supabase/31_send_back_to_content.sql"), "utf8");

const pn = (o: Partial<Campaign> = {}) => ({
  id: "c1", campaign_name: "PN A", launch_date: "2026-11-05",
  slot_label: "3", slot_number: 3,
  content_status: "SUBMITTED", qc_status: "PENDING",
  calendar_status: "NOT_UPDATED", send_back_count: 0,
  send_back_reason: null, send_back_field: null,
  send_back_at: null, send_back_by_name: null, ...o,
}) as unknown as Campaign;

/* ══════════ RULE 1: Sub Copy 200 ══════════ */
describe("Sub Copy limit is 200, Header stays 60", () => {
  it("the constants are 200 and 60", () => {
    expect(SUB_COPY_LIMIT).toBe(200);
    expect(HEADER_LIMIT).toBe(60);
  });

  it("200 characters are accepted, 201 rejected", () => {
    const ok = validateContentRow(
      { id: "x", header: "h", sub_copy_text: "y".repeat(200) },
      HEADER_LIMIT, SUB_COPY_LIMIT);
    expect(ok.ready).toBe(true);

    const over = validateContentRow(
      { id: "x", header: "h", sub_copy_text: "y".repeat(201) },
      HEADER_LIMIT, SUB_COPY_LIMIT);
    expect(over.ready).toBe(false);
    expect(over.problems[0]).toMatch(/201 characters, over the 200 limit/);
  });

  it("Header is still capped at 60", () => {
    expect(validateContentRow({ id: "x", header: "h".repeat(61), sub_copy_text: "s" },
      HEADER_LIMIT, SUB_COPY_LIMIT).ready).toBe(false);
    expect(validateContentRow({ id: "x", header: "h".repeat(60), sub_copy_text: "s" },
      HEADER_LIMIT, SUB_COPY_LIMIT).ready).toBe(true);
  });

  it("there is ONE definition — no literal 100 left for sub copy", () => {
    expect(read("./workflow.ts")).toContain("export const SUB_COPY_LIMIT = 200;");
    for (const f of ["../components/CampaignDrawer.tsx",
                     "../components/ContentImportPreview.tsx"]) {
      expect(read(f)).toContain("SUB_COPY_LIMIT");
      expect(read(f)).not.toMatch(/sub_?copy[^\n]*\b100\b/i);
    }
  });

  it("s_count is derived, never validated against a second number", () => {
    expect(read("../services/campaigns.ts")).toContain("s_count: subCopy.length");
    expect(read("../services/contentBulk.ts")).toContain("s_count: countOf(");
  });
});

/* ══════════ The swallowed error ══════════ */
describe("a failed load no longer looks like 'no data'", () => {
  it.each(["../app/(app)/campaigns/page.tsx", "../app/(app)/calendar/page.tsx"])(
    "%s surfaces the error", (f) => {
      const src = read(f);
      expect(src).toContain("const { campaigns, loading, error, reload }");
      expect(src).toContain("Could not load campaigns:");
      expect(src).toContain("Try again");
    });
});

/* ══════════ RULES 5, 6, 7: send-back ══════════ */
describe("send-back eligibility", () => {
  it("a submitted PN can be sent back", () => {
    expect(canSendBack(pn()).ok).toBe(true);
  });

  it("a PN on the calendar CANNOT", () => {
    const r = canSendBack(pn({ calendar_status: "UPDATED" }));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/already on the calendar/i);
  });

  it("a PN Content has not submitted cannot", () => {
    for (const st of ["NOT_ASSIGNED", "PENDING", "NEEDS_CHANGES"]) {
      expect(canSendBack(pn({ content_status: st } as Partial<Campaign>)).ok).toBe(false);
    }
  });

  it("a QC-passed PN CAN be sent back, and flags the QC reset", () => {
    const c = pn({ qc_status: "PASSED" });
    expect(canSendBack(c).ok).toBe(true);
    expect(willResetQc(c)).toBe(true);
    expect(willResetQc(pn())).toBe(false);
  });

  it("a calendar PN is refused even when QC passed", () => {
    expect(canSendBack(pn({ qc_status: "PASSED", calendar_status: "UPDATED" })).ok).toBe(false);
  });
});

describe("migration 31", () => {
  it("reuses NEEDS_CHANGES — no new state", () => {
    expect(sql).toContain("'NEEDS_CHANGES'::content_status");
    expect(sql).not.toMatch(/create type content_status/);
    expect(sql).not.toMatch(/alter type content_status add value/);
  });

  it("resets qc_status but KEEPS the checklist ticks", () => {
    expect(sql).toContain("qc_status         = 'PENDING'::qc_status");
    expect(sql).not.toMatch(/delete from qc_checklists/i);
    expect(sql).not.toMatch(/update qc_checklists/i);
  });

  it("returns the PN to CRM review (rule 12)", () => {
    expect(sql).toContain("crm_status        = 'SENT_TO_CONTENT'::crm_status");
  });

  it("is CRM-only, checked first", () => {
    expect(sql.indexOf("is_crm()")).toBeLessThan(sql.indexOf("update campaigns"));
  });

  it("requires a reason and a name", () => {
    expect(sql).toContain("A reason is required");
    expect(sql).toContain("Your name is required");
  });

  it("refuses a calendar PN server-side, not just in the UI", () => {
    expect(sql).toContain("c.calendar_status = 'UPDATED'");
  });

  it("locks the row for the duration", () => {
    expect(sql).toContain("for update");
  });

  it("writes the counter, activity and notification", () => {
    expect(sql).toContain("send_back_count   = coalesce(send_back_count, 0) + 1");
    expect(sql).toContain("insert into activity_logs");
    expect(sql).toContain("insert into notifications");
  });

  it("deletes nothing", () => {
    expect(sql).not.toMatch(/^\s*delete from/im);
    expect(sql).not.toMatch(/drop table/i);
  });

  it("is idempotent", () => {
    expect(sql).toContain("add column if not exists");
    expect(sql).toContain("create or replace function");
    expect(sql).toContain("create index if not exists");
  });

  it("opens with a read-only check query", () => {
    const head = sql.slice(0, sql.indexOf("alter table campaigns"));
    expect(head).toContain("READ-ONLY CHECK");
    expect(head).toMatch(/^\s*select/im);
  });
});

describe("bulk send-back is partial, like every other bulk action", () => {
  it("reports blocked rows by PN, date and slot", () => {
    const svc = read("../services/sendBack.ts");
    expect(svc).toContain("c.launch_date ?? \"no date\"");
    expect(svc).toContain("slot ${");
    expect(svc).toContain("outcomes.push({ campaignId: c.id, ok: false");
  });

  it("calls the function once per PN so each gets its own counter", () => {
    expect(read("../services/sendBack.ts")).toContain("for (const c of campaigns)");
  });

  it("the name is remembered per browser", () => {
    const svc = read("../services/sendBack.ts");
    expect(svc).toContain("cliq.sendBack.name");
    expect(svc).toContain("localStorage");
  });
});

describe("Content sees the reason", () => {
  it("the drawer shows it at the top for a NEEDS_CHANGES PN", () => {
    const d = read("../components/CampaignDrawer.tsx");
    expect(d).toContain('campaign.content_status === "NEEDS_CHANGES" && campaign.send_back_reason');
    expect(d).toContain("Sent back by CRM");
    expect(d.indexOf("Sent back by CRM"))
      .toBeLessThan(d.indexOf("PART 1: CRM Scheduling"));
  });

  it("the existing queues already route NEEDS_CHANGES", () => {
    expect(read("./crmBuckets.ts")).toContain('c.content_status === "NEEDS_CHANGES"');
    expect(read("../services/contentBulk.ts")).toContain('c.content_status === "NEEDS_CHANGES"');
  });
});

/* ══════════ Bulk send back from Show All PN ══════════ */
describe("bulk send back, beside Bulk Push To Calendar", () => {
  const bulk = read("../components/BulkWorkspace.tsx");
  const ui = read("../components/ui.tsx");
  const modal = read("../components/SendBackModal.tsx");

  it("sits beside the primary action in Final QC", () => {
    expect(bulk).toContain("Bulk Send Back to Content (");
    expect(bulk.indexOf("{primaryLabel}"))
      .toBeLessThan(bulk.indexOf("Bulk Send Back to Content ("));
  });

  it('the primary there is "Bulk Push To Calendar"', () => {
    expect(bulk).toContain('mode === "FINAL_QC" ? "Bulk Push To Calendar"');
  });

  it("appears ONLY in Final QC, not in the other grids", () => {
    expect(bulk).toContain("{isQc && (");
    const btn = bulk.slice(bulk.indexOf("Bulk Send Back to Content (") - 400,
                           bulk.indexOf("Bulk Send Back to Content ("));
    expect(btn).toContain("isQc &&");
  });

  it("is disabled until rows are selected", () => {
    const btn = bulk.slice(bulk.indexOf("{isQc && ("),
                           bulk.indexOf("Bulk Send Back to Content ("));
    expect(btn).toContain("selected.size === 0");
  });

  it("flushes unsaved edits first, like the primary action", () => {
    expect(bulk).toContain("if (dirtyCount > 0) await saveAll();");
  });

  it("reports blocked rows rather than failing the batch", () => {
    expect(bulk).toContain("blocked.length > 0");
    expect(bulk).toContain("could not be sent:");
  });

  it("clears the selection after sending", () => {
    expect(bulk).toContain("setSelected(new Set());");
  });

  /* The z-index trap, same class as the dropdown bug. */
  it("the modal renders ABOVE the workspace", () => {
    expect(bulk).toContain('z="z-[80]"');
    const modalZ = 80;
    const workspaceZ = Number(bulk.match(/fixed inset-0 z-\[(\d+)\]/)![1]);
    expect(modalZ).toBeGreaterThan(workspaceZ);
  });

  it("Modal takes a stacking prop, defaulting to the old value", () => {
    expect(ui).toContain('z = "z-50"');
    expect(ui).toContain("fixed inset-0 ${z}");
    expect(modal).toContain("z={z}");
  });

  it("eligibility is still enforced in Postgres", () => {
    const svc = read("../services/sendBack.ts");
    expect(svc).toContain("bulkSendBackToContent");
    expect(sql).toContain("c.calendar_status = 'UPDATED'");
  });
});
