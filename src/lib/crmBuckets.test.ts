import { describe, it, expect } from "vitest";
import * as B from "./crmBuckets";
import { stageOf } from "./workflow";
import type { Campaign } from "@/types/campaign";

const PN = (o: Record<string, unknown> = {}) => ({
  id: "z", campaign_name: "PN", is_crm_self: false, is_emergency: false,
  category_status: "EMPTY", crm_status: "AWAITING_REVIEW", content_status: "NOT_ASSIGNED",
  design_status: "NOT_ASSIGNED", qc_status: "PENDING", production_status: "NOT_READY",
  calendar_status: "NOT_UPDATED", pn_template: null, tracking_code: null, ...o,
}) as unknown as Campaign;

const QC = (copy = false) => ({ z: { copy_verified: copy } }) as unknown as B.QcMap;

describe("design_status never affects routing", () => {
  it.each(["NOT_ASSIGNED", "PENDING", "SUBMITTED"])("design_status=%s changes nothing", (ds) => {
    const a = PN({ content_status: "SUBMITTED" });
    const b = PN({ content_status: "SUBMITTED", design_status: ds });
    expect(stageOf(b)).toBe(stageOf(a));
    expect(B.visibleSections(b, QC())).toEqual(B.visibleSections(a, QC()));
  });
});

describe("end-to-end visibility", () => {
  const walk = (steps: [string, Record<string, unknown>, string][], qcAt: number) => {
    let c = PN(steps[0][1]); let qc = QC();
    steps.forEach(([label, patch, expected], i) => {
      c = PN({ ...c, ...patch } as Record<string, unknown>);
      if (i >= qcAt) qc = QC(true);
      const secs = B.visibleSections(c, qc);
      expect(secs.length, `${label} is orphaned`).toBeGreaterThan(0);
      expect(secs.some((s) => s.includes(expected)), `${label} -> ${expected}, got ${secs}`).toBe(true);
    });
  };

  it("CRM Self: invisible to Content until CRM sends", () => walk([
    ["uploaded", { is_crm_self: true, category_status: "LOCKED", crm_status: "IN_PLANNING" }, "crmself:upload/pending"],
    ["CRM input complete", { pn_template: "Basic" }, "crmself:upload/complete"],
    ["sent to Content", { crm_status: "SENT_TO_CONTENT", content_status: "PENDING" }, "crmself:sent-to-content"],
    ["Content submitted", { content_status: "SUBMITTED" }, "crmself:content/pending"],
    ["CRM reviewed", {}, "crmself:content/ready"],
    ["QC passed", { qc_status: "PASSED" }, "finalqc"],
    ["calendar", { calendar_status: "UPDATED" }, "calendar"],
  ], 4));

  it("Category-led", () => walk([
    ["uploaded", {}, "category:queue"],
    ["Category locked", { category_status: "LOCKED" }, "category/pending"],
    ["CRM Part 2", { pn_template: "Basic" }, "category/complete"],
    ["sent to Content", { crm_status: "SENT_TO_CONTENT", content_status: "PENDING" }, "content:queue"],
    ["Content submitted", { content_status: "SUBMITTED" }, "content/pending"],
    ["CRM reviewed", {}, "content/ready"],
    ["QC passed", { qc_status: "PASSED" }, "finalqc"],
    ["calendar", { calendar_status: "UPDATED" }, "calendar"],
  ], 5));

  it("Emergency", () => walk([
    ["raised", { is_emergency: true, category_status: "LOCKED" }, "category/pending"],
    ["accepted + Part 2", { pn_template: "Timer" }, "category/complete"],
    ["sent to Content", { crm_status: "SENT_TO_CONTENT", content_status: "PENDING" }, "content:queue"],
    ["Content submitted", { content_status: "SUBMITTED" }, "content/pending"],
    ["CRM reviewed", {}, "content/ready"],
    ["QC passed", { qc_status: "PASSED" }, "finalqc"],
    ["calendar", { calendar_status: "UPDATED" }, "calendar"],
  ], 4));
});

describe("exhaustive invariants", () => {
  const sweep = () => {
    const out: { orphans: number; overlaps: number; total: number } =
      { orphans: 0, overlaps: 0, total: 0 };
    for (const category_status of ["EMPTY", "DRAFT", "LOCKED"])
    for (const crm_status of ["NOT_STARTED","AWAITING_REVIEW","IN_PLANNING","SENT_TO_CONTENT","FINAL_QC","READY"])
    for (const content_status of ["NOT_ASSIGNED","PENDING","SUBMITTED","NEEDS_CHANGES"])
    for (const design_status of ["NOT_ASSIGNED","PENDING","SUBMITTED"])
    for (const qc_status of ["PENDING","PASSED","FAILED"])
    for (const calendar_status of ["NOT_UPDATED","UPDATED"])
    for (const pn_template of [null, "Basic"])
    for (const copy of [false, true])
    for (const is_crm_self of [false, true])
    for (const is_emergency of [false, true]) {
      out.total++;
      const c = PN({ category_status, crm_status, content_status, design_status,
        qc_status, calendar_status, pn_template, is_crm_self, is_emergency });
      const qc = QC(copy);
      if (B.visibleSections(c, qc).length === 0) out.orphans++;
      if (B.actionableSections(c, qc).length > 1) out.overlaps++;
    }
    return out;
  };

  it("ZERO ORPHANS: no PN can ever disappear", () => {
    const r = sweep();
    expect(r.total).toBeGreaterThan(20000);
    expect(r.orphans).toBe(0);
  });

  it("ZERO OVERLAPS: no PN is actionable in two sections", () => {
    expect(sweep().overlaps).toBe(0);
  });
});

describe("CRM Self is not auto-routed", () => {
  const unsent = PN({ is_crm_self: true, category_status: "LOCKED",
    crm_status: "IN_PLANNING", pn_template: "Basic" });
  it("is not in Content's queue before Send", () => expect(B.withContent(unsent)).toBe(false));
  it("is actionable for CRM", () => expect(B.crmSelfUploadCompleted(unsent)).toBe(true));
  it("becomes read-only once sent", () => {
    const sent = PN({ ...unsent, crm_status: "SENT_TO_CONTENT", content_status: "PENDING" } as Record<string, unknown>);
    expect(B.withContent(sent)).toBe(true);
    expect(B.sentToContent(sent)).toBe(true);
    expect(B.actionableSections(sent, QC())).toEqual([]);
  });
});
