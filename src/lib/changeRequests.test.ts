import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  editableFieldsFor, editGate, validateRequest, changedFields,
  groupRequests, FIELD_LABEL, type ChangeRequestRow,
} from "@/services/changeRequests";
import type { Campaign } from "@/types/campaign";

const read = (p: string) => readFileSync(join(__dirname, p), "utf8");
const drawer = read("../components/CampaignDrawer.tsx");
const sql39 = readFileSync(
  join(__dirname, "../../supabase/39_crm_calendar_lock.sql"), "utf8");

const pn = (o: Partial<Campaign> = {}) => ({
  id: "c1", campaign_name: "PN A", launch_date: "2026-11-12",
  calendar_status: "NOT_UPDATED",
  category_submitted_at: "2026-11-01T00:00:00Z",
  content_submitted_at: "2026-11-02T00:00:00Z",
  brand: "Biba", header: "Old header", ...o,
}) as unknown as Campaign;

/* ══════════ ITEM 6 — ownership ══════════ */
describe("each team may propose only its own fields", () => {
  it("Category's list", () => {
    expect([...editableFieldsFor("CATEGORY")]).toEqual([
      "sub_category", "brand", "offer", "brief", "landing",
      "expected_cvr", "expected_rpv", "additional_notes", "date_time_brief"]);
  });

  it("Content's list", () => {
    expect([...editableFieldsFor("CONTENT")]).toEqual([
      "header", "sub_copy_text", "reference_link"]);
  });

  it("CRM and Executive propose nothing", () => {
    expect(editableFieldsFor("CRM")).toEqual([]);
    expect(editableFieldsFor("EXECUTIVE")).toEqual([]);
  });

  it("the two lists never overlap", () => {
    const a = new Set(editableFieldsFor("CATEGORY"));
    for (const f of editableFieldsFor("CONTENT")) expect(a.has(f)).toBe(false);
  });
});

/* ══════════ when Edit input is available ══════════ */
describe("the Edit input gate", () => {
  it("is open once that team has submitted", () => {
    // Category's window needs content_status still NOT_ASSIGNED.
    expect(editGate(pn({ content_status: "NOT_ASSIGNED" }), "CATEGORY")).toBeUndefined();
    expect(editGate(pn(), "CONTENT")).toBeUndefined();
  });

  /** Migration 42: Category's window closes at the handoff to Content. */
  it("closes for Category once the PN is sent to Content", () => {
    for (const st of ["PENDING", "SUBMITTED", "NEEDS_CHANGES"]) {
      expect(editGate(pn({ content_status: st } as never), "CATEGORY"))
        .toBe("Already sent to Content. Ask CRM.");
    }
  });

  it("Content is unaffected by that cut-off", () => {
    expect(editGate(pn({ content_status: "SUBMITTED" } as never), "CONTENT"))
      .toBeUndefined();
  });

  it('says "On calendar" for a finalised PN', () => {
    expect(editGate(pn({ calendar_status: "UPDATED" }), "CONTENT"))
      .toBe("On calendar");
  });

  it("is closed before submission — drafting stays direct", () => {
    expect(editGate(pn({ category_submitted_at: null }), "CATEGORY"))
      .toMatch(/Not submitted yet/);
    expect(editGate(pn({ content_submitted_at: null }), "CONTENT"))
      .toMatch(/Not submitted yet/);
  });

  it("the calendar reason wins over the not-submitted one", () => {
    expect(editGate(
      pn({ calendar_status: "UPDATED", content_submitted_at: null }), "CONTENT"))
      .toBe("On calendar");
  });

  it("CRM and Executive cannot raise requests", () => {
    expect(editGate(pn(), "CRM")).toMatch(/cannot raise/);
    expect(editGate(pn(), "EXECUTIVE")).toMatch(/cannot raise/);
  });
});

/* ══════════ validation ══════════ */
describe("a request can never blank a mandatory field", () => {
  it.each(["sub_category", "brand", "offer", "brief", "landing",
           "expected_cvr", "expected_rpv"])("%s cannot be emptied", (f) => {
    expect(validateRequest({ [f]: "   " }, "CATEGORY")[0])
      .toMatch(/is required and cannot be left empty/);
  });

  it("Comments and Date / Time Brief may be emptied", () => {
    expect(validateRequest({ additional_notes: "" }, "CATEGORY")).toEqual([]);
    expect(validateRequest({ date_time_brief: "" }, "CATEGORY")).toEqual([]);
  });

  it("Header is capped at 60 and Sub Copy at 200", () => {
    expect(validateRequest({ header: "h".repeat(61) }, "CONTENT")[0])
      .toMatch(/over the 60 limit/);
    expect(validateRequest({ sub_copy_text: "s".repeat(201) }, "CONTENT")[0])
      .toMatch(/over the 200 limit/);
    expect(validateRequest({ header: "h".repeat(60),
      sub_copy_text: "s".repeat(200) }, "CONTENT")).toEqual([]);
  });

  it("an empty request is rejected", () => {
    expect(validateRequest({}, "CONTENT")[0]).toBe("Nothing has changed.");
  });
});

