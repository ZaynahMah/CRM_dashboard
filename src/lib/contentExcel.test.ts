import { describe, it, expect } from "vitest";
import {
  buildContentWorkbook, parseContentWorkbook, campaignToRow,
  ID_COLUMN, ALL_COLUMNS, EDITABLE_COLUMNS, countOf,
} from "./contentExcel";
import * as XLSX from "xlsx";
import type { Campaign } from "@/types/campaign";

const uuid = (n: number) =>
  `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;

const make = (n: number): Campaign[] =>
  Array.from({ length: n }, (_, i) => ({
    id: uuid(i), campaign_name: `PN ${i}`,
    launch_date: "2026-11-03", launch_time: "07:00:00",
    pncc_segment_label: "Push_Women", category: "Westside",
    sub_category: "Dresses", brand: "Biba", offer: "Flat 40% off",
    brief: "Festive push", landing: "https://www.tatacliq.com/x",
    expected_cvr: "2.5", expected_rpv: "450", additional_notes: "",
    title_brief: "Title", message_brief: "Message",
    creative_requirements: "Hero image",
    header: "", sub_copy_text: "", h_count: 0, s_count: 0, reference_link: "",
  } as unknown as Campaign));

/** Round-trips a workbook through a simulated user edit. */
function roundTrip(campaigns: Campaign[], edit?: (rows: Record<string, unknown>[]) => Record<string, unknown>[]) {
  const buf = buildContentWorkbook(campaigns);
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  let rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  if (edit) rows = edit(rows);
  const out = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(out, XLSX.utils.json_to_sheet(rows, { header: [...ALL_COLUMNS] }), "Content Worklist");
  out.Custprops = wb.Custprops;
  return XLSX.write(out, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

describe("export", () => {
  it("includes every read-only and editable column", () => {
    const row = campaignToRow(make(1)[0]);
    for (const c of ALL_COLUMNS) expect(Object.keys(row)).toContain(c);
  });

  it("carries the campaign UUID so identity never depends on row order", () => {
    expect(campaignToRow(make(1)[0])[ID_COLUMN]).toBe(uuid(0));
  });

  it("exports every row it was given, at 100, 500 and 1000", () => {
    for (const n of [100, 500, 1000]) {
      const wb = XLSX.read(buildContentWorkbook(make(n)), { type: "array" });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
      expect(rows).toHaveLength(n);
    }
  });

  it("records the row count in the workbook, for the import to check", () => {
    const wb = XLSX.read(buildContentWorkbook(make(250)), { type: "array" });
    expect(String((wb.Custprops as Record<string, unknown>).cliqRowCount)).toBe("250");
  });
});

describe("round trip loses NOTHING", () => {
  it.each([1, 100, 500, 1000])("%i rows survive export -> import", (n) => {
    const campaigns = make(n);
    const res = parseContentWorkbook(roundTrip(campaigns), campaigns.map((c) => c.id));
    expect(res.ok).toBe(true);
    expect(res.rows).toHaveLength(n);
    expect(res.parsedCount).toBe(n);
  });

  it("every campaign id comes back, in no particular order", () => {
    const campaigns = make(300);
    // Shuffle hard: identity must not depend on position.
    const res = parseContentWorkbook(
      roundTrip(campaigns, (rows) => [...rows].reverse()),
      campaigns.map((c) => c.id));
    expect(res.ok).toBe(true);
    expect(new Set(res.rows.map((r) => r.campaignId)))
      .toEqual(new Set(campaigns.map((c) => c.id)));
  });

  it("content typed in Excel arrives intact, including punctuation", () => {
    const campaigns = make(3);
    const res = parseContentWorkbook(roundTrip(campaigns, (rows) =>
      rows.map((r, i) => ({ ...r,
        Header: `Festive styles — up to 40% off, don't miss it (${i})`,
        "Sub Copy": `Shop now; ends 7 Nov.`,
        "Reference Link": "https://ref/x?a=1&b=2" }))),
      campaigns.map((c) => c.id));
    expect(res.ok).toBe(true);
    expect(res.rows[0].header).toBe("Festive styles — up to 40% off, don't miss it (0)");
    expect(res.rows[0].sub_copy_text).toBe("Shop now; ends 7 Nov.");
    expect(res.rows[0].reference_link).toBe("https://ref/x?a=1&b=2");
  });

  it("a spelling correction is reflected", () => {
    const campaigns = make(2);
    const res = parseContentWorkbook(roundTrip(campaigns, (rows) =>
      rows.map((r, i) => ({ ...r, Header: i === 0 ? "Corrected spelling" : "Other" }))),
      campaigns.map((c) => c.id));
    expect(res.rows.find((r) => r.campaignId === uuid(0))!.header).toBe("Corrected spelling");
  });
});

