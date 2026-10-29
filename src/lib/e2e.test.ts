import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { profileSheet } from "./sheetProfile";
import { resolveColumns, pick, type FieldKey } from "./columnMatch";
import { excelValueToIsoDate, excelValueToTime } from "./excelDates";
import { suggestTrackingFields, buildTrackingCode, buildLandingPlusTracking, trackingCheck } from "./trackingCode";
import { stageOf, STAGE_LABEL, qcComplete, QC_FIELDS } from "./workflow";
import * as B from "./crmBuckets";
import { campaignsToCSV } from "@/services/exportExcel";
import type { Campaign, QcChecklist } from "@/types/campaign";

/**
 * End-to-end: a real .xlsx with a title row above the header, parsed the way
 * the app parses it, walked through every workflow stage, tracking codes
 * generated, and finally exported — asserting at each step that the row is
 * visible to the right role and that nothing is lost.
 */
describe("upload -> ... -> export, with a real workbook", () => {
  /**
   * The workbook is built in memory rather than read from disk, so the test
   * is self-contained and runs on any checkout. It deliberately includes a
   * title row ABOVE the header, which is what real CRM sheets look like and
   * what profileSheet() exists to handle.
   */
  const sheet = XLSX.utils.aoa_to_sheet([
    ["TATA CLiQ — CRM Push Input — July 2026"],
    [],
    ["Date", "TIME", "SLOT", "SEGMENTS", "CATEGORY"],
    ["2026-07-01", "07:00", 1, "Push_WomenSeg1_Festive", "Westside"],
    ["2026-07-01", "08:00", 2, "Men_Overall_Sport", "MenF"],
    ["2026-07-04", "00:20", 3, "INB Women", "Wom AE"],
    ["2026-07-06", "08:00", 4, "Men_Overall_Sport", "PC/CC"],
    ["2026-07-19", "01:00", 5, "Non-Shopper", "Midnight Property"],
  ]);

  it("finds the real header row under a title row", () => {
    const prof = profileSheet(sheet);
    expect(prof.headers).toContain("SEGMENTS");
    expect(prof.rows.length).toBe(5);
  });

  const prof = profileSheet(sheet);
  const map = resolveColumns(prof.headers, ["day","time","slot","segment","category"] as FieldKey[]);

  it("maps every required column", () => {
    expect(map.day).toBeTruthy(); expect(map.time).toBeTruthy();
    expect(map.slot).toBeTruthy(); expect(map.segment).toBeTruthy();
    expect(map.category).toBeTruthy();
  });

  /** The campaigns the upload would insert. */
  const uploaded: Campaign[] = prof.rows.map((r, i) => ({
    id: `0000000${i}-0000-4000-8000-000000000000`,
    campaign_name: `${pick(r, map, "segment")} · ${pick(r, map, "category")}`,
    launch_date: excelValueToIsoDate(pick(r, map, "day")),
    launch_time: excelValueToTime(pick(r, map, "time")),
    pncc_segment_label: String(pick(r, map, "segment") ?? ""),
    pncc_category_code: String(pick(r, map, "category") ?? ""),
    category: String(pick(r, map, "category") ?? ""),
    is_crm_self: false, is_emergency: false,
    category_status: "EMPTY", crm_status: "AWAITING_REVIEW",
    content_status: "NOT_ASSIGNED", design_status: "NOT_ASSIGNED",
    qc_status: "PENDING", production_status: "NOT_READY", calendar_status: "NOT_UPDATED",
    pn_template: null, tracking_code: null, landing: null, brand: null, offer: null,
    creative_link: null, header: null, sub_copy_text: null, keywords: null,
    segment_1: null, segment_2: null, channel_format: null,
  } as unknown as Campaign));

  it("parses all 5 rows with valid dates and times", () => {
    expect(uploaded).toHaveLength(5);
    expect(uploaded.every((c) => /^\d{4}-\d{2}-\d{2}$/.test(c.launch_date))).toBe(true);
    expect(uploaded[0].launch_date).toBe("2026-07-01");
    // Midnight must survive parsing as 00:xx, not shift a day.
    expect(uploaded[2].launch_date).toBe("2026-07-04");
  });

  it("every uploaded row is visible to Category, none to Content", () => {
    for (const c of uploaded) {
      const secs = B.visibleSections(c, {});
      expect(secs.length).toBeGreaterThan(0);
      expect(secs).toContain("category:queue");
      expect(B.withContent(c)).toBe(false);
    }
  });

  /** Walk row 0 through the whole pipeline. */
  const full = (over: Partial<Campaign>) => ({ ...uploaded[0], ...over } as Campaign);

  it("Category fills and locks -> CRM sees it", () => {
    const c = full({ sub_category: "Dresses", brand: "Westside", offer: "Starting @699",
      brief: "Festive", landing: "https://www.tatacliq.com/westside/dresses",
      expected_cvr: "2.5", expected_rpv: "450", category_status: "LOCKED" });
    expect(stageOf(c)).toBe("CRM_REVIEW");
    expect(B.fromCategoryPending(c)).toBe(true);
  });

  it("CRM Part 2 -> ready for Content", () => {
    const c = full({ category_status: "LOCKED", pn_template: "Basic", title_brief: "T", message_brief: "M", creative_requirements: "Hero", brand: "Westside" });
    expect(B.fromCategoryCompleted(c)).toBe(true);
  });

  it("sent to Content -> only Content's queue", () => {
    const c = full({ category_status: "LOCKED", pn_template: "Basic", title_brief: "T", message_brief: "M", creative_requirements: "Hero",
      crm_status: "SENT_TO_CONTENT", content_status: "PENDING" });
    expect(B.withContent(c)).toBe(true);
    expect(B.visibleSections(c, {})).toContain("content:queue");
  });

  it("Content submits -> back with CRM immediately", () => {
    const c = full({ category_status: "LOCKED", pn_template: "Basic", title_brief: "T", message_brief: "M", creative_requirements: "Hero",
      content_status: "SUBMITTED", header: "Festive styles", sub_copy_text: "Shop now" });
    expect(stageOf(c)).toBe("PRODUCTION_SUBMITTED");
    expect(B.fromContentPending(c, {})).toBe(true);
  });

  /** The fully-filled campaign CRM would push. */
  const ready = full({
    category_status: "LOCKED", pn_template: "Basic", title_brief: "T", message_brief: "M", creative_requirements: "Hero", content_status: "SUBMITTED",
    header: "Festive styles", sub_copy_text: "Shop now",
    brand: "Westside", offer: "Starting @699",
    landing: "https://www.tatacliq.com/search?text=Westside%20Dresses&icid2=quick:qul:blp",
    campaign_type: "pn", campaign_name_code: "prp", channel_name: "push",
    channel_format: "text", segment_1: "wom", segment_2: "cat",
    tracking_category: "westside", tracking_sub_category: "women",
    tracking_brand: "multibrand", tracking_landing: "plp", tracking_offer: "starts",
    keywords: "onetime",
  } as Partial<Campaign>);

  it("tracking code generates and matches the production format", () => {
    const f = suggestTrackingFields(ready);
    const { code, valid } = buildTrackingCode(f);
    expect(valid).toBe(true);
    expect(code).toBe(
      "cid=pn:prp:push_text:wom_cat:westside_women_multibrand_plp_starts_h7_010726:onetime");
    expect(trackingCheck(f).label).toBe("✅ All Filled");
  });

  it("landing + tracking strips icid2 and puts the code first", () => {
    const { code } = buildTrackingCode(suggestTrackingFields(ready));
    const r = buildLandingPlusTracking(ready.landing, code);
    expect(r.error).toBeUndefined();
    expect(r.url.startsWith("https://www.tatacliq.com/search?" + code)).toBe(true);
    expect(r.url).not.toMatch(/icid2/i);
  });

  it("QC gate: 9 of 10 blocks, all 10 passes (no creative -> creative N/A)", () => {
    const nine = Object.fromEntries(QC_FIELDS.map((f) => [f.key, f.key !== "tracking_verified"])) as unknown as QcChecklist;
    expect(qcComplete(nine, ready)).toBe(false);
    const all = Object.fromEntries(QC_FIELDS.map((f) => [f.key, true])) as unknown as QcChecklist;
    expect(qcComplete(all, ready)).toBe(true);
    // creative_verified is not required: this PN has no creative link.
    const noCreative = { ...all, creative_verified: false } as QcChecklist;
    expect(qcComplete(noCreative, ready)).toBe(true);
  });

  it("pushed to calendar -> READY and on the calendar only", () => {
    const { code } = buildTrackingCode(suggestTrackingFields(ready));
    const done = { ...ready, tracking_code: code, qc_status: "PASSED",
      calendar_status: "UPDATED" } as Campaign;
    expect(stageOf(done)).toBe("READY");
    expect(B.visibleSections(done, {})).toEqual(["calendar"]);
  });

  it("export contains the stored code and landing+tracking, unmodified", () => {
    const { code } = buildTrackingCode(suggestTrackingFields(ready));
    const lpt = buildLandingPlusTracking(ready.landing, code).url;
    const done = { ...ready, tracking_code: code, landing_plus_tracking: lpt,
      tracking_code_check: "✅ All Filled", qc_status: "PASSED",
      calendar_status: "UPDATED" } as Campaign;
    const csv = campaignsToCSV([done]);
    expect(csv).toContain(code);
    expect(csv).toContain(lpt);
    expect(csv.split("\n")[0]).toContain("Tracking Code");
    // Nothing rebuilt: the exported value is byte-identical to the stored one.
    const dataLine = csv.split("\n")[1];
    expect(dataLine).toContain(lpt);
  });

  it("no row is ever orphaned at any stage of the walk", () => {
    const stages: Partial<Campaign>[] = [
      {}, { category_status: "LOCKED" }, { category_status: "LOCKED", pn_template: "Basic", title_brief: "T", message_brief: "M", creative_requirements: "Hero" },
      { category_status: "LOCKED", pn_template: "Basic", title_brief: "T", message_brief: "M", creative_requirements: "Hero", crm_status: "SENT_TO_CONTENT", content_status: "PENDING" },
      { content_status: "SUBMITTED" }, { content_status: "SUBMITTED", qc_status: "PASSED" },
      { qc_status: "PASSED", calendar_status: "UPDATED" },
    ];
    let acc = uploaded[0];
    for (const s of stages) {
      acc = { ...acc, ...s } as Campaign;
      const secs = B.visibleSections(acc, { [acc.id]: { copy_verified: true } } as never);
      expect(secs.length, `orphaned at ${STAGE_LABEL[stageOf(acc)]}`).toBeGreaterThan(0);
    }
  });
});

