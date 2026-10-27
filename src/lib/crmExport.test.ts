import { describe, it, expect } from "vitest";
import {
  incomingFromCategoryCsv, incomingFromContentCsv, sectionStatus, sectionFileName,
} from "@/services/crmSectionExport";
import type { Campaign } from "@/types/campaign";

const pn = (o: Partial<Campaign> = {}) => ({
  id: "c1", campaign_name: "PN A", is_crm_self: false,
  launch_date: "2026-11-05", launch_time: "07:00:00",
  slot_label: "1", slot_number: 1, slot_type: "STANDARD",
  pncc_segment_label: "Push_Women", category: "Westside",
  sub_category: "Dresses", brand: "Biba", offer: "Flat 40%",
  brief: "Festive push", landing: "https://www.tatacliq.com/x",
  expected_cvr: "2.5", expected_rpv: "450", additional_notes: "note",
  category_status: "LOCKED", crm_status: "AWAITING_REVIEW",
  content_status: "NOT_ASSIGNED", qc_status: "PENDING",
  calendar_status: "NOT_UPDATED", pn_template: "Basic",
  title_brief: "T", message_brief: "M", creative_requirements: "Hero",
  defaulted_at: null, default_reason: null,
  header: null, sub_copy_text: null, h_count: null, s_count: null,
  reference_link: null, creative_link: null, submitted_at: null,
  ...o,
}) as unknown as Campaign;

const rows = (csv: string) => csv.split("\n");
const head = (csv: string) => rows(csv)[0].split(",");

describe("Incoming Inputs From Category export", () => {
  const csv = incomingFromCategoryCsv([pn()]);

  it("starts with the specified column order", () => {
    expect(head(csv).slice(0, 18)).toEqual([
      "Status", "Deadline", "Date", "Time", "Slot", "Segment", "Category",
      "Campaign Name", "Sub Category", "Brand", "Offer", "Brief", "Landing",
      "Exp. CVR", "Exp. RPV", "Comments", "Filled by", "Submitted at",
    ]);
  });

  it("includes every CRM Part 2 field", () => {
    for (const h of ["PN Template", "Title Brief", "Message Brief",
                     "Creative Requirements", "Slot Type", "PNCC Segment", "PNCC Category"]) {
      expect(head(csv)).toContain(h);
    }
  });

  it("Slot is the uploaded label, never Standard", () => {
    const cells = rows(csv)[1].split(",");
    expect(cells[head(csv).indexOf("Slot")]).toBe("1");
    expect(rows(csv)[1]).not.toMatch(/,Standard,/);
  });

  it("falls back to slot_number only for old rows", () => {
    const old = incomingFromCategoryCsv([pn({ slot_label: null, slot_number: 7 })]);
    expect(rows(old)[1].split(",")[head(old).indexOf("Slot")]).toBe("7");
  });

  it("the deadline is the PN's own date minus 7", () => {
    expect(rows(csv)[1].split(",")[1]).toBe("29 Oct");
  });

  it("labels all three sub-sections", () => {
    // Pending CRM Input = Category submitted (LOCKED), CRM Part 2 not done.
    expect(sectionStatus(pn({ category_status: "LOCKED", pn_template: null }))).toBe("Pending CRM Input");
    expect(sectionStatus(pn({ category_status: "LOCKED", pn_template: "Basic" }))).toBe("Completed CRM Input");
    expect(sectionStatus(pn({ defaulted_at: "2026-10-30T00:00:00Z", pn_template: null }))).toBe("Defaulted");
  });

  it("a Defaulted row keeps the Category fields BLANK — nothing is filled in", () => {
    const d = incomingFromCategoryCsv([pn({
      defaulted_at: "2026-10-30T00:00:00Z", pn_template: null,
      sub_category: null, brand: null, offer: null, brief: null,
      landing: null, expected_cvr: null, expected_rpv: null,
    })]);
    const h = head(d), cells = rows(d)[1].split(",");
    for (const col of ["Sub Category", "Brand", "Offer", "Brief", "Landing",
                       "Exp. CVR", "Exp. RPV"]) {
      expect(cells[h.indexOf(col)], `${col} should be blank`).toBe("");
    }
    expect(cells[0]).toBe("Defaulted");
  });

  it("an empty value stays empty — nothing is invented", () => {
    const e = incomingFromCategoryCsv([pn({ brand: null, offer: null })]);
    const h = head(e), cells = rows(e)[1].split(",");
    expect(cells[h.indexOf("Brand")]).toBe("");
    expect(cells[h.indexOf("Offer")]).toBe("");
  });

  it("commas and quotes in text do not break the columns", () => {
    const c = incomingFromCategoryCsv([pn({ brand: 'Nike, Adidas "Pro"' })]);
    expect(c).toContain('"Nike, Adidas ""Pro"""');
  });
});

