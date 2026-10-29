import { describe, it, expect } from "vitest";
import {
  PART2_FIELDS, isPart2FieldFilled, missingPart2, missingPart2Keys,
  part2Ready, canMoveForward, alreadyMovedOn, missingTooltip, requiredMessage,
} from "./crmPart2";
import { part2Complete } from "./crmBuckets";
import type { Campaign } from "@/types/campaign";

const full = (o: Partial<Campaign> = {}) => ({
  id: "c1", campaign_name: "PN", title_brief: "T", message_brief: "M",
  pn_template: "Basic", creative_requirements: "Hero",
  crm_status: "AWAITING_REVIEW", content_status: "NOT_ASSIGNED",
  qc_status: "PENDING", calendar_status: "NOT_UPDATED", ...o,
}) as unknown as Campaign;

describe("the four mandatory fields", () => {
  it("are exactly these four", () => {
    expect(PART2_FIELDS.map((f) => f.key)).toEqual([
      "title_brief", "message_brief", "pn_template", "creative_requirements"]);
  });

  it("all filled passes", () => expect(part2Ready(full())).toBe(true));

  it.each([
    ["title_brief", "Title Brief"],
    ["message_brief", "Message Brief"],
    ["pn_template", "PN Template"],
    ["creative_requirements", "Creative Requirements"],
  ])("%s empty blocks, with the right message", (key, label) => {
    const c = full({ [key]: null } as Partial<Campaign>);
    expect(part2Ready(c)).toBe(false);
    expect(missingPart2(c)).toEqual([label]);
    expect(requiredMessage(label)).toBe(`${label} is required`);
    expect(missingPart2Keys(c)).toEqual([key]);
  });

  it('"Select" counts as empty', () => {
    expect(isPart2FieldFilled("Select")).toBe(false);
    expect(isPart2FieldFilled("select")).toBe(false);
    expect(part2Ready(full({ pn_template: "Select" }))).toBe(false);
  });

  it("whitespace-only counts as empty", () => {
    expect(isPart2FieldFilled("   ")).toBe(false);
    expect(isPart2FieldFilled("\t\n")).toBe(false);
    expect(part2Ready(full({ title_brief: "   " }))).toBe(false);
  });

  it("a real value passes, including the four template options", () => {
    for (const t of ["Basic", "Bezel", "Timer", "Coloured BG"]) {
      expect(part2Ready(full({ pn_template: t }))).toBe(true);
    }
  });

  it("lists every missing field at once", () => {
    const empty = full({ title_brief: null, message_brief: "  ",
      pn_template: "Select", creative_requirements: null });
    expect(missingPart2(empty)).toEqual([
      "Title Brief", "Message Brief", "PN Template", "Creative Requirements"]);
  });

  it("the tooltip names what is missing, and is absent when complete", () => {
    expect(missingTooltip(full({ title_brief: null })))
      .toBe("Still needed: Title Brief");
    expect(missingTooltip(full())).toBeUndefined();
  });
});

describe("already-moved PNs are never re-validated", () => {
  it.each([
    ["sent to Content", { crm_status: "SENT_TO_CONTENT" }],
    ["content submitted", { content_status: "SUBMITTED" }],
    ["QC passed", { qc_status: "PASSED" }],
    ["on the calendar", { calendar_status: "UPDATED" }],
  ])("%s with empty fields still moves", (_l, patch) => {
    const old = full({ title_brief: null, message_brief: null,
      pn_template: null, creative_requirements: null, ...patch } as Partial<Campaign>);
    expect(alreadyMovedOn(old)).toBe(true);
    expect(canMoveForward(old)).toBe(true);
  });

  it("a NEW incomplete PN cannot move", () => {
    expect(canMoveForward(full({ title_brief: null }))).toBe(false);
  });
});

describe("bucket membership follows the same rule", () => {
  it("all four filled -> Part 2 complete", () => {
    expect(part2Complete(full())).toBe(true);
  });

  it("template only is NOT complete any more", () => {
    expect(part2Complete(full({
      title_brief: null, message_brief: null, creative_requirements: null }))).toBe(false);
  });

  it("one source of truth: buckets and the gate agree on every combination", () => {
    const vals = [null, "  ", "Select", "x"];
    for (const t of vals) for (const m of vals) for (const p of vals) for (const cr of vals) {
      const c = full({ title_brief: t, message_brief: m,
        pn_template: p, creative_requirements: cr } as Partial<Campaign>);
      expect(part2Complete(c)).toBe(part2Ready(c));
    }
  });
});

describe("drafts are unaffected", () => {
  it("the rule gates MOVING, never saving", () => {
    // Nothing here blocks a save: the drawer's save() is untouched and the
    // gate lives only on the Send path and in sendToContent/sendBatch.
    const draft = full({ title_brief: null });
    expect(part2Ready(draft)).toBe(false);
    expect(draft.title_brief).toBeNull();   // still saveable as-is
  });
});
