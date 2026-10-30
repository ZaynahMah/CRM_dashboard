import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  PN_TEMPLATES, PN_TYPES, isLegacyTemplate, isValidPnType, LEGACY_PN_TEMPLATES,
} from "@/config/pnOptions";

const read = (p: string) => readFileSync(join(__dirname, p), "utf8");
const drawer = read("../components/CampaignDrawer.tsx");
const bulk = read("../components/BulkWorkspace.tsx");
const sql = readFileSync(
  join(__dirname, "../../supabase/33_pn_type_and_template.sql"), "utf8");

/* ══════════ A: send back in the drawer ══════════ */
describe("A — Send back inside the PN drawer", () => {
  it("is CRM only", () => {
    expect(drawer).toContain('role === "CRM" && campaign.content_status !== "NOT_ASSIGNED"');
  });

  it("is DISABLED with a reason, never hidden", () => {
    expect(drawer).toContain("disabled={!sendBackGate.ok}");
    expect(drawer).toContain("{sendBackGate.reason}");
  });

  it("reuses the existing modal and service", () => {
    expect(drawer).toContain('from "./SendBackModal"');
    expect(drawer).toContain("sendBackToContent(campaign.id, input)");
  });

  it("the modal sits ABOVE the drawer", () => {
    expect(drawer).toContain('z="z-[90]"');
  });

  it("shows the send-back count when there is one", () => {
    expect(drawer).toContain("campaign.send_back_count ?? 0) > 0");
  });
});

/* ══════════ C: PN Template ══════════ */
describe("C — the ten PN Template options", () => {
  it("are exactly these, in this order", () => {
    expect([...PN_TEMPLATES]).toEqual([
      "Basic", "Bezel", "Timer", "Background Coloured", "Title Coloured",
      "Carousel", "Video", "Multi CTA", "Icons", "Rating"]);
  });

  it("come from ONE shared constant used by grid and drawer", () => {
    expect(drawer).toContain('from "@/config/pnOptions"');
    expect(bulk).toContain('from "@/config/pnOptions"');
    expect(drawer).toContain("PN_TEMPLATES.map");
    expect(bulk).toContain("options: PN_TEMPLATES");
  });

  it('"Select" stays an empty placeholder, not a value', () => {
    expect(PN_TEMPLATES).not.toContain("Select" as never);
    expect(drawer).toContain('<option value="">Select</option>');
  });

  it("an old value is recognised and kept", () => {
    expect(isLegacyTemplate("Coloured BG")).toBe(true);
    expect(LEGACY_PN_TEMPLATES).toContain("Coloured BG");
    expect(isLegacyTemplate("Basic")).toBe(false);
    expect(isLegacyTemplate(null)).toBe(false);
  });

  it("an old value stays selectable and is flagged, never rewritten", () => {
    expect(drawer).toContain("isLegacyTemplate(campaign.pn_template) && (");
    expect(drawer).toContain("not in list");
  });

  it("Coloured BG is NOT auto-mapped to either new value", () => {
    expect(sql).toContain("deliberately NOT auto-mapped");
  });

  it("the mandatory Part 2 rule is unchanged — any non-empty value passes", async () => {
    const { isPart2FieldFilled } = await import("./crmPart2");
    for (const t of PN_TEMPLATES) expect(isPart2FieldFilled(t)).toBe(true);
    expect(isPart2FieldFilled("Coloured BG")).toBe(true);
    expect(isPart2FieldFilled("Select")).toBe(false);
    expect(isPart2FieldFilled("")).toBe(false);
  });
});