describe("Incoming From Content — Category-led export", () => {
  const csv = incomingFromContentCsv([pn({
    header: "Festive styles", sub_copy_text: "Shop now", h_count: 14, s_count: 8,
    reference_link: "https://ref", creative_link: "https://cdn/x.png",
    content_status: "SUBMITTED",
  })]);

  it("has every base column plus the Content fields", () => {
    const h = head(csv);
    expect(h.slice(0, 5)).toEqual(["Status", "Deadline", "Date", "Time", "Slot"]);
    for (const c of ["Header", "Sub Copy", "H Count", "S Count",
                     "Reference Link", "Creative Link", "Content Status",
                     "Content Submitted At"]) {
      expect(h).toContain(c);
    }
  });

  it("carries the Content values", () => {
    const h = head(csv), cells = rows(csv)[1].split(",");
    expect(cells[h.indexOf("Header")]).toBe("Festive styles");
    expect(cells[h.indexOf("Content Status")]).toBe("SUBMITTED");
  });

  it("is wider than the Category export", () => {
    expect(head(csv).length).toBeGreaterThan(head(incomingFromCategoryCsv([pn()])).length);
  });
});

describe("export mechanics", () => {
  it("names the file CRM_<section>_<YYYY-MM-DD>", () => {
    expect(sectionFileName("Incoming_From_Category"))
      .toMatch(/^CRM_Incoming_From_Category_\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it("exports exactly the rows it is given, so the count matches the button", () => {
    const three = incomingFromCategoryCsv([pn({ id: "a" }), pn({ id: "b" }), pn({ id: "c" })]);
    expect(rows(three)).toHaveLength(4);   // header + 3
  });

  it("an empty set still produces a valid header-only file", () => {
    expect(rows(incomingFromCategoryCsv([]))).toHaveLength(1);
  });

  it("the export is read-only — it only reads from the campaign", () => {
    const before = JSON.stringify(pn());
    const c = pn();
    incomingFromCategoryCsv([c]);
    expect(JSON.stringify(c)).toBe(before);
  });
});

describe("Change 3 — the CRM review columns", () => {
  const src = require("fs").readFileSync(
    require("path").join(__dirname, "../components/BulkWorkspace.tsx"), "utf8");
  const block = src.slice(src.indexOf("const CATEGORY_COLUMNS"),
                          src.indexOf("];", src.indexOf("const CATEGORY_COLUMNS")));

  it("is in the specified order", () => {
    const labels = [...block.matchAll(/label: "([^"]+)"/g)].map((m) => m[1]);
    expect(labels).toEqual([
      "Date", "Time", "Category", "Segment", "Slot", "Sub Category", "Brand",
      "Offer", "Landing", "Exp. CVR", "Exp. RPV", "Category Brief",
      "Title Brief", "Message Brief", "PN Template", "Creative Reqs",
    ]);
  });

  it("Campaign Name is removed from THIS view only", () => {
    expect(block).not.toContain('key: "campaign_name"');
    // Still present in Category's own Show All PN.
    const catBlock = src.slice(src.indexOf("const CATEGORY_INPUT_COLUMNS"),
                               src.indexOf("];", src.indexOf("const CATEGORY_INPUT_COLUMNS")));
    expect(catBlock).toContain('key: "campaign_name"');
  });

  it("Category, Segment and Slot are read-only", () => {
    for (const k of ["category", "pncc_segment_label", "slot_label"]) {
      const line = block.split("\n").find((l: string) => l.includes(`key: "${k}"`))!;
      expect(line, `${k} must be read-only`).toContain('type: "readonly"');
    }
  });

  it("Category Brief is read-only for CRM", () => {
    const line = block.split("\n").find((l: string) => l.includes('key: "brief"'))!;
    expect(line).toContain('type: "readonly"');
    expect(line).toContain("longText: true");
  });

  it("the four CRM fields stay editable", () => {
    for (const k of ["title_brief", "message_brief", "pn_template", "creative_requirements"]) {
      const line = block.split("\n").find((l: string) => l.includes(`key: "${k}"`))!;
      expect(line, `${k} must stay editable`).not.toContain('type: "readonly"');
    }
  });

  it("long briefs wrap rather than being clipped", () => {
    expect(src).toContain('mode === "CATEGORY_REVIEW"');
  });
});
