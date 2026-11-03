import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  editGate, latestByCampaign, badgeFor, unseenDecisions,
  type ChangeRequestRow,
} from "@/services/changeRequests";
import { isTataUnistoreId } from "@/services/storageDays";
import { ROUTE_ROLES, canVisit } from "./accessPolicy";
import type { Campaign } from "@/types/campaign";

const read = (p: string) => readFileSync(join(__dirname, p), "utf8");
const view = read("../components/ChangesView.tsx");
const page = read("../app/(app)/storage/page.tsx");
const sql42 = readFileSync(join(__dirname, "../../supabase/42_change_request_cutoff_and_read.sql"), "utf8");
const sql43 = readFileSync(join(__dirname, "../../supabase/43_force_delete_day.sql"), "utf8");

const row = (o: Partial<ChangeRequestRow> = {}) => ({
  id: "r1", campaign_id: "c1", request_group_id: "g1", field_name: "brand",
  current_value: "a", requested_value: "b", reason: null, status: "PENDING",
  requested_by_name: "Asha", requested_by_role: "CATEGORY",
  reviewed_by_name: null, review_note: null, reviewed_at: null,
  created_at: "2026-11-02T10:00:00Z", ...o,
}) as ChangeRequestRow;

/* ══════════ PART A ══════════ */
describe("Category's window closes at the handoff", () => {
  const pn = (o: Partial<Campaign> = {}) => ({
    id: "c1", calendar_status: "NOT_UPDATED",
    category_submitted_at: "2026-11-01T00:00:00Z",
    content_submitted_at: "2026-11-02T00:00:00Z",
    content_status: "NOT_ASSIGNED", ...o,
  }) as unknown as Campaign;

  it("uses content_status, not crm_status", () => {
    // crm_status keeps advancing after the handoff, so equality on it would
    // re-open the gate at Final QC.
    expect(editGate(pn({ crm_status: "FINAL_QC" } as never), "CATEGORY")).toBeUndefined();
    expect(editGate(pn({ content_status: "PENDING" } as never), "CATEGORY"))
      .toBe("Already sent to Content. Ask CRM.");
  });

  it("the server enforces the same rule", () => {
    expect(sql42).toContain("v_c.content_status is distinct from 'NOT_ASSIGNED'::content_status");
    expect(sql42).toContain("This PN has already been sent to Content. Ask CRM.");
  });

  it("cr_read limits each team to its own requests", () => {
    expect(sql42).toContain("requested_by_role = public.current_app_role()");
    expect(sql42).toContain("public.current_app_role() = 'EXECUTIVE'::app_role");
    expect(sql42).not.toContain("using (true)");
  });
});

