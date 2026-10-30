import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { parseContentWorkbook, buildContentWorkbook } from "./contentExcel";
import { isValidPnType } from "@/config/pnOptions";
import type { Campaign } from "@/types/campaign";

const read = (p: string) => readFileSync(join(__dirname, p), "utf8");
const sql = readFileSync(
  join(__dirname, "../../supabase/34_calendar_lock_and_updated_at.sql"), "utf8");
const drawer = read("../components/CampaignDrawer.tsx");

/* ══════════ 2 + 3: the triggers ══════════ */
describe("migration 34 — calendar lock and updated_at", () => {
  it("updated_at gets a real BEFORE UPDATE trigger", () => {
    expect(sql).toContain("function public.set_updated_at()");
    expect(sql).toContain("new.updated_at := now()");
    expect(sql).toContain("create trigger campaigns_set_updated_at");
  });

  it("human_rev is bumped only by HUMAN writes", () => {
    expect(sql).toContain("add column if not exists human_rev");
    expect(sql).toContain("current_setting('app.system_write', true)");
    expect(sql).toContain("new.human_rev := coalesce(old.human_rev, 0) + 1");
  });

  it("the lock rejects Category and Content on a calendar PN", () => {
    expect(sql).toContain("is on the calendar and is locked");
    expect(sql).toContain("old.calendar_status = 'UPDATED'");
  });

  it("CRM and system writes are exempt", () => {
    const fn = sql.slice(sql.indexOf("function public.enforce_calendar_lock"));
    expect(fn).toContain("if v_role is null or v_role = 'CRM'::app_role then");
    expect(fn.indexOf("app.system_write")).toBeLessThan(fn.indexOf("old.calendar_status"));
  });

  it("every system write is named and explained", () => {
    for (const f of ["default_overdue_pns", "recalculate_category_sla",
                     "reset_last_upload", "send_back_to_content",
                     "update_calendar", "add_upload_batch"]) {
      expect(sql, f).toContain(f);
    }
  });

  it("remove_from_calendar is CRM-only, needs a name, keeps the QC ticks", () => {
    const fn = sql.slice(sql.indexOf("function public.remove_from_calendar"));
    expect(fn.indexOf("is_crm()")).toBeLessThan(fn.indexOf("update campaigns"));
    expect(fn).toContain("Your name is required");
    expect(fn).toContain("qc_status = 'PENDING'::qc_status");
    expect(fn).not.toMatch(/delete from qc_checklists/i);
    expect(fn).toContain("TICKS ARE KEPT");
  });

  it("deletes and changes no data at migration time", () => {
    const body = sql.slice(sql.indexOf("1. RELIABLE updated_at"),
                           sql.indexOf("BEGIN ... ROLLBACK TEST"));
    expect(body).not.toMatch(/^\s*delete from/im);
    expect(body).not.toMatch(/^\s*update campaigns set/im);
    expect(body).not.toMatch(/truncate|drop table/i);
  });

  it("has checks, VERIFY, a rollback note and a BEGIN/ROLLBACK script", () => {
    expect(sql).toContain("READ-ONLY CHECKS");
    expect(sql).toContain("VERIFY");
    expect(sql).toContain("ROLLBACK NOTE");
    expect(sql).toContain("BEGIN ... ROLLBACK TEST");
    expect(sql).toContain("TEST_lock_me");
    expect(sql).toContain("campaigns_total_after");
  });

  it("is safe inside one transaction", () => {
    // The header explains the absence, so assert on CODE, not comments.
    const code = sql.split(String.fromCharCode(10))
      .filter((l) => !l.trim().startsWith("--")).join(String.fromCharCode(10));
    expect(code).not.toMatch(/alter type .* add value/i);
    expect(code).not.toMatch(/create index concurrently/i);
  });
});

/* ══════════ 1: the two edit gates ══════════ */
describe("1 — editing until the calendar push", () => {
  it("Category is locked only once the PN is on the calendar", () => {
    expect(drawer).toContain(
      'const locked = campaign.category_status === "LOCKED" && onCalendar;');
  });

  it("Content is read-only only once the PN is on the calendar", () => {
    expect(drawer).toContain(
      'useState(campaign.content_status === "SUBMITTED" && onCalendar);');
  });

  it("both gates read the same calendar flag", () => {
    expect((drawer.match(/const onCalendar = campaign\.calendar_status === "UPDATED";/g) ?? []))
      .toHaveLength(2);
  });
});

/* ══════════ 4: remove from calendar ══════════ */
describe("4 — Remove from calendar", () => {
  it("is offered only for a PN on the calendar", () => {
    expect(drawer).toContain('campaign.calendar_status === "UPDATED" && (');
    expect(drawer).toContain("Remove from calendar");
  });

  it("requires a typed name and explains the consequence", () => {
    expect(drawer).toContain('removeName.trim() === ""');
    expect(drawer).toContain("resets QC to pending");
    expect(drawer).toContain("only return to the calendar through Final QC");
  });

  it("the modal sits above the drawer", () => {
    expect(drawer).toContain('title="Remove from calendar" z="z-[90]"');
  });
});

/* ══════════ 5: PN Type in the Content workbook ══════════ */
describe("5 — PN Type round-trips through Excel", () => {
  const pn = (o: Partial<Campaign> = {}) => ({
    id: "11111111-1111-4111-8111-111111111111",
    campaign_name: "PN A", launch_date: "2026-11-12",
    header: "H", sub_copy_text: "S", reference_link: "",
    pn_type: "SALE", ...o,
  }) as unknown as Campaign;

  it("is a column in the exported workbook", () => {
    expect(read("./contentExcel.ts")).toContain('"PN Type"');
    expect(read("./contentExcel.ts")).toContain('"PN Type": c.pn_type ?? ""');
  });

  it("round-trips SALE and BAU", () => {
    for (const t of ["SALE", "BAU"]) {
      const wb = buildContentWorkbook([pn({ pn_type: t })]);
      const { rows, errors } = parseContentWorkbook(wb);
      expect(errors).toEqual([]);
      expect(rows[0].pn_type).toBe(t);
    }
  });

  it("an empty cell is allowed and parses as null", () => {
    const wb = buildContentWorkbook([pn({ pn_type: null })]);
    const { rows, errors } = parseContentWorkbook(wb);
    expect(errors).toEqual([]);
    expect(rows[0].pn_type).toBeNull();
  });

  it("rejects an unknown value per row, naming the Excel row", () => {
    const wb = buildContentWorkbook([pn({ pn_type: "PROMO" } as Partial<Campaign>)]);
    const { rows, errors } = parseContentWorkbook(wb);
    expect(rows).toHaveLength(0);
    expect(errors[0]).toMatch(/PN Type "PROMO" is not valid — use SALE or BAU/);
  });

  it("lowercase is rejected — the stored values are uppercase", () => {
    expect(isValidPnType("sale")).toBe(false);
  });

  it("an empty cell never clears an existing value on import", () => {
    expect(read("../services/contentBulk.ts"))
      .toContain("...(r.pn_type ? { pn_type: r.pn_type } : {})");
  });

  it("a PN Type change is a reportable Content change", () => {
    expect(read("./contentExcel.ts")).toContain('pn_type: "PN Type Updated"');
  });
});
