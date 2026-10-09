import { describe, it, expect } from "vitest";
import {
  qcComplete, missingQcFields, creativeRequired, requiredQcFields,
  QC_FIELDS,
} from "./workflow";
import type { QcChecklist, Campaign } from "@/types/campaign";

const all = (v: boolean) =>
  Object.fromEntries(QC_FIELDS.map((f) => [f.key, v])) as unknown as QcChecklist;

const withCreative = { creative_link: "https://cdn/x.png" } as Campaign;
const noCreative = { creative_link: null } as Campaign;
const blankCreative = { creative_link: "   " } as Campaign;

/* ───────── finding 7: conditional creative_verified ───────── */
describe("creative_verified is conditional", () => {
  it("applies only when a creative link exists", () => {
    expect(creativeRequired(withCreative)).toBe(true);
    expect(creativeRequired(noCreative)).toBe(false);
    expect(creativeRequired(blankCreative)).toBe(false);   // whitespace is not a link
    expect(creativeRequired(null)).toBe(false);
  });

  it("drops to 9 checks with no creative, 10 with one", () => {
    expect(requiredQcFields(noCreative)).toHaveLength(QC_FIELDS.length - 1);
    expect(requiredQcFields(withCreative)).toHaveLength(QC_FIELDS.length);
    expect(requiredQcFields(noCreative).map((f) => f.key)).not.toContain("creative_verified");
  });

  it("passes without creative_verified when there is no creative", () => {
    const qc = { ...all(true), creative_verified: false } as QcChecklist;
    expect(qcComplete(qc, noCreative)).toBe(true);
  });

  it("still FAILS without creative_verified when a creative exists", () => {
    const qc = { ...all(true), creative_verified: false } as QcChecklist;
    expect(qcComplete(qc, withCreative)).toBe(false);
    expect(missingQcFields(qc, withCreative)).toContain("Creative verified");
  });

  it("never reports creative_verified as missing when it does not apply", () => {
    const qc = { ...all(true), creative_verified: false } as QcChecklist;
    expect(missingQcFields(qc, noCreative)).toEqual([]);
  });

  it("does not weaken any other check", () => {
    for (const f of QC_FIELDS) {
      if (f.key === "creative_verified") continue;
      const qc = { ...all(true), [f.key]: false } as QcChecklist;
      expect(qcComplete(qc, noCreative)).toBe(false);
      expect(missingQcFields(qc, noCreative)).toContain(f.label);
    }
  });

  it("omitting the campaign keeps the old strict behaviour", () => {
    // Callers that pass no campaign must not be silently loosened.
    const qc = { ...all(true), creative_verified: false } as QcChecklist;
    expect(qcComplete(qc)).toBe(false);
  });

  it("a missing checklist never passes", () => {
    expect(qcComplete(null, noCreative)).toBe(false);
    expect(qcComplete(null, withCreative)).toBe(false);
  });

  it("an empty checklist reports every applicable field", () => {
    expect(missingQcFields(all(false), noCreative)).toHaveLength(QC_FIELDS.length - 1);
    expect(missingQcFields(all(false), withCreative)).toHaveLength(QC_FIELDS.length);
  });
});
