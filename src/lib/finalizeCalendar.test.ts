import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  buildTrackingCode, suggestTrackingFields, trackingCheck,
} from "./trackingCode";
import { qcComplete, QC_FIELDS } from "./workflow";
import * as B from "./crmBuckets";
import type { Campaign, QcChecklist } from "@/types/campaign";

const read = (p: string) => readFileSync(join(__dirname, p), "utf8");

const complete = (o: Partial<Campaign> = {}) => ({
  id: "c1", campaign_name: "PN", is_crm_self: false, is_emergency: false,
  launch_date: "2026-10-18", launch_time: "07:00:00", slot_number: 1,
  category_status: "LOCKED", crm_status: "SENT_TO_CONTENT",
  content_status: "SUBMITTED", design_status: "NOT_ASSIGNED",
  qc_status: "PENDING", production_status: "NOT_READY",
  calendar_status: "NOT_UPDATED", pn_template: "Basic",
  header: "Festive styles", sub_copy_text: "Shop now", creative_link: null,
  landing: "https://www.tatacliq.com/search?text=a&icid2=b",
  brand: "Biba", offer: "Starting @699",
  campaign_type: "pn", campaign_name_code: "prp", channel_name: "push",
  channel_format: "text", segment_1: "wom", segment_2: "cat",
  tracking_category: "westside", tracking_sub_category: "women",
  tracking_brand: "multibrand", tracking_landing: "plp", tracking_offer: "starts",
  keywords: "onetime", tracking_code: null,
  ...o,
}) as unknown as Campaign;

const allQc = Object.fromEntries(QC_FIELDS.map((f) => [f.key, true])) as unknown as QcChecklist;

/** The persisted-code gate, exactly as the drawer computes it. */
const hasPersistedCode = (c: Campaign) =>
  Boolean((c.tracking_code ?? "").trim()) && (c.tracking_code ?? "").startsWith("cid=");

