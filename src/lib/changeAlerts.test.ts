import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { flaggedCampaignIds, type ChangeAlert } from "@/services/changeAlerts";

const read = (p: string) => readFileSync(join(__dirname, p), "utf8");
const sql = readFileSync(join(__dirname, "../../supabase/35_change_alerts.sql"), "utf8");
const svc = read("../services/changeAlerts.ts");
const ui = read("../components/InputChangeAlerts.tsx");

/* ══════════ capture is in the DATABASE ══════════ */
describe("alerts are created by the database, never the browser", () => {
  it("an AFTER UPDATE trigger does the capture", () => {
    expect(sql).toContain("create trigger campaigns_change_alerts");
    expect(sql).toContain("after update on campaigns");
  });

  it("the app never inserts an alert", () => {
    expect(svc).not.toMatch(/\.from\("notifications"\)[\s\S]{0,80}\.insert/);
    expect(ui).not.toMatch(/\.insert\(/);
  });

  it("acknowledging goes through a role-checked function", () => {
    expect(sql).toContain("function public.acknowledge_alert");
    expect(sql).toContain("Only CRM can acknowledge");
    expect(sql).toContain("Your name is required to mark an alert reviewed");
  });
});

/* ══════════ DEFENSIVE ══════════ */
describe("a broken alert can never block an edit", () => {
  it("the capture is wrapped in an exception handler", () => {
    expect(sql).toContain("exception when others then");
    expect(sql).toContain("The change was saved, but the CRM alert could not be created");
  });

  it("the failure is logged, never silent", () => {
    expect(sql).toContain("'ALERT_CAPTURE_FAILED'");
    expect(sql).toContain("raise warning");
  });

  it("the test script proves it", () => {
    expect(sql).toContain("rename column field_label to field_label_broken");
    expect(sql).toContain("the edit SUCCEEDS despite the broken alert path");
  });
});

/* ══════════ when an alert IS created ══════════ */
describe("the rules", () => {
  it("system writes never alert", () => {
    expect(sql).toContain("current_setting('app.system_write', true)");
  });

  it("only CATEGORY and CONTENT in B1", () => {
    expect(sql).toContain("v_role not in ('CATEGORY'::app_role, 'CONTENT'::app_role)");
  });

  it("NEEDS_CHANGES rework creates no alert", () => {
    expect(sql).toContain("old.content_status = 'NEEDS_CHANGES'");
  });

  it('"after submission" uses stamps, never category_status alone', () => {
    expect(sql).toContain("old.category_submitted_at is null");
    expect(sql).toContain("old.content_submitted_at is null");
    expect(sql).toContain("category_status` is written inconsistently");
  });

  it("existing rows have no stamp, so no retrospective alerts", () => {
    expect(sql).toContain("Existing rows stay NULL");
  });

  it("a no-op save creates nothing (trimmed comparison)", () => {
    expect(sql).toContain("btrim(coalesce(old.header,'')) is distinct from btrim(coalesce(new.header,''))");
    expect(sql).toContain("return null;                       -- no-op save");
  });

  it("only columns the acting team owns are compared", () => {
    const fn = sql.slice(sql.indexOf("function public.capture_change_alerts"));
    expect(fn).toContain("if v_role = 'CATEGORY'::app_role then");
    expect(fn).toContain("old.pn_type,''");      // Content-owned
    expect(fn).toContain("old.brand,''");        // Category-owned
  });

  it("labels are human-readable, never column names", () => {
    expect(sql).toContain("'sub_copy_text','Sub Copy'");
    expect(sql).toContain("'pn_type','PN Type'");
    expect(sql).toContain("function public.field_label");
  });
});

/* ══════════ grouping ══════════ */
describe("grouping and merging", () => {
  it("a batch id groups; without one each PN alerts separately", () => {
    expect(sql).toContain("then 'BATCH:' || v_batch");
    expect(sql).toContain("else 'PN:' || new.id::text");
  });

  it("merges into the existing UNACKNOWLEDGED alert, showing the net change", () => {
    expect(sql).toContain("where group_key = v_group and acknowledged_at is null");
    expect(sql).toContain("update notifications");
  });

  it("every step still goes to Activity", () => {
    expect(sql).toContain("'INPUT_CHANGED'");
    expect(sql).toContain("insert into activity_logs");
  });

  it("the typed name is recorded, or says it was missing", () => {
    expect(sql).toContain("coalesce(v_name, 'name not provided')");
  });
});

/* ══════════ B7: back to review ══════════ */
describe("a reviewed or QC-passed PN returns to CRM review", () => {
  it("resets qc_status and crm_status inside the SECURITY DEFINER trigger", () => {
    expect(sql).toContain("if new.qc_status = 'PASSED' or new.crm_status = 'REVIEWED' then");
    expect(sql).toContain("qc_status  = 'PENDING'::qc_status");
    expect(sql).toContain("crm_status = 'SENT_TO_CONTENT'::crm_status");
  });

  it("keeps the QC ticks", () => {
    expect(sql).not.toMatch(/delete from qc_checklists/i);
  });
});

/* ══════════ security + safety ══════════ */
describe("security and migration safety", () => {
  it("RLS limits reads to the caller's own role", () => {
    expect(sql).toContain("using (target_role = public.current_app_role())");
  });

  it("deletes nothing", () => {
    const body = sql.slice(sql.indexOf("1. RELIABLE"));
    expect(body).not.toMatch(/^\s*delete from/im);
    expect(body).not.toMatch(/truncate|drop table/i);
  });

  it("is idempotent and transaction-safe", () => {
    expect(sql).toContain("add column if not exists");
    expect(sql).toContain("create or replace function");
    const code = sql.split(String.fromCharCode(10))
      .filter((l) => !l.trim().startsWith("--")).join(String.fromCharCode(10));
    expect(code).not.toMatch(/alter type .* add value/i);
    expect(code).not.toMatch(/create index concurrently/i);
  });

  it("checks both row counts before and after", () => {
    expect(sql).toContain("notifications_total");
    expect(sql).toContain("notifications_total_after");
    expect(sql).toContain("campaigns_total_after");
  });

  it("has a rollback note and a BEGIN/ROLLBACK script", () => {
    expect(sql).toContain("ROLLBACK NOTE");
    expect(sql).toContain("TEST_alert");
  });
});

/* ══════════ the UI ══════════ */
describe("the red banner", () => {
  it("shows a count and hides when there is nothing", () => {
    expect(ui).toContain("if (alerts.length === 0) return null;");
    expect(ui).toContain("input change{alerts.length === 1 ? \"\" : \"s\"} need review");
  });

  it("requires a typed name to acknowledge", () => {
    expect(ui).toContain('if (name.trim() === "") { setError("Enter your name first."); return; }');
  });

  it("shows old → new, the team, who and when", () => {
    expect(ui).toContain("a.old_value");
    expect(ui).toContain("a.new_value");
    expect(ui).toContain("a.source_team");
    expect(ui).toContain("a.changed_by_name");
  });

  it("filters by team", () => {
    expect(ui).toContain('<option value="CATEGORY">Category</option>');
  });

  it("degrades to empty if migration 35 has not run", () => {
    expect(svc).toContain("return [];");
  });
});

describe("flagged campaigns", () => {
  it("collects ids for the PN badge", () => {
    const a = [{ campaign_id: "x" }, { campaign_id: null }] as ChangeAlert[];
    expect([...flaggedCampaignIds(a)]).toEqual(["x"]);
  });
});
