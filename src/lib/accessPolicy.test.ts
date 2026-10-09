import { describe, it, expect } from "vitest";
import {
  canReadCampaign, canVisit, rejectedColumns, CONTENT_OWNED, CATEGORY_OWNED,
} from "./accessPolicy";
import type { Campaign } from "@/types/campaign";

const PN = (o: Partial<Campaign> = {}) => ({
  id: "z", is_crm_self: false, crm_status: "AWAITING_REVIEW",
  content_status: "NOT_ASSIGNED", calendar_status: "NOT_UPDATED",
  ...o,
}) as Campaign;

/* ───────── finding 9: per-role reads ───────── */
describe("read policy (migration 17 campaigns_read)", () => {
  it("CRM reads everything", () => {
    expect(canReadCampaign("CRM", PN())).toBe(true);
    expect(canReadCampaign("CRM", PN({ is_crm_self: true }))).toBe(true);
  });

  it("EXECUTIVE reads everything", () => {
    expect(canReadCampaign("EXECUTIVE", PN({ crm_status: "NOT_STARTED" }))).toBe(true);
  });

  it("CONTENT cannot read a PN CRM has not sent", () => {
    expect(canReadCampaign("CONTENT", PN({ content_status: "NOT_ASSIGNED" }))).toBe(false);
  });

  it("CONTENT cannot read an un-routed CRM Self PN", () => {
    // The exact case the dashboard rule protects: uploaded but not yet sent.
    expect(canReadCampaign("CONTENT",
      PN({ is_crm_self: true, crm_status: "IN_PLANNING", content_status: "NOT_ASSIGNED" })
    )).toBe(false);
  });

  it("CONTENT reads a PN once sent, and keeps reading it after submitting", () => {
    expect(canReadCampaign("CONTENT", PN({ content_status: "PENDING" }))).toBe(true);
    expect(canReadCampaign("CONTENT", PN({ content_status: "SUBMITTED" }))).toBe(true);
    expect(canReadCampaign("CONTENT", PN({ content_status: "NEEDS_CHANGES" }))).toBe(true);
  });

  it("CATEGORY never reads CRM Self PNs", () => {
    expect(canReadCampaign("CATEGORY",
      PN({ is_crm_self: true, crm_status: "IN_PLANNING" }))).toBe(false);
  });

  it("CATEGORY cannot read a PN CRM has not released", () => {
    expect(canReadCampaign("CATEGORY", PN({ crm_status: "NOT_STARTED" }))).toBe(false);
  });

  it("CATEGORY reads its own released PNs through the whole lifecycle", () => {
    for (const crm_status of ["AWAITING_REVIEW", "IN_PLANNING", "SENT_TO_CONTENT", "READY"]) {
      expect(canReadCampaign("CATEGORY", PN({ crm_status } as Partial<Campaign>))).toBe(true);
    }
  });

  it("no role is silently granted access by an unknown value", () => {
    expect(canReadCampaign("NOPE" as never, PN())).toBe(false);
  });
});

/* ───────── finding 9: route guards ───────── */
describe("route guards (middleware)", () => {
  it("CRM-only routes reject every other role", () => {
    for (const path of ["/qc", "/final-view", "/segments"]) {
      expect(canVisit("CRM", path)).toBe(true);
      for (const role of ["CATEGORY", "CONTENT", "EXECUTIVE"] as const) {
        expect(canVisit(role, path)).toBe(false);
      }
    }
  });

  it("EXECUTIVE cannot reach the operational queues", () => {
    expect(canVisit("EXECUTIVE", "/emergency")).toBe(false);
    expect(canVisit("EXECUTIVE", "/changes")).toBe(false);
  });

  it("EXECUTIVE can reach reporting", () => {
    expect(canVisit("EXECUTIVE", "/performance")).toBe(true);
    expect(canVisit("EXECUTIVE", "/overview")).toBe(true);
  });

  it("CONTENT cannot reach /changes or /performance", () => {
    expect(canVisit("CONTENT", "/changes")).toBe(false);
    expect(canVisit("CONTENT", "/performance")).toBe(false);
  });

  it("nested paths inherit the parent rule", () => {
    expect(canVisit("CONTENT", "/qc/some-id")).toBe(false);
    expect(canVisit("CRM", "/qc/some-id")).toBe(true);
  });

  it("every role can reach the shared dashboard", () => {
    for (const r of ["CRM", "CATEGORY", "CONTENT", "EXECUTIVE"] as const) {
      expect(canVisit(r, "/overview")).toBe(true);
    }
  });
});

/* ───────── finding 10: column ownership ───────── */
describe("column ownership trigger", () => {
  const TRACKING = ["tracking_code", "cid", "campaign_id_ext", "landing_plus_tracking"];
  const CRM_OPS = ["qc_status", "calendar_status", "crm_status", "pn_template"];

  it("CONTENT is blocked from every tracking column", () => {
    expect(rejectedColumns("CONTENT", TRACKING).sort()).toEqual([...TRACKING].sort());
  });

  it("CONTENT is blocked from QC and CRM ops columns", () => {
    expect(rejectedColumns("CONTENT", CRM_OPS).sort()).toEqual([...CRM_OPS].sort());
  });

  it("CONTENT is blocked from Category's columns", () => {
    expect(rejectedColumns("CONTENT", ["brand", "offer", "landing", "expected_rpv"]))
      .toHaveLength(4);
  });

  it("CONTENT may write its own columns", () => {
    expect(rejectedColumns("CONTENT", [...CONTENT_OWNED])).toEqual([]);
  });

  it("CATEGORY is blocked from tracking, QC and Content columns", () => {
    expect(rejectedColumns("CATEGORY", TRACKING)).toHaveLength(4);
    expect(rejectedColumns("CATEGORY", ["qc_status", "calendar_status"])).toHaveLength(2);
    expect(rejectedColumns("CATEGORY", ["header", "sub_copy_text", "creative_link"]))
      .toHaveLength(3);
  });

  it("CATEGORY may write its own columns", () => {
    expect(rejectedColumns("CATEGORY", [...CATEGORY_OWNED])).toEqual([]);
  });

  it("CRM owns everything", () => {
    expect(rejectedColumns("CRM", [...TRACKING, ...CRM_OPS, "header", "brand"])).toEqual([]);
  });

  it("the two owned sets do not overlap", () => {
    const overlap = CONTENT_OWNED.filter((c) => (CATEGORY_OWNED as readonly string[]).includes(c));
    expect(overlap).toEqual([]);
  });

  it("a mixed update reports only the forbidden columns", () => {
    expect(rejectedColumns("CONTENT", ["header", "tracking_code", "sub_copy_text"]))
      .toEqual(["tracking_code"]);
  });
});