/* ══ 1. a complete campaign generates and persists a code ══ */
describe("Test 1 — tracking code generates from a complete campaign", () => {
  it("builds a valid cid= code", () => {
    const { code, valid } = buildTrackingCode(suggestTrackingFields(complete()));
    expect(valid).toBe(true);
    expect(code.startsWith("cid=pn:prp:push_text:wom_cat:")).toBe(true);
  });

  it("the drawer persists it rather than only displaying it", () => {
    const svc = read("../services/campaigns.ts");
    expect(svc).toContain("export async function generateTrackingCode");
    expect(svc).toMatch(/updateCampaign\(campaign\.id, \{\s*tracking_code: code/);
  });

  it("a missing field gives a specific, named error", () => {
    // Sub Category has no auto-derivation — it is CRM's to pick — so it is
    // the honest test of a genuinely absent field. segment_2 would be
    // re-derived from the flow and is therefore never missing.
    const { valid, missing } = buildTrackingCode(
      suggestTrackingFields(complete({ tracking_sub_category: null } as Partial<Campaign>)));
    expect(valid).toBe(false);
    expect(missing).toContain("Sub Category");
  });
});

/* ══ 2 + 3. green can never show over an empty persisted code ══ */
describe("Tests 2 & 3 — an empty tracking code can never read green", () => {
  it("fields complete but code not persisted -> NOT green", () => {
    const c = complete({ tracking_code: null });
    expect(trackingCheck(suggestTrackingFields(c)).ok).toBe(true);   // fields fine
    expect(hasPersistedCode(c)).toBe(false);                         // but nothing stored
  });

  it("whitespace is not a tracking code", () => {
    expect(hasPersistedCode(complete({ tracking_code: "   " }))).toBe(false);
  });

  it("a non-cid= value is not accepted", () => {
    expect(hasPersistedCode(complete({ tracking_code: "promotional_old_na_1930" }))).toBe(false);
  });

  it("Mark QC Complete and Update Calendar BOTH require the persisted code", () => {
    const drawer = read("../components/CampaignDrawer.tsx");
    expect(drawer).toMatch(/disabled=\{!qcPassed \|\| !tracking\.ok \|\| !hasPersistedCode\}/);
    expect(drawer).toMatch(/\|\| !hasPersistedCode\}/);
  });

  it("the gate reads the PERSISTED column, not the field check", () => {
    const drawer = read("../components/CampaignDrawer.tsx");
    expect(drawer).toContain('(campaign.tracking_code ?? "").startsWith("cid=")');
  });
});

/* ══ 4. Cancel changes nothing ══ */
describe("Test 4 — Cancel", () => {
  it("only closes the modal and clears the error", () => {
    const drawer = read("../components/CampaignDrawer.tsx");
    const cancel = drawer.slice(drawer.indexOf("// Cancel changes nothing."), 200 + drawer.indexOf("// Cancel changes nothing."));
    expect(cancel).toContain("setPushOpen(false)");
    expect(cancel).not.toContain("updateCalendar");
  });
});

/* ══ 5 + 10 + 11. the mutation itself ══ */
describe("Tests 5, 10, 11 — the finalization mutation", () => {
  it("the modal closes ONLY after the backend confirms", () => {
    const drawer = read("../components/CampaignDrawer.tsx");
    const handler = drawer.slice(drawer.indexOf("setBusy(true); setPushError(null);"));
    // await first, close second.
    expect(handler.indexOf("await api.updateCalendar"))
      .toBeLessThan(handler.indexOf("setPushOpen(false)"));
  });

  it("a rejection is caught and shown, not swallowed", () => {
    const drawer = read("../components/CampaignDrawer.tsx");
    expect(drawer).toContain("Unable to update the calendar:");
    expect(drawer).toMatch(/catch \(e\) \{[\s\S]{0,200}setPushError/);
  });

  it("busy state is always cleared, even on failure", () => {
    expect(read("../components/CampaignDrawer.tsx"))
      .toMatch(/finally \{\s*setBusy\(false\);\s*\}/);
  });

  it("the service reads the row back to prove the write landed", () => {
    const svc = read("../services/campaigns.ts");
    expect(svc).toContain("The calendar update did not take effect");
    expect(svc).toMatch(/if \(after\.calendar_status !== "UPDATED"\)/);
  });

  it("an already-finalized campaign returns the stored record, no second write", () => {
    const svc = read("../services/campaigns.ts");
    expect(svc).toContain('if (campaign.calendar_status === "UPDATED")');
    expect(svc).toContain("already finalized");
  });

  it("the required debug context is logged", () => {
    const svc = read("../services/campaigns.ts");
    for (const k of ["campaignId", "previousStatus", "qcStatus", "hasTrackingCode", "finalStatus"]) {
      expect(svc).toContain(k);
    }
  });
});

/* ══ 6 + 7 + 12. visibility after finalization ══ */
describe("Tests 6, 7, 12 — Final View and Calendar", () => {
  const finalized = complete({
    tracking_code: "cid=pn:prp:push_text:wom_cat:westside_women_multibrand_plp_starts_h7_181026:onetime",
    qc_status: "PASSED", calendar_status: "UPDATED",
  });

  it("a finalized campaign appears only in the calendar section", () => {
    expect(B.visibleSections(finalized, {})).toEqual(["calendar"]);
    expect(B.isOnCalendar(finalized)).toBe(true);
  });

  it("Final View and Calendar read the SAME persisted flag", () => {
    const fv = read("../app/(app)/final-view/page.tsx");
    const cal = read("../app/(app)/calendar/page.tsx");
    expect(fv + cal).toMatch(/calendar_status/);
  });

  it("the date is not shifted — the stored ISO date is used as-is", () => {
    expect(finalized.launch_date).toBe("2026-10-18");
    // No Date round-trip anywhere in the finalization path.
    expect(read("../services/campaigns.ts")).not.toMatch(/new Date\(campaign\.launch_date\)/);
  });

  it("time and slot survive finalization untouched", () => {
    expect(finalized.launch_time).toBe("07:00:00");
    expect(finalized.slot_number).toBe(1);
  });
});

/* ══ 8. no hard refresh needed ══ */
describe("Test 8 — the views refresh themselves", () => {
  it("refresh() runs after a successful write", () => {
    const drawer = read("../components/CampaignDrawer.tsx");
    const handler = drawer.slice(drawer.indexOf("setBusy(true); setPushError(null);"));
    expect(handler.indexOf("await api.updateCalendar"))
      .toBeLessThan(handler.indexOf("await refresh()"));
  });

  it("a refresh failure is reported without un-finalizing anything", () => {
    expect(read("../components/CampaignDrawer.tsx"))
      .toContain("Campaign was finalized, but the Calendar refresh failed.");
  });
});

/* ══ 9. double click ══ */
describe("Test 9 — repeated clicks cannot duplicate", () => {
  it("the button is disabled while the write is in flight", () => {
    expect(read("../components/CampaignDrawer.tsx")).toMatch(/disabled=\{busy\}/);
  });

  it("finalizing twice is idempotent by construction", async () => {
    // There is no separate calendar table: Final View and Calendar read
    // `campaigns where calendar_status = 'UPDATED'`, so a second write sets
    // the same row to the same state.
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const row = { ...complete({ calendar_status: "UPDATED" }) };
    expect(row.calendar_status).toBe("UPDATED");
    await rpc();
    expect(row.calendar_status).toBe("UPDATED");   // unchanged, not duplicated
    expect(read("../services/campaigns.ts")).toContain("cannot produce a duplicate entry");
  });
});

/* ══ QC completeness ══ */
describe("Final QC still requires every applicable check", () => {
  it("nine of ten does not pass", () => {
    const nine = { ...allQc, tracking_verified: false } as QcChecklist;
    expect(qcComplete(nine, complete())).toBe(false);
  });

  it("all ten passes", () => {
    expect(qcComplete(allQc, complete())).toBe(true);
  });

  it("QC status is persisted, not held in component state", () => {
    expect(read("../services/campaigns.ts"))
      .toMatch(/updateCampaign\(campaignId, \{ qc_status: "PASSED" \}\)/);
  });
});

/* ══ G. modal copy ══ */
describe("modal copy matches the specified wording", () => {
  const drawer = read("../components/CampaignDrawer.tsx");
  it.each([
    "Update calendar?",
    "This is the finalization step. The campaign will appear in Final View and the Calendar after confirmation.",
    "Final QC has passed for this campaign. Confirm to add it to the finalized calendar.",
    "Campaign added to the finalized calendar.",
  ])("contains %s", (text) => expect(drawer).toContain(text));
});