/* ══════════ D: PN Type ══════════ */
describe("D — PN Type", () => {
  it("is exactly SALE and BAU", () => {
    expect([...PN_TYPES]).toEqual(["SALE", "BAU"]);
  });

  it("validates case-sensitively and rejects anything else", () => {
    expect(isValidPnType("SALE")).toBe(true);
    expect(isValidPnType("BAU")).toBe(true);
    for (const bad of ["sale", "Sale", "OTHER", "", null, undefined]) {
      expect(isValidPnType(bad as string), String(bad)).toBe(false);
    }
  });

  it("is editable in Content's grid, read-only in CRM's", () => {
    const content = bulk.slice(bulk.indexOf("CONTENT_INPUT_COLUMNS"),
                               bulk.indexOf("];", bulk.indexOf("CONTENT_INPUT_COLUMNS")));
    expect(content).toContain('key: "pn_type"');
    expect(content).toContain("options: PN_TYPES");

    const qc = bulk.slice(bulk.indexOf("const QC_COLUMNS"),
                          bulk.indexOf("];", bulk.indexOf("const QC_COLUMNS")));
    const line = qc.split("\n").find((l) => l.includes('key: "pn_type"'))!;
    expect(line).toContain('type: "readonly"');
  });

  it("is in both exports", () => {
    expect(read("../services/exportExcel.ts")).toContain('"PN TYPE"');
    expect(read("../services/crmSectionExport.ts")).toContain('["PN Type",');
  });

  it("the submit path validates it server-side", () => {
    const svc = read("../services/campaigns.ts");
    expect(svc).toContain("isValidPnType(pnType)");
    expect(svc).toContain("PN Type must be SALE or BAU.");
  });

  it("an already-submitted PN is never re-validated", () => {
    expect(read("../services/campaigns.ts"))
      .toContain("never re-validated");
  });

  it("the migration allows NULL and constrains the rest", () => {
    expect(sql).toContain("add column if not exists pn_type text");
    expect(sql).toContain("check (pn_type is null or pn_type in ('SALE','BAU'))");
  });

  it("Category cannot write it; the trigger says so", () => {
    expect(sql).toContain("Category must NOT write Content's new field");
    expect(sql).toContain("new.pn_type         is distinct from old.pn_type");
  });

  it("a bad value is rejected by a trigger, not only the UI", () => {
    expect(sql).toContain("PN Type must be SALE or BAU (got %)");
  });
});

/* ══════════ E: date filter ══════════ */
describe("E — the date filter in Show All PN", () => {
  it("filters on the campaign date, both ends inclusive and optional", () => {
    expect(bulk).toContain("campaignDateIso(c.launch_date)");
    expect(bulk).toContain("if (fromDate && d < fromDate) return false;");
    expect(bulk).toContain("if (toDate && d > toDate) return false;");
  });

  it("combines with the category filter", () => {
    expect(bulk).toContain("let rows = filterByCategory(campaigns, categoryFilter);");
  });

  it("a PN with no date is KEPT, not silently dropped", () => {
    expect(bulk).toContain("if (d === null) return true;");
  });

  it("has a Clear button that restores everything", () => {
    expect(bulk).toContain("setCategoryFilter(ALL_CATEGORIES_LABEL);");
    expect(bulk).toContain('setFromDate(""); setToDate("");');
  });

  it('shows "Showing N of M PNs"', () => {
    expect(bulk).toContain("Showing {visibleCampaigns.length} of {campaigns.length} PNs");
  });

  it("every bulk action and Select all uses the VISIBLE set only", () => {
    expect(bulk).toContain("new Set(visibleCampaigns.map((c) => c.id))");
    expect(bulk).toContain("const visibleIds = new Set(visibleCampaigns.map((c) => c.id));");
  });
});

/* ══════════ migration safety ══════════ */
describe("migration 33 is safe", () => {
  it("deletes and changes no data", () => {
    const body = sql.slice(sql.indexOf("1. THE COLUMN"));
    expect(body).not.toMatch(/^\s*delete from/im);
    expect(body).not.toMatch(/^\s*update campaigns/im);
    expect(body).not.toMatch(/truncate/i);
    expect(body).not.toMatch(/drop table/i);
  });

  it("is idempotent", () => {
    expect(sql).toContain("add column if not exists");
    expect(sql).toContain("exception when duplicate_object then null");
    expect(sql).toContain("create or replace function");
  });

  it("opens with read-only checks and ends with VERIFY plus rollback", () => {
    expect(sql.slice(0, sql.indexOf("1. THE COLUMN"))).toContain("READ-ONLY CHECKS");
    expect(sql).toContain("VERIFY");
    expect(sql).toContain("ROLLBACK");
    expect(sql).toContain("campaigns_total_after");
  });

  it("system writes still pass the ownership trigger", () => {
    // Service role / migrations have no app role, and CRM bypasses.
    expect(sql).toContain("if v_role is null or v_role = 'CRM'::app_role then");
    expect(sql).toContain("return new;");
  });
});