describe("only genuinely changed fields are sent", () => {
  it("an unchanged value is dropped", () => {
    expect(changedFields(pn(), { header: "Old header", brand: "Biba" })).toEqual({});
  });

  it("whitespace-only differences are not changes", () => {
    expect(changedFields(pn(), { header: "  Old header  " })).toEqual({});
  });

  it("a real change is kept", () => {
    expect(changedFields(pn(), { header: "New header" }))
      .toEqual({ header: "New header" });
  });
});

/* ══════════ grouping ══════════ */
describe("fields group into one request", () => {
  const row = (o: Partial<ChangeRequestRow>) => ({
    id: "r1", campaign_id: "c1", request_group_id: "g1",
    field_name: "header", current_value: "a", requested_value: "b",
    reason: null, status: "PENDING", requested_by_name: "Priya",
    requested_by_role: "CONTENT", reviewed_by_name: null, review_note: null,
    created_at: "2026-11-02T10:00:00Z", ...o,
  }) as ChangeRequestRow;

  it("two fields in one group make ONE request", () => {
    const g = groupRequests([row({}), row({ id: "r2", field_name: "sub_copy_text" })]);
    expect(g).toHaveLength(1);
    expect(g[0].rows).toHaveLength(2);
    expect(g[0].team).toBe("CONTENT");
  });

  it("different groups stay separate", () => {
    expect(groupRequests([row({}), row({ id: "r2", request_group_id: "g2" })]))
      .toHaveLength(2);
  });

  it("a pre-migration-38 row with no group stands alone", () => {
    const g = groupRequests([row({ id: "old", request_group_id: null })]);
    expect(g).toHaveLength(1);
    expect(g[0].groupId).toBe("");
  });

  it("labels are human-readable", () => {
    expect(FIELD_LABEL.sub_copy_text).toBe("Sub Copy");
    expect(FIELD_LABEL.expected_cvr).toBe("Expected CVR");
  });
});

/* ══════════ ITEM 5 ══════════ */
describe("item 5 — a calendar PN is read-only for everyone", () => {
  it("the drawer says so before a save is tried", () => {
    expect(drawer).toContain('campaign.calendar_status === "UPDATED" && (');
    expect(drawer).toContain("On calendar");
    expect(drawer).toContain("locked for everyone");
  });

  it("the database blocks CRM too", () => {
    expect(sql39).toContain("public.is_crm() and calendar_status is distinct from 'UPDATED'");
    expect(sql39).toContain("Use Remove from calendar first.");
  });

  it("Remove from calendar still reopens it", () => {
    expect(sql39).toContain("remove_from_calendar");
    expect(drawer).toContain("Remove from calendar");
  });

  it("a push to calendar is still allowed", () => {
    // Blocked only on UPDATED -> UPDATED, so the first push passes.
    expect(sql39).toContain("old.calendar_status = 'UPDATED' and new.calendar_status = 'UPDATED'");
  });
});

/* ══════════ UI wiring ══════════ */
describe("the drawer wiring", () => {
  it("offers the change form to Category and Content only", () => {
    expect(drawer).toContain('(role === "CATEGORY" || role === "CONTENT") && (');
    expect(drawer).toContain("Send these changes to CRM");
  });

  it("shows the pending state and a withdraw", () => {
    expect(drawer).toContain("Change pending CRM approval");
    expect(drawer).toContain("withdrawChangeGroup(myPending.groupId, who)");
  });

  it("disables Edit input with the reason", () => {
    expect(drawer).toContain("disabled={editGate(campaign, role) !== undefined}");
  });

  it("the modal sits above the drawer", () => {
    expect(read("../components/EditInputModal.tsx")).toContain('z="z-[90]"');
  });

  it("the server's own message is shown, not a restatement", () => {
    expect(read("../components/EditInputModal.tsx"))
      .toContain("setError(e instanceof Error ? e.message : String(e))");
  });

  it("a typed name is required everywhere", () => {
    const m = read("../components/EditInputModal.tsx");
    expect(m).toContain('name.trim() !== ""');
    const g = read("../components/ChangeRequestGroups.tsx");
    expect(g).toContain('if (name.trim() === "") { setError("Enter your name first."); return; }');
  });
});
