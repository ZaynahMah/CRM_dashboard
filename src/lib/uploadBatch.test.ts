import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { previewByDay, buildBackup } from "@/services/uploadBatch";
import type { Campaign } from "@/types/campaign";

const sql = readFileSync(
  join(__dirname, "../../supabase/32_upload_batches_and_reset.sql"), "utf8");
const svc = readFileSync(join(__dirname, "../services/uploadBatch.ts"), "utf8");

const row = (o: Record<string, unknown> = {}) => ({
  launch_date: "2026-11-13", launch_time: "19:30:00", slot_label: "3",
  pncc_segment_label: "Push_Women", category: "Westside", ...o,
});

describe("per-day preview, count-based duplicates", () => {
  it("splits a multi-day file by day", () => {
    const p = previewByDay(
      [row(), row(), row({ launch_date: "2026-11-14" })], [], "2026-11-01");
    expect(p.map((d) => d.date)).toEqual(["2026-11-13", "2026-11-14"]);
    expect(p[0].incoming).toBe(2);
  });

  it("counts an existing row as already present, once", () => {
    const existing = [row({ id: "e1" })] as unknown as Campaign[];
    const p = previewByDay([row(), row()], existing, "2026-11-01");
    expect(p[0].alreadyExist).toBe(1);
    expect(p[0].incoming).toBe(1);   // the second is a genuine new PN
  });

  it("the same file twice shows everything as existing", () => {
    const existing = [row({ id: "a" }), row({ id: "b" })] as unknown as Campaign[];
    const p = previewByDay([row(), row()], existing, "2026-11-01");
    expect(p[0].alreadyExist).toBe(2);
    expect(p[0].incoming).toBe(0);
  });

  it("several PNs may share a slot — a third is still new", () => {
    const existing = [row({ id: "a" }), row({ id: "b" })] as unknown as Campaign[];
    const p = previewByDay([row(), row(), row()], existing, "2026-11-01");
    expect(p[0].incoming).toBe(1);
  });

  it("a different segment in the same slot is NOT a duplicate", () => {
    const existing = [row({ id: "a" })] as unknown as Campaign[];
    const p = previewByDay([row({ pncc_segment_label: "Push_Men" })],
      existing, "2026-11-01");
    expect(p[0].incoming).toBe(1);
    expect(p[0].alreadyExist).toBe(0);
  });

  it("flags past dates", () => {
    const p = previewByDay([row({ launch_date: "2026-10-01" })], [], "2026-11-01");
    expect(p[0].isPast).toBe(true);
  });

  it("a row with no date is skipped, not guessed", () => {
    expect(previewByDay([row({ launch_date: null })], [], "2026-11-01")).toHaveLength(0);
  });
});

describe("the backup is deterministic", () => {
  const rows = [
    { id: "b", updated_at: "2026-11-01T00:00:00Z", campaign_name: "B" },
    { id: "a", updated_at: "2026-11-01T00:00:00Z", campaign_name: "A" },
  ] as unknown as Campaign[];

  it("orders by id and uses a fixed column order", () => {
    const { csv } = buildBackup(rows);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("campaign_name,id,updated_at");   // sorted columns
    expect(lines[1].startsWith("A,a,")).toBe(true);          // id order
  });

  it("the signature is id + updated_at per row, in id order", () => {
    expect(buildBackup(rows).signature)
      .toBe("a:2026-11-01T00:00:00Z|b:2026-11-01T00:00:00Z");
  });

  it("the signature changes if a row changes", () => {
    const changed = ([{ ...rows[1], updated_at: "2026-11-02T00:00:00Z" }, rows[0]]
      ) as unknown as Campaign[];
    expect(buildBackup(changed).signature).not.toBe(buildBackup(rows).signature);
  });

  it("the signature changes if a row is added or removed", () => {
    expect(buildBackup([rows[0]]).signature).not.toBe(buildBackup(rows).signature);
  });
});