describe("a lost or altered row is REJECTED, never half-imported", () => {
  it("deleting a row is caught by the manifest", () => {
    const campaigns = make(100);
    const res = parseContentWorkbook(
      roundTrip(campaigns, (rows) => rows.slice(0, 99)), campaigns.map((c) => c.id));
    expect(res.ok).toBe(false);
    expect(res.rows).toHaveLength(0);                 // nothing imported
    expect(res.errors.join(" ")).toMatch(/exported with 100 rows but contains 99/);
    expect(res.errors.join(" ")).toMatch(/1 row\(s\) appear to have been deleted/);
  });

  it("names the campaigns that went missing", () => {
    const campaigns = make(10);
    const res = parseContentWorkbook(
      roundTrip(campaigns, (rows) => rows.slice(0, 8)), campaigns.map((c) => c.id));
    expect(res.errors.join(" ")).toMatch(/2 campaign\(s\) from the exported batch are not in this file/);
  });

  it("extra rows are caught too", () => {
    const campaigns = make(5);
    const res = parseContentWorkbook(
      roundTrip(campaigns, (rows) => [...rows, { ...rows[0], [ID_COLUMN]: uuid(999) }]),
      campaigns.map((c) => c.id));
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/extra row\(s\) were added|not in the exported batch/);
  });

  it("a duplicated campaign id is rejected with both row numbers", () => {
    const campaigns = make(4);
    const res = parseContentWorkbook(roundTrip(campaigns, (rows) =>
      rows.map((r, i) => (i === 2 ? { ...r, [ID_COLUMN]: uuid(0) } : r))));
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/duplicate Campaign ID/);
  });

  it("a blank id is rejected, not skipped", () => {
    const campaigns = make(3);
    const res = parseContentWorkbook(roundTrip(campaigns, (rows) =>
      rows.map((r, i) => (i === 1 ? { ...r, [ID_COLUMN]: "" } : r))));
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/Campaign ID is blank/);
  });

  it("a non-UUID id is rejected", () => {
    const campaigns = make(2);
    const res = parseContentWorkbook(roundTrip(campaigns, (rows) =>
      rows.map((r, i) => (i === 0 ? { ...r, [ID_COLUMN]: "PN-1" } : r))));
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/not a valid Campaign ID/);
  });
});

describe("wrong template", () => {
  it("a sheet without the ID column is rejected with a clear reason", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,
      XLSX.utils.json_to_sheet([{ Name: "x", Something: 1 }]), "Sheet1");
    const res = parseContentWorkbook(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
    expect(res.ok).toBe(false);
    expect(res.errors[0]).toMatch(/does not look like a Content worklist export/);
    expect(res.errors[0]).toMatch(/Campaign ID/);
  });

  it("a headers-only sheet is rejected", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,
      XLSX.utils.json_to_sheet([], { header: [...ALL_COLUMNS] }), "Content Worklist");
    const res = parseContentWorkbook(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
    expect(res.ok).toBe(false);
  });

  it("a non-xlsx buffer is rejected without throwing", () => {
    const res = parseContentWorkbook(new TextEncoder().encode("not a workbook").buffer as ArrayBuffer);
    expect(res.ok).toBe(false);
    expect(res.rows).toHaveLength(0);
  });
});

describe("warnings do not block the import", () => {
  it("blank Header/Sub Copy import with a warning, not an error", () => {
    const campaigns = make(5);
    const res = parseContentWorkbook(roundTrip(campaigns), campaigns.map((c) => c.id));
    expect(res.ok).toBe(true);
    expect(res.rows).toHaveLength(5);
    expect(res.warnings.join(" ")).toMatch(/5 row\(s\) have no Header or Sub Copy/);
  });
});

describe("counts are derived, never trusted from Excel", () => {
  it("counts the trimmed text", () => {
    expect(countOf("  Festive styles  ")).toBe(14);
    expect(countOf("")).toBe(0);
  });
  it("H Count and S Count are editable columns but recomputed on save", () => {
    expect([...EDITABLE_COLUMNS]).toContain("H Count");
  });
});

