import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { isAwaitingCopy, pendingForContent } from "@/services/contentBulk";
import { FIXED_TRACKING_VALUES, TRACKING_INPUTS, isFixed, isFreeText } from "./trackingFields";
import { buildTrackingCode, type TrackingFields } from "./trackingCode";
import { filterByDateRange } from "./dateRange";
import { QC_FIELDS } from "./workflow";
import type { Campaign } from "@/types/campaign";

const read = (p: string) => readFileSync(join(__dirname, p), "utf8");
const drawer = read("../components/CampaignDrawer.tsx");
const bulk = read("../components/BulkWorkspace.tsx");
const form = read("../components/CampaignForm.tsx");
const modal = read("../components/AddCampaignModal.tsx");
const shell = read("../components/AppShell.tsx");

/* ── TESTS 1 & 2: Sub Category + Brand are free text everywhere ── */
describe("Tests 1-2 — Category input Sub Category and Brand", () => {
  it("Solo PN uses text inputs, not SearchSelect", () => {
    expect(drawer).not.toMatch(/SearchSelect[^>]*sub_category/s);
    expect(drawer).toContain('placeholder="Type a sub category"');
    expect(drawer).toContain('placeholder="Type a brand, or several"');
  });

  it("Show All PN Brand is no longer a brand picker", () => {
    const line = bulk.split("\n").find((l) => l.includes('key: "brand", label: "Brand"'))!;
    expect(line).not.toContain('type: "brand"');
  });

  it("the new-PN form types a sub-category", () => {
    expect(form).not.toMatch(/<select value=\{v\.sub_category/);
    expect(form).toContain('placeholder="Type a sub-category"');
  });

  it("Add Campaign types a brand", () => {
    expect(modal).not.toMatch(/SearchSelect[^>]*masterData\.brands/s);
  });

  it("arbitrary text is accepted — several brands in one value", () => {
    const c = { brand: "Nike, Adidas, Puma", sub_category: "Casual Wear" } as Campaign;
    expect(c.brand).toBe("Nike, Adidas, Puma");
  });
});

/* ── TESTS 3-5: CRM tracking fields ── */
describe("Tests 3-5 — fixed and free-text tracking fields", () => {
  it("the three fixed values are exactly pn / prp / push", () => {
    expect(FIXED_TRACKING_VALUES.campaign_type).toBe("pn");
    expect(FIXED_TRACKING_VALUES.campaign_name_code).toBe("prp");
    expect(FIXED_TRACKING_VALUES.channel_name).toBe("push");
  });

  it("they are fixed, not selects", () => {
    for (const k of ["campaign_type", "campaign_name_code", "channel_name"]) {
      expect(isFixed(k)).toBe(true);
    }
  });

  it("the six named fields are free text", () => {
    for (const k of ["segment_1", "segment_2", "tracking_category",
                     "tracking_sub_category", "tracking_offer", "keywords"]) {
      expect(isFreeText(k), `${k} should be free text`).toBe(true);
    }
  });

  it("Show All PN has no leftover dropdown for those six", () => {
    for (const k of ["segment_1", "segment_2", "tracking_category",
                     "tracking_sub_category", "tracking_offer", "keywords"]) {
      const line = bulk.split("\n").find((l) => l.includes(`key: "${k}"`))!;
      expect(line, `${k} still a select`).not.toContain('type: "select"');
    }
  });

  it("Solo PN and Show All PN read the SAME config file", () => {
    expect(drawer).toContain('from "@/lib/trackingFields"');
    expect(bulk).toContain('from "@/lib/trackingFields"');
  });

  it("typed values flow through the generator verbatim, order unchanged", () => {
    const typed: TrackingFields = {
      campaign_type: "pn", campaign_name: "prp", channel_name: "push",
      channel_format: "text",
      segment_1: "act", segment_2: "wom",
      category: "womf", sub_category: "casual",
      brand: "multibrand", landing: "plp", offer: "flat",
      time: "h7", date: "010726", keywords: "weekend",
    };
    expect(buildTrackingCode(typed).code).toBe(
      "cid=pn:prp:push_text:act_wom:womf_casual_multibrand_plp_flat_h7_010726:weekend");
  });

  it("a typed value is never replaced by a lookup", () => {
    const typed = { segment_1: "totallycustom" } as Partial<TrackingFields>;
    expect(typed.segment_1).toBe("totallycustom");
    // The generator does no lookup: it concatenates what it is given.
    expect(TRACKING_INPUTS.segment_1.kind).toBe("text");
  });
});

/* ── TESTS 6-7: Changes badge ── */
describe("Tests 6-7 — Changes notification badge", () => {
  it("uses the same status the Changes page uses", () => {
    const svc = read("../services/campaigns.ts");
    expect(svc).toContain('.eq("status", "PENDING")');
    expect(svc).toContain("change_requests");
    const page = read("../app/(app)/changes/page.tsx");
    expect(page).toContain('r.status === "PENDING"');
  });

  it("is hidden at zero", () => {
    expect(shell).toContain("pendingChanges > 0 &&");
  });

  it("renders the real count, never a literal", () => {
    expect(shell).toContain("pendingChanges > 99");
    expect(shell).not.toMatch(/changes[\s\S]{0,80}>\s*3\s*</i);
  });

  it("only the Changes item gets a badge", () => {
    expect(shell).toContain('n.href === "/changes" && pendingChanges > 0');
  });

  it("refreshes on navigation AND on an accept/reject signal", () => {
    expect(shell).toContain("onChangeRequestsUpdated(refreshPendingChanges)");
    expect(shell).toMatch(/\[refreshPendingChanges, pathname\]/);
  });

  it("accept and reject both fire the signal", () => {
    const page = read("../app/(app)/changes/page.tsx");
    expect(page.match(/notifyChangeRequestsUpdated\(\);/g) ?? []).toHaveLength(2);
  });

  it("caps the badge at 99+", () => {
    expect(shell).toContain('pendingChanges > 99 ? "99+" : pendingChanges');
  });

  it("a failure yields 0, never breaks the nav", () => {
    expect(read("../services/campaigns.ts")).toContain("if (error) return 0;");
  });
});

/* ── TESTS 8-9: bulk export / import eligibility ── */
describe("Tests 8-9 — only Awaiting your copy is exported", () => {
  const pn = (id: string, o: Partial<Campaign> = {}) => ({
    id, launch_date: "2026-10-10", content_status: "PENDING",
    calendar_status: "NOT_UPDATED", qc_status: "PENDING", ...o,
  }) as Campaign;

  const A = pn("A");
  const B = pn("B", { content_status: "SUBMITTED" });
  const C = pn("C", { content_status: "NEEDS_CHANGES" });
  const D = pn("D", { content_status: "SUBMITTED", calendar_status: "UPDATED", qc_status: "PASSED" });
  const all = [A, B, C, D];

  it("A and C are eligible; B and D are not", () => {
    expect(isAwaitingCopy(A)).toBe(true);
    expect(isAwaitingCopy(C)).toBe(true);
    expect(isAwaitingCopy(B)).toBe(false);
    expect(isAwaitingCopy(D)).toBe(false);
  });

  it("the count is 2, and the export set is exactly A + C", () => {
    const eligible = pendingForContent(all);
    expect(eligible).toHaveLength(2);
    expect(eligible.map((c) => c.id)).toEqual(["A", "C"]);
  });

  it("the date filter applies ON TOP of eligibility, in that order", () => {
    const inOct = filterByDateRange(pendingForContent(all),
      { start: "2026-10-01", end: "2026-10-31" }, (c) => c.launch_date);
    expect(inOct.map((c) => c.id)).toEqual(["A", "C"]);
  });

  it("a row outside the range is excluded even when eligible", () => {
    const nov = pn("N", { launch_date: "2026-11-05" });
    expect(filterByDateRange(pendingForContent([...all, nov]),
      { start: "2026-10-01", end: "2026-10-31" }, (c) => c.launch_date)
      .map((c) => c.id)).toEqual(["A", "C"]);
  });

  it("the UI summarises the SAME eligible set it exports", () => {
    const src = read("../components/ContentBulkExcel.tsx");
    expect(src).toContain("summariseRange(pending, range");
  });

  it("import refuses a row that stopped being eligible", () => {
    const svc = read("../services/contentBulk.ts");
    expect(svc).toContain("No longer awaiting copy");
    expect(svc).toContain("Skipped so finished work is not overwritten.");
  });

  it("a finalized row cannot be overwritten by an import", () => {
    expect(isAwaitingCopy(D)).toBe(false);
  });

  it("NEEDS_CHANGES IS exported — rows sent back to Content still need copy", () => {
    const sentBack = pn("R", { content_status: "NEEDS_CHANGES" });
    expect(isAwaitingCopy(sentBack)).toBe(true);
    expect(pendingForContent([sentBack])).toHaveLength(1);
  });

  it("but a sent-back row already finalized is still excluded", () => {
    expect(isAwaitingCopy(pn("R2", {
      content_status: "NEEDS_CHANGES", calendar_status: "UPDATED" }))).toBe(false);
  });
});

/* ── TESTS 10-13: row-level check all QC ── */
describe("Tests 10-13 — row QC shortcut", () => {
  it("ticks all ten through the real dirty-QC state", () => {
    expect(bulk).toContain("setDirtyQc((prev) => ({");
    expect(bulk).toContain("QC_CHECKS.map((q) => [q.key, turningOn])");
  });

  it("there are exactly ten checks to tick", () => {
    expect(QC_FIELDS).toHaveLength(10);
  });

  it("applies only in Final QC — set when ticking, clear when unticking", () => {
    expect(bulk).toContain("if (isQc) {");
    expect(bulk).toContain("const turningOn = isQc");
  });

  it("affects only that row — keyed by c.id", () => {
    expect(bulk).toMatch(/\[c\.id\]: \{\s*\.\.\.prev\[c\.id\]/);
  });

  it("unticking CLEARS all ten, through the same dirtyQc path", () => {
    expect(bulk).toContain("unticking CLEARS all ten");
    expect(bulk).toContain("QC_CHECKS.map((q) => [q.key, turningOn])");
  });

  it("the box shows checked when all ten are ticked one by one", () => {
    expect(bulk).toContain('qcStateOf(c.id) === "all"');
    expect(bulk).toContain("const qcStateOf");
  });

  it("it shows indeterminate when only some are ticked", () => {
    expect(bulk).toContain('el.indeterminate = isQc && qcStateOf(c.id) === "some"');
  });

  it("the derived state merges saved QC with unsaved edits", () => {
    expect(bulk).toMatch(/const pending = dirtyQc\[id\]/);
    expect(bulk).toMatch(/const saved = \(qc\[id\]/);
  });

  it("the box still drives row SELECTION, so bulk actions keep working", () => {
    expect(bulk).toContain("The box still drives row SELECTION");
    expect(bulk).toMatch(/if \(turningOn\) n\.add\(c\.id\); else n\.delete\(c\.id\);/);
  });

  it("the header Select all still only selects", () => {
    const line = bulk.split("\n").find((l) => l.includes("setSelected(allSelected"))!;
    expect(line).not.toContain("setDirtyQc");
  });

  it("individual checkboxes remain independently clickable", () => {
    expect(bulk).toContain("onChange={(e) => setQcField(c.id, q.key, e.target.checked)}");
  });
});