describe('migration 32 — "untouched" is conjunctive and fails closed', () => {
  const fn = sql.slice(sql.indexOf("function public.is_untouched_upload_row"),
                       sql.indexOf("grant execute on function public.is_untouched_upload_row"));

  it("requires every status at its starting value", () => {
    for (const c of ["category_status  = 'EMPTY'", "content_status   = 'NOT_ASSIGNED'",
                     "qc_status        = 'PENDING'", "production_status = 'NOT_READY'"]) {
      expect(fn).toContain(c);
    }
  });

  it("never relies on category_status alone", () => {
    expect(sql).toContain("written inconsistently");
    // Many more conditions than just that one.
    expect((fn.match(/and /g) ?? []).length).toBeGreaterThan(20);
  });

  it("requires no child rows in any of the four tables", () => {
    for (const t of ["crm_decisions", "change_requests",
                     "qc_checklists", "content_change_sets"]) {
      expect(fn).toContain(`from ${t}`);
    }
  });

  it("requires no activity beyond the upload event", () => {
    expect(fn).toContain("x.action <> 'UPLOAD_BATCH'");
  });

  it("excludes defaulted and calendar PNs", () => {
    expect(fn).toContain("c.defaulted_at is null");
    expect(fn).toContain("c.calendar_status is distinct from 'UPDATED'");
  });

  it("requires every team-owned column to be empty", () => {
    for (const col of ["sub_category", "brand", "offer", "brief", "landing",
                       "title_brief", "message_brief", "pn_template",
                       "header", "sub_copy_text", "tracking_code"]) {
      expect(fn).toContain(`c.${col} is null`);
    }
  });

  it("a send-back counts as touched", () => {
    expect(fn).toContain("coalesce(c.send_back_count, 0) = 0");
  });
});

describe("migration 32 — the reset itself", () => {
  it("only the MOST RECENT un-reset batch", () => {
    expect(sql).toContain("order by created_at desc limit 1");
    expect(sql).toContain("Only the latest batch can be reset");
  });

  it("is CRM-only, checked first", () => {
    expect(sql.indexOf("is_crm()")).toBeLessThan(sql.indexOf("delete from campaigns"));
  });

  it("requires a backup hash and a typed name", () => {
    expect(sql).toContain("A backup must be downloaded");
    expect(sql).toContain("Your name is required on a reset");
  });

  it("locks the rows and re-evaluates from the CURRENT state", () => {
    expect(sql).toContain("for update");
    expect(sql).toContain("The data changed since your preview");
  });

  it("every DELETE carries a predicate", () => {
    for (const line of sql.split("\n").filter((l) => /^\s*delete from /i.test(l))) {
      expect(line, line).toMatch(/where/i);
    }
  });

  it("deletes only the untouched set", () => {
    const body = sql.slice(sql.indexOf("function public.reset_last_upload("));
    expect(body).toContain("delete from campaigns where id = any(v_now)");
    expect(body).not.toMatch(/delete from campaigns where upload_batch_id/);
  });

  it("writes the audit row and marks the batch reset", () => {
    expect(sql).toContain("insert into upload_reset_audit");
    expect(sql).toContain("set reset_at = now()");
  });

  it("pre-update rows have no batch and cannot be reset", () => {
    expect(sql).toContain("are therefore NOT resettable");
    expect(sql).toContain("upload_batch_id uuid");
  });
});

describe("migration 32 — the upload is add-only", () => {
  const fn = sql.slice(sql.indexOf("function public.add_upload_batch"),
                       sql.indexOf("function public.is_untouched_upload_row"));

  it("inserts only — no delete, no update of a campaign", () => {
    expect(fn).not.toMatch(/delete from/i);
    expect(fn).not.toMatch(/update campaigns\b/i);
    expect(fn).toContain("insert into campaigns");
  });

  it("does not call the old global reset", () => {
    // The header comment explains what it replaces, so assert on the CODE.
    const code = sql.split(String.fromCharCode(10))
      .filter((l) => !l.trim().startsWith("--")).join(String.fromCharCode(10));
    expect(code).not.toMatch(/reset_campaigns_with_archive/);
  });

  it("refuses an empty sheet and rows without a date", () => {
    expect(fn).toContain("the sheet contains no rows");
    expect(fn).toContain("needs a campaign_name and a launch_date");
  });

  it("the migration itself deletes nothing", () => {
    const head = sql.slice(0, sql.indexOf("function public.reset_last_upload("));
    expect(head).not.toMatch(/^\s*delete from/im);
    expect(head).not.toMatch(/drop table/i);
    expect(head).not.toMatch(/truncate/i);
  });

  it("opens with a read-only check query", () => {
    expect(sql.slice(0, sql.indexOf("create table"))).toContain("READ-ONLY CHECK");
  });
});
