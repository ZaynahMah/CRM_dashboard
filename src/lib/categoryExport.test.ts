import { describe, it, expect } from "vitest";
import {
  categorySubmittedCsv, categoryFileName, isSubmittedByCategory,
} from "@/services/categoryExport";
import type { Campaign } from "@/types/campaign";

const pn = (o: Partial<Campaign> = {}) => ({
  id: "c1", campaign_name: "Festive PN", launch_date: "2026-11-05",
  launch_time: "19:30:00", slot_label: "3", slot_number: 3, slot_type: "STANDARD",
  pncc_segment_label: "Push_Women", category: "Westside",
  sub_category: "Dresses", brand: "Biba", offer: "Flat 40%",
  brief: "Festive push", landing: "https://www.tatacliq.com/x",
  expected_cvr: "2.5", expected_rpv: "450", additional_notes: "note",
  category_status: "LOCKED", defaulted_at: null, submitted_at: null,
  ...o,
}) as unknown as Campaign;

const head = (csv: string) => csv.split("\n")[0].split(",");
const cells = (csv: string, i = 1) => csv.split("\n")[i].split(",");

describe("only submitted rows are exported", () => {
  it("LOCKED and SUBMITTED count as submitted", () => {
    expect(isSubmittedByCategory(pn({ category_status: "LOCKED" }))).toBe(true);
    expect(isSubmittedByCategory(pn({ category_status: "SUBMITTED" }))).toBe(true);
  });

  it.each(["EMPTY", "DRAFT"])("%s is excluded", (st) => {
    expect(isSubmittedByCategory(pn({ category_status: st } as Partial<Campaign>))).toBe(false);
  });

  it("a DEFAULTED row is excluded even if locked", () => {
    expect(isSubmittedByCategory(pn({
      category_status: "LOCKED", defaulted_at: "2026-10-30T00:00:00Z" }))).toBe(false);
  });

  it("a mixed set exports only the submitted ones", () => {
    const rows = [
      pn({ id: "a", category_status: "LOCKED" }),
      pn({ id: "b", category_status: "DRAFT" }),
      pn({ id: "c", category_status: "EMPTY" }),
      pn({ id: "d", category_status: "LOCKED", defaulted_at: "2026-10-30T00:00:00Z" }),
    ].filter(isSubmittedByCategory);
    expect(rows.map((c) => c.id)).toEqual(["a"]);
  });
});

describe("columns and formatting", () => {
  const csv = categorySubmittedCsv([pn()]);

  it("uses readable headers in the dashboard's order", () => {
    expect(head(csv)).toEqual([
      "Date", "Time", "Slot", "Segment", "Category",
      "Campaign Name", "Sub Category", "Brand", "Offer", "Brief", "Landing",
      "Exp. CVR", "Exp. RPV", "Comment",
      "Status", "Submitted By", "Submitted At",
    ]);
  });

  it("no database field name leaks into a header", () => {
    for (const h of head(csv)) expect(h).not.toMatch(/_/);
  });

  it("dates are DD-MM-YYYY", () => {
    expect(cells(csv)[0]).toBe("05-11-2026");
  });

  it("Slot is the uploaded label, never Standard", () => {
    expect(cells(csv)[2]).toBe("3");
    expect(csv).not.toContain("Standard");
  });

  it("falls back to slot_number for old rows", () => {
    const old = categorySubmittedCsv([pn({ slot_label: null, slot_number: 9 })]);
    expect(cells(old)[2]).toBe("9");
  });

  it("values match the dashboard", () => {
    const c = cells(csv), h = head(csv);
    expect(c[h.indexOf("Brand")]).toBe("Biba");
    expect(c[h.indexOf("Sub Category")]).toBe("Dresses");
    expect(c[h.indexOf("Exp. RPV")]).toBe("450");
  });

  it("an empty field stays empty", () => {
    const e = categorySubmittedCsv([pn({ brief: null, additional_notes: null })]);
    const h = head(e), c = cells(e);
    expect(c[h.indexOf("Brief")]).toBe("");
    expect(c[h.indexOf("Comment")]).toBe("");
  });

  it("commas and quotes do not break the columns", () => {
    const c = categorySubmittedCsv([pn({ brand: 'Nike, Adidas "Pro"' })]);
    expect(c).toContain('"Nike, Adidas ""Pro"""');
  });
});

describe("the file name", () => {
  it("is <Category>_Submitted_PNs_<DD-MM-YYYY>", () => {
    expect(categoryFileName([pn()]))
      .toMatch(/^Westside_Submitted_PNs_\d{2}-\d{2}-\d{4}\.csv$/);
  });

  it("says All_Categories rather than picking one from a mixed set", () => {
    expect(categoryFileName([pn({ category: "Westside" }), pn({ category: "Home" })]))
      .toMatch(/^All_Categories_/);
  });

  it("makes an awkward category name safe for a file system", () => {
    expect(categoryFileName([pn({ category: "Silver/Fashion Jew" })]))
      .toMatch(/^Silver_Fashion_Jew_/);
  });
});

describe("the export is read-only", () => {
  it("does not mutate the campaigns it is given", () => {
    const c = pn();
    const before = JSON.stringify(c);
    categorySubmittedCsv([c]);
    expect(JSON.stringify(c)).toBe(before);
  });
});