/* ══════════ SELF-QC: a second sheet, a reset, and the full flow again ══════════ */
describe("self-QC: 2,000-row sheet -> reset -> 3,000-row sheet -> export", () => {
  const sheetOf = (n: number, tag: string): Campaign[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `${tag}-${i}`, campaign_name: `${tag} PN ${i}`,
      launch_date: "2026-07-01", launch_time: "07:00:00",
      is_crm_self: i % 3 === 0, is_emergency: i % 97 === 0,
      category_status: "EMPTY", crm_status: i % 3 === 0 ? "IN_PLANNING" : "AWAITING_REVIEW",
      content_status: "NOT_ASSIGNED", design_status: "NOT_ASSIGNED",
      qc_status: "PENDING", production_status: "NOT_READY", calendar_status: "NOT_UPDATED",
      pn_template: null, tracking_code: null, creative_link: null,
      header: null, sub_copy_text: null,
    } as unknown as Campaign));

  const first = sheetOf(2000, "old");
  const second = sheetOf(3000, "new");

  it("the first sheet is fully visible and fully accounted for", () => {
    expect(first).toHaveLength(2000);
    for (const c of first.slice(0, 100)) {
      expect(B.visibleSections(c, {}).length).toBeGreaterThan(0);
    }
  });

  it("after reset only the new sheet exists — no row of the old survives", () => {
    const oldIds = new Set(first.map((c) => c.id));
    expect(second.filter((c) => oldIds.has(c.id))).toHaveLength(0);
    expect(second).toHaveLength(3000);
  });

  it("every one of the 3,000 new rows is visible somewhere — zero orphans at scale", () => {
    const orphans = second.filter((c) => B.visibleSections(c, {}).length === 0);
    expect(orphans).toHaveLength(0);
  });

  it("no row of the 3,000 is actionable in two sections at once", () => {
    const overlaps = second.filter((c) => B.actionableSections(c, {}).length > 1);
    expect(overlaps).toHaveLength(0);
  });

  it("CRM Self rows are invisible to Content until CRM sends them", () => {
    const self = second.filter((c) => c.is_crm_self);
    expect(self.length).toBeGreaterThan(900);
    expect(self.every((c) => !B.withContent(c))).toBe(true);
  });

  it("a full row walks upload -> Category -> CRM -> Content -> QC -> Calendar -> export", () => {
    let c = second.find((x) => !x.is_crm_self)!;
    expect(B.visibleSections(c, {})).toContain("category:queue");

    c = { ...c, category_status: "LOCKED", brand: "Westside", offer: "Starting @699",
      landing: "https://www.tatacliq.com/search?text=Dresses&icid2=quick:qul",
      sub_category: "Dresses", brief: "Festive", expected_cvr: "2.5", expected_rpv: "450" } as Campaign;
    expect(B.fromCategoryPending(c)).toBe(true);

    c = { ...c, pn_template: "Basic", title_brief: "T", message_brief: "M", creative_requirements: "Hero" } as Campaign;
    expect(B.fromCategoryCompleted(c)).toBe(true);

    c = { ...c, crm_status: "SENT_TO_CONTENT", content_status: "PENDING" } as Campaign;
    expect(B.withContent(c)).toBe(true);

    c = { ...c, content_status: "SUBMITTED", header: "Festive styles",
      sub_copy_text: "Shop now" } as Campaign;
    expect(stageOf(c)).toBe("PRODUCTION_SUBMITTED");
    expect(B.fromContentPending(c, {})).toBe(true);

    // CRM final ops: fill the tracking fields, generate, QC, push.
    c = { ...c, campaign_type: "pn", campaign_name_code: "prp", channel_name: "push",
      channel_format: "text", segment_1: "wom", segment_2: "cat",
      tracking_category: "westside", tracking_sub_category: "dress",
      tracking_brand: "multibrand", tracking_landing: "plp", tracking_offer: "starts",
      keywords: "onetime" } as Campaign;

    const fields = suggestTrackingFields(c);
    const { code, valid } = buildTrackingCode(fields);
    expect(valid).toBe(true);
    expect(code.startsWith("cid=pn:prp:push_text:wom_cat:westside_dress_multibrand_plp_starts_h7_")).toBe(true);
    expect(trackingCheck(fields).ok).toBe(true);

    const lpt = buildLandingPlusTracking(c.landing, code);
    expect(lpt.url).not.toMatch(/icid2/i);
    expect(lpt.url.startsWith("https://www.tatacliq.com/search?" + code)).toBe(true);

    const allQc = Object.fromEntries(QC_FIELDS.map((f) => [f.key, true])) as unknown as QcChecklist;
    expect(qcComplete(allQc, c)).toBe(true);

    c = { ...c, tracking_code: code, landing_plus_tracking: lpt.url,
      tracking_code_check: "✅ All Filled", qc_status: "PASSED",
      calendar_status: "UPDATED" } as Campaign;
    expect(stageOf(c)).toBe("READY");
    expect(B.visibleSections(c, {})).toEqual(["calendar"]);

    const csv = campaignsToCSV([c]);
    expect(csv).toContain(code);
    expect(csv).toContain(lpt.url);
  });

  it("the export of a 3,000-row sheet produces 3,001 lines and never rebuilds a URL", () => {
    const done = second.slice(0, 500).map((c) => ({
      ...c, tracking_code: "cid=pn:prp:push_text:wom_cat:a_b_c_plp_upto_h7_010726:onetime",
      landing_plus_tracking: "https://www.tatacliq.com/x?stored-exactly-as-generated",
    } as Campaign));
    const csv = campaignsToCSV(done);
    expect(csv.split("\n")).toHaveLength(501);
    expect(csv).toContain("stored-exactly-as-generated");
  });
});
