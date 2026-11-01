import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { CATEGORY_REQUIRED, CATEGORY_OPTIONAL } from "./categoryValidation";
import { PART2_FIELDS, SEND_FIELDS, missingToSend, sendReady, canMoveForward } from "./crmPart2";
import type { Campaign } from "@/types/campaign";

const read = (p: string) => readFileSync(join(__dirname, p), "utf8");
const bulk = read("../components/BulkWorkspace.tsx");
const sql = readFileSync(
  join(__dirname, "../../supabase/37_category_gate_and_pn_type_owner.sql"), "utf8");

/* ══════════ ITEM 1 ══════════ */
describe("item 1 — the seven Category fields", () => {
  it("is exactly these seven, with sub_category added", () => {
    expect([...CATEGORY_REQUIRED]).toEqual([
      "sub_category", "brand", "offer", "brief", "landing",
      "expected_cvr", "expected_rpv"]);
  });

  it("Comments and Date / Time Brief never block", () => {
    expect([...CATEGORY_OPTIONAL]).toEqual(["additional_notes", "date_time_brief"]);
    for (const f of CATEGORY_OPTIONAL) {
      expect(CATEGORY_REQUIRED).not.toContain(f as never);
    }
  });

  it("the gate is enforced at the status change, in Postgres", () => {
    expect(sql).toContain("new.category_status in ('LOCKED','SUBMITTED')");
    expect(sql).toContain("and old.category_status not in ('LOCKED','SUBMITTED')");
    expect(sql).toContain("Category input is incomplete. Still needed:");
  });

  it("never re-validates a PN already submitted", () => {
    expect(sql).toContain("old.category_status not in ('LOCKED','SUBMITTED')");
  });

  it("CRM, system writes and CRM Self are exempt", () => {
    const fn = sql.slice(sql.indexOf("function public.enforce_category_submit_gate"));
    expect(fn).toContain("app.system_write");
    expect(fn).toContain("v_role = 'CRM'::app_role");
    expect(fn).toContain("if new.is_crm_self then");
  });

  it("option 3: PNs blocked only by the new field are identifiable", () => {
    expect(sql).toContain("function public.blocked_only_by_new_rule");
    expect(sql).toContain("btrim(coalesce(c.sub_category,'')) = ''");
  });

  it("CVR and RPV are non-empty only — no numeric rule", () => {
    expect(read("./categoryValidation.ts")).toContain("no numeric");
    expect(sql).not.toMatch(/~\s*'\^\[0-9\]/);
  });
});

/* ══════════ ITEM 2 ══════════ */
describe("item 2 — PN Type is CRM's fifth Part 2 field", () => {
  it("bucket membership still reads only the four", () => {
    expect(PART2_FIELDS.map((f) => f.key)).toEqual([
      "title_brief", "message_brief", "pn_template", "creative_requirements"]);
  });

  it("the SEND gate adds PN Type", () => {
    expect(SEND_FIELDS.map((f) => f.key)).toContain("pn_type");
    expect(SEND_FIELDS).toHaveLength(5);
  });

  it("an existing null-PN-Type PN is NOT moved back", () => {
    // part2Complete drives the bucket and does not consult pn_type.
    expect(PART2_FIELDS.map((f) => f.key)).not.toContain("pn_type");
  });

  it("but it cannot be SENT without one", () => {
    const base = { title_brief: "t", message_brief: "m", pn_template: "Basic",
      creative_requirements: "c" } as Partial<Campaign>;
    expect(missingToSend(base)).toEqual(["PN Type"]);
    expect(sendReady(base)).toBe(false);
    expect(sendReady({ ...base, pn_type: "SALE" })).toBe(true);
  });

  it("a PN already sent is grandfathered", () => {
    expect(canMoveForward({ crm_status: "SENT_TO_CONTENT" } as Partial<Campaign>)).toBe(true);
  });

  it("is editable in CRM's review grid, read-only for Content", () => {
    const cat = bulk.slice(bulk.indexOf("const CATEGORY_COLUMNS"),
                           bulk.indexOf("];", bulk.indexOf("const CATEGORY_COLUMNS")));
    expect(cat).toContain("options: PN_TYPES");
    const content = bulk.slice(bulk.indexOf("CONTENT_INPUT_COLUMNS"),
                               bulk.indexOf("];", bulk.indexOf("CONTENT_INPUT_COLUMNS")));
    expect(content.split("\n").find((l) => l.includes('key: "pn_type"'))!)
      .toContain('type: "readonly"');
  });

  it("PN Template is a dropdown in the review grid too", () => {
    const cat = bulk.slice(bulk.indexOf("const CATEGORY_COLUMNS"),
                           bulk.indexOf("];", bulk.indexOf("const CATEGORY_COLUMNS")));
    expect(cat).toContain("options: PN_TEMPLATES");
  });

  it("Content can no longer write pn_type, in Postgres", () => {
    const fn = sql.slice(sql.indexOf("if v_role = 'CONTENT'::app_role then"));
    expect(fn.slice(0, fn.indexOf("elsif"))).toContain("new.pn_type");
  });

  it("the alert trigger stops watching pn_type for Content", () => {
    const body = sql.slice(sql.indexOf("function public.capture_change_alerts"));
    const contentBlock = body.slice(body.indexOf("    else\n      if btrim(coalesce(old.header"));
    expect(contentBlock.slice(0, contentBlock.indexOf("end if;\n\n    if array_length")))
      .not.toContain("pn_type");
  });
});

/* ══════════ ITEM 3 ══════════ */
describe("item 3 — the two hidden columns", () => {
  it("hides the Category-owned Campaign Name and Landing Link", () => {
    expect(bulk).toContain('FINAL_QC: ["campaign_name", "landing"]');
  });

  it("keeps the tracking Campaign Name and Landing (code)", () => {
    expect(bulk).toContain('key: "campaign_name_code"');
    expect(bulk).toContain('key: "tracking_landing"');
  });

  it("is display only — one line brings a column back", () => {
    expect(bulk).toContain("HIDDEN_BY_MODE");
    expect(bulk).toContain(".filter((c) => !(HIDDEN_BY_MODE[mode] ?? []).includes(String(c.key)))");
  });
});

/* ══════════ ITEM 4 ══════════ */
describe("item 4 — scroll", () => {
  it("skips the scroll state update when it cannot matter", () => {
    expect(bulk).toContain("if (renderAllRef.current) return;");
  });

  it("hands out ONE stable handler per row and column", () => {
    expect(bulk).toContain("const pickHandlerFor = useCallback");
    expect(bulk).toContain("const createHandlerFor = useCallback");
    expect(bulk).toContain("pickHandlers.current.set(k, fn)");
  });

  it("no inline arrow is passed to TrackingCell any more", () => {
    const call = bulk.slice(bulk.indexOf("<TrackingCell col={col}"),
                            bulk.indexOf("/>", bulk.indexOf("<TrackingCell col={col}")));
    expect(call).not.toContain("=> {");
    expect(call).toContain("onPick={pickHandlerFor(");
  });

  it("the cached closures read refs, so they never go stale", () => {
    expect(bulk).toContain("campaignsRef.current = campaigns;");
    expect(bulk).toContain("addBrandCodeRef.current = addBrandCode;");
  });
});

/* ══════════ migration safety ══════════ */
describe("migration 37 safety", () => {
  it("deletes and changes no data AT MIGRATION TIME", () => {
    /*
     * Statements inside a function body run later, when a user acts — they
     * are not executed by running this file. Only top-level DML would
     * change data on install, so strip function bodies before asserting.
     */
    const D = String.fromCharCode(36, 36);          // "$$"
    const topLevel = sql
      .split(D).filter((_, i) => i % 2 === 0).join(" ")   // drop function bodies
      .replace(/\/\*[\s\S]*?\*\//g, " ")                  // drop the commented test script
      .split(String.fromCharCode(10))
      .filter((l) => !l.trim().startsWith("--")).join(String.fromCharCode(10));
    expect(topLevel).not.toMatch(/^\s*delete from/im);
    expect(topLevel).not.toMatch(/^\s*update campaigns set/im);
    expect(topLevel).not.toMatch(/truncate|drop table/i);
  });

  it("is idempotent and transaction-safe", () => {
    expect(sql).toContain("create or replace function");
    expect(sql).toContain("drop trigger if exists");
    const code = sql.split(String.fromCharCode(10))
      .filter((l) => !l.trim().startsWith("--")).join(String.fromCharCode(10));
    expect(code).not.toMatch(/alter type .* add value/i);
    expect(code).not.toMatch(/create index concurrently/i);
  });

  it("has checks, VERIFY, rollback and a self-looking-up test script", () => {
    expect(sql).toContain("READ-ONLY CHECKS");
    expect(sql).toContain("campaigns_total_after");
    expect(sql).toContain("notifications_total_after");
    expect(sql).toContain("ROLLBACK NOTE");
    expect(sql).toContain("where role = 'CATEGORY' limit 1");
    expect(sql).toContain("test_rows_left");
  });

  it("runs the enum guard in VERIFY", () => {
    expect(sql).toContain("check_trigger_enum_literals()");
  });
});