describe("the Changes page", () => {
  it("has all four tabs", () => {
    for (const t of ["Pending", "Accepted", "Rejected", "Withdrawn"]) {
      expect(view, t).toContain(`label: "${t}"`);
    }
  });

  it("filters in the query, not per row", () => {
    expect(view).toContain("listRequests({ status: tab, campaignIds");
    const svc = read("../services/changeRequests.ts");
    expect(svc).toContain('q = q.eq("status", filters.status)');
    expect(svc).toContain('q = q.in("campaign_id", filters.campaignIds)');
    expect(svc).toContain('q = q.gte("created_at"');
  });

  it("an empty category selection matches nothing, rather than everything", () => {
    expect(read("../services/changeRequests.ts"))
      .toContain("if (filters.campaignIds.length === 0) return [];");
  });

  it("a reject reason is mandatory", () => {
    expect(view).toContain('if (!accept && !(note[g.groupId] ?? "").trim())');
    expect(view).toContain("A reason is required when rejecting.");
  });

  it("a typed name is mandatory to decide or withdraw", () => {
    expect((view.match(/Enter your name first\./g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("Executive is read-only", () => {
    expect(view).toContain('const readOnly = role === "EXECUTIVE";');
    expect(view).toContain("{!readOnly && head.status === \"PENDING\" && (");
  });

  it("CRM decides; a team withdraws its own", () => {
    expect(view).toContain("{isCrm ? (");
    expect(view).toContain('onClick={() => withdraw(g)}');
  });

  it("all four roles can reach it", () => {
    expect(ROUTE_ROLES["/changes"]).toEqual(["CATEGORY", "CRM", "CONTENT", "EXECUTIVE"]);
  });
});

describe("PN badges and the unseen count", () => {
  it("names the three states", () => {
    expect(badgeFor(row())!.label).toBe("Change pending CRM approval");
    expect(badgeFor(row({ status: "APPROVED" }))!.label).toBe("Change accepted by CRM");
    expect(badgeFor(row({ status: "REJECTED", review_note: "Wrong offer" }))!.label)
      .toBe("Change rejected by CRM: Wrong offer");
  });

  it("a withdrawn request needs no badge", () => {
    expect(badgeFor(row({ status: "WITHDRAWN" }))).toBeNull();
    expect(badgeFor(undefined)).toBeNull();
  });

  it("the latest request per PN wins", () => {
    const m = latestByCampaign([row({ id: "new" }), row({ id: "old" })]);
    expect(m.get("c1")!.id).toBe("new");
  });

  it("counts only decisions newer than the mark", () => {
    const rows = [
      row({ status: "APPROVED", reviewed_at: "2026-11-03T10:00:00Z" }),
      row({ status: "REJECTED", reviewed_at: "2026-11-01T10:00:00Z" }),
      row({ status: "PENDING" }),
    ];
    expect(unseenDecisions(rows, "2026-11-02T00:00:00Z")).toBe(1);
    expect(unseenDecisions(rows, "")).toBe(0);
  });
});

/* ══════════ PART B ══════════ */
describe("the removed pages", () => {
  it("are DENIED, not merely unlisted", () => {
    // An unlisted path falls through to "allowed" in canVisit, so removing
    // the entry would have opened them to everyone.
    expect(ROUTE_ROLES["/qc"]).toEqual([]);
    expect(ROUTE_ROLES["/audience"]).toEqual([]);
    for (const r of ["CRM", "CATEGORY", "CONTENT", "EXECUTIVE"]) {
      expect(canVisit(r as never, "/qc"), r).toBe(false);
      expect(canVisit(r as never, "/audience"), r).toBe(false);
    }
  });

  it("are gone from the sidebar", () => {
    const shell = read("../components/AppShell.tsx");
    expect(shell).not.toContain('href:"/qc"');
    expect(shell).not.toContain('href:"/audience"');
  });

  it("the Final QC WORK still lives in the board, untouched", () => {
    const board = read("../components/CrmFlowBoard.tsx");
    expect(board).toContain('mode: "FINAL_QC"');
    // The send-back button lives in the workspace the board opens.
    expect(read("../components/BulkWorkspace.tsx"))
      .toContain("Bulk Send Back to Content");
  });
});

/* ══════════ PART C ══════════ */
describe("force delete", () => {
  it("validates the TataUnistore ID in both layers", () => {
    expect(isTataUnistoreId("asha@tataunistore.com")).toBe(true);
    expect(isTataUnistoreId("ASHA@TATAUNISTORE.COM")).toBe(true);
    for (const bad of ["asha@gmail.com", "asha@tataunistore.co", "asha", ""]) {
      expect(isTataUnistoreId(bad), bad).toBe(false);
    }
    expect(sql43).toContain("@tataunistore");
  });

  it("says plainly that there is no undo", () => {
    expect(page).toContain("This deletes PNs teams may still be working on.");
    expect(page).toContain("The backup you just downloaded is the only copy.");
    expect(page).toContain("This cannot be undone.");
  });

  it("needs a backup, a name, the ID and the word DELETE", () => {
    expect(page).toContain('forceTyped !== "DELETE"');
    expect(page).toContain("!forceBackup");
    expect(page).toContain("!isTataUnistoreId(tataId)");
  });

  it("skips ONLY the calendar check", () => {
    expect(sql43).not.toContain("Not ready:");
    for (const guard of ["is_crm() is not true", "for update",
                         "The data changed since your preview",
                         "insert into day_delete_audit"]) {
      expect(sql43, guard).toContain(guard);
    }
  });

  it("records the ID and the forced flag", () => {
    expect(sql43).toContain("performed_by_tataunistore_id");
    expect(sql43).toContain("forced boolean not null default false");
    expect(page).toContain('label="Forced"');
    expect(page).toContain("a.performed_by_tataunistore_id");
  });

  it("the migration itself deletes nothing", () => {
    const D = String.fromCharCode(36, 36);
    const top = sql43.split(D).filter((_, i) => i % 2 === 0).join(" ");
    expect(top).not.toMatch(/^\s*delete from/im);
  });
});