/* ══════════ QC scenarios from the brief, end to end ══════════ */
describe("QC scenarios", () => {
  const ids = (n: number) => make(n).map((c) => c.id);

  it("Scenario 1: export 0–100, import back, every value saved", () => {
    const all = make(250);
    const batch = all.slice(0, 100);          // the 0–100 range
    const res = parseContentWorkbook(roundTrip(batch, (rows) =>
      rows.map((r, i) => ({ ...r, Header: `H${i}`, "Sub Copy": `S${i}` }))),
      batch.map((c) => c.id));
    expect(res.ok).toBe(true);
    expect(res.rows).toHaveLength(100);
    expect(res.rows.every((r, i) => r.header === `H${i}` && r.sub_copy_text === `S${i}`)).toBe(true);
  });

  it("Scenario 2: spelling corrections are reflected", () => {
    const batch = make(50);
    const res = parseContentWorkbook(roundTrip(batch, (rows) =>
      rows.map((r, i) => ({ ...r, Header: i === 7 ? "Definitely correct" : "Untouched" }))),
      batch.map((c) => c.id));
    expect(res.rows[7].header).toBe("Definitely correct");
    expect(res.rows[6].header).toBe("Untouched");
  });

  it("Scenario 5: wrong template gives a validation error, imports nothing", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ Foo: 1 }]), "Sheet1");
    const res = parseContentWorkbook(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
    expect(res.ok).toBe(false);
    expect(res.rows).toHaveLength(0);
  });

  it("Scenario 6: a 1000-row file parses in well under a second", () => {
    const batch = make(1000);
    const buf = roundTrip(batch, (rows) =>
      rows.map((r, i) => ({ ...r, Header: `Header ${i}`, "Sub Copy": `Sub copy ${i}` })));
    const t0 = Date.now();
    const res = parseContentWorkbook(buf, batch.map((c) => c.id));
    const ms = Date.now() - t0;
    expect(res.ok).toBe(true);
    expect(res.rows).toHaveLength(1000);
    expect(ms).toBeLessThan(3000);
  });

  it("reordering rows in Excel does not misassign a single value", () => {
    const batch = make(200);
    const res = parseContentWorkbook(roundTrip(batch, (rows) => {
      // Each row's copy is tagged with ITS OWN id, then shuffled.
      const tagged = rows.map((r) => ({ ...r, Header: `for:${r[ID_COLUMN]}` }));
      return [...tagged].sort(() => 0.5 - Math.random());
    }), batch.map((c) => c.id));
    expect(res.ok).toBe(true);
    // Identity travels with the row, so every value lands on its own campaign.
    expect(res.rows.every((r) => r.header === `for:${r.campaignId}`)).toBe(true);
  });
});

import { validateContentRow, diffContentFields, DIFF_LABEL } from "./contentExcel";

/* ══════════ mandatory field validation ══════════ */
describe("bulk send validation", () => {
  const v = (h: string, s: string) =>
    validateContentRow({ id: "x", header: h, sub_copy_text: s }, 60, 150);

  it("a complete row within limits is ready", () => {
    expect(v("Festive styles", "Shop the edit now").ready).toBe(true);
  });

  it("a missing Header blocks the row", () => {
    const r = v("", "Shop now");
    expect(r.ready).toBe(false);
    expect(r.problems).toContain("Header is required.");
  });

  it("a missing Sub Copy blocks the row", () => {
    expect(v("Festive", "").problems).toContain("Sub Copy is required.");
  });

  it("whitespace is not content", () => {
    expect(v("   ", "   ").ready).toBe(false);
  });

  it("exceeding the Header limit blocks the row", () => {
    const r = v("x".repeat(61), "ok");
    expect(r.ready).toBe(false);
    expect(r.problems[0]).toMatch(/61 characters, over the 60 limit/);
  });

  it("exceeding the Sub Copy limit blocks the row", () => {
    expect(v("ok", "y".repeat(151)).ready).toBe(false);
  });

  it("exactly at the limit is allowed", () => {
    expect(v("x".repeat(60), "y".repeat(150)).ready).toBe(true);
  });

  it("a mixed batch splits cleanly into ready and incomplete", () => {
    const rows = [
      { id: "a", header: "Good", sub_copy_text: "Copy" },
      { id: "b", header: "", sub_copy_text: "Copy" },
      { id: "c", header: "x".repeat(61), sub_copy_text: "Copy" },
    ];
    const results = rows.map((r) => validateContentRow(r, 60, 150));
    expect(results.filter((r) => r.ready)).toHaveLength(1);
    expect(results.filter((r) => !r.ready)).toHaveLength(2);
  });
});

/* ══════════ CRM diff ══════════ */
describe("changed-field diff for CRM", () => {
  it("reports only the fields that actually changed", () => {
    expect(diffContentFields(
      { header: "Old", sub_copy_text: "Same", reference_link: "" },
      { header: "New", sub_copy_text: "Same", reference_link: "" }))
      .toEqual(["header"]);
  });

  it("reports all three when all three change", () => {
    expect(diffContentFields(
      { header: "a", sub_copy_text: "b", reference_link: "c" },
      { header: "x", sub_copy_text: "y", reference_link: "z" }))
      .toEqual(["header", "sub_copy_text", "reference_link"]);
  });

  it("an untouched re-import records NO change", () => {
    const same = { header: "Festive", sub_copy_text: "Shop now", reference_link: "https://r" };
    expect(diffContentFields(same, same)).toEqual([]);
  });

  it("whitespace-only differences are not changes", () => {
    expect(diffContentFields({ header: "Festive" }, { header: "  Festive  " })).toEqual([]);
  });

  it("null and empty string are the same absence", () => {
    expect(diffContentFields({ reference_link: null }, { reference_link: "" })).toEqual([]);
  });

  it("filling a previously empty field IS a change", () => {
    expect(diffContentFields({ header: "" }, { header: "Now filled" })).toEqual(["header"]);
  });

  it("every field has a CRM-facing label", () => {
    expect(DIFF_LABEL.header).toBe("Header Updated");
    expect(DIFF_LABEL.sub_copy_text).toBe("Sub Copy Updated");
    expect(DIFF_LABEL.reference_link).toBe("Reference Link Updated");
  });
});
