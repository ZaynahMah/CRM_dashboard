import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const sql = readFileSync(join(__dirname, "../../supabase/29_reset_running_pns.sql"), "utf8");
const route = readFileSync(join(__dirname, "../app/api/reset-running/route.ts"), "utf8");
const upload = readFileSync(join(__dirname, "../components/CrmInputUpload.tsx"), "utf8");

/** The running predicate, mirrored from is_running_pn(). */
const isRunning = (c: { calendar_status?: string | null; qc_status?: string | null;
                        production_status?: string | null }) =>
  c.calendar_status !== "UPDATED" && c.qc_status !== "PASSED"
  && c.production_status !== "READY";

describe("the running filter", () => {
  it("includes a plain in-flight PN", () => {
    expect(isRunning({ calendar_status: "NOT_UPDATED", qc_status: "PENDING",
                       production_status: "NOT_READY" })).toBe(true);
  });

  it("excludes a calendared PN", () => {
    expect(isRunning({ calendar_status: "UPDATED", qc_status: "PASSED",
                       production_status: "READY" })).toBe(false);
  });

  it("excludes a QC-passed PN even if not calendared", () => {
    expect(isRunning({ calendar_status: "NOT_UPDATED", qc_status: "PASSED",
                       production_status: "NOT_READY" })).toBe(false);
  });

  it("excludes a production-ready PN", () => {
    expect(isRunning({ calendar_status: "NOT_UPDATED", qc_status: "PENDING",
                       production_status: "READY" })).toBe(false);
  });

  it("INCLUDES a PN with NULL statuses — the reason for IS DISTINCT FROM", () => {
    expect(isRunning({ calendar_status: null, qc_status: null,
                       production_status: null })).toBe(true);
  });

  it("the SQL uses IS DISTINCT FROM, never plain <>", () => {
    const fn = sql.slice(sql.indexOf("create or replace function public.is_running_pn"),
                         sql.indexOf("$$;", sql.indexOf("create or replace function public.is_running_pn")));
    expect(fn).toContain("is distinct from 'UPDATED'");
    expect(fn).toContain("is distinct from 'PASSED'");
    expect(fn).toContain("is distinct from 'READY'");
    expect(fn).not.toMatch(/<>\s*'UPDATED'/);
  });
});

describe("migration 29", () => {
  it("every DELETE carries a WHERE", () => {
    const lines = sql.split("\n");
    lines.forEach((ln, i) => {
      if (!/^\s*delete from /i.test(ln) || ln.trim().startsWith("--")) return;
      let buf = "", j = i;
      while (j < lines.length && !buf.includes(";")) { buf += " " + lines[j].toLowerCase(); j++; }
      expect(buf, `line ${i + 1} has no WHERE`).toMatch(/\swhere\s/);
    });
  });

  it("every campaign DELETE is scoped to running PNs", () => {
    const deletes = sql.split("\n").filter((l) => /^\s*delete from campaigns\b/i.test(l));
    expect(deletes.length).toBeGreaterThan(0);
    for (const d of deletes) {
      const after = sql.slice(sql.indexOf(d), sql.indexOf(";", sql.indexOf(d)));
      expect(after).toContain("is_running_pn");
    }
  });

  it("archives BEFORE deleting, and verifies the count first", () => {
    const fn = sql.slice(sql.indexOf("function public.reset_running_pns"));
    expect(fn.indexOf("insert into campaigns_archive"))
      .toBeLessThan(fn.indexOf("delete from campaigns"));
    expect(fn).toContain("Archive incomplete:");
  });

  it("is CRM-only, as the first statement", () => {
    const fn = sql.slice(sql.indexOf("function public.reset_running_pns"));
    expect(fn.indexOf("is_crm()")).toBeLessThan(fn.indexOf("insert into campaigns_archive"));
  });

  it("logs who, when, which flow and how many", () => {
    expect(sql).toContain("insert into activities");
    expect(sql).toContain("RESET_RUNNING");
    expect(sql).toContain("RESET_RUNNING_PNS");
  });

  it("the upload reset now uses the same filter", () => {
    const fn = sql.slice(sql.indexOf("function public.reset_campaigns_with_archive"));
    expect(fn).toContain("is_running_pn");
    // and keeps the no-rows protection
    expect(fn).toContain("the uploaded sheet contains no rows");
  });

  it("every function sets search_path", () => {
    const defs = sql.match(/create (or replace )?function public\.\w+[\s\S]*?language \w+[^\n]*/g) ?? [];
    expect(defs.length).toBeGreaterThan(3);
  });
});

describe("the API route", () => {
  it("returns 403 for a non-CRM session", () => {
    expect(route).toContain('!== "CRM"');
    expect(route).toContain("status: 403");
  });

  it("returns 401 when not signed in", () => expect(route).toContain("status: 401"));

  it("uses no service-role key", () => {
    expect(route).not.toMatch(/SERVICE_ROLE/i);
    expect(route).not.toMatch(/service_role/);
  });

  it("checks the role BEFORE calling the RPC", () => {
    // Strip comments: the header explains the function by name.
    const code = route.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code.indexOf('!== "CRM"')).toBeLessThan(code.indexOf("reset_running_pns"));
  });
});

describe("the Reset UI", () => {
  it("is CRM-only and disabled with nothing running", () => {
    expect(upload).toContain("isCrm && (");
    expect(upload).toContain('runningCount === 0 ? "Nothing running"');
    expect(upload).toContain("disabled={reading || runningCount === 0}");
  });

  it("requires RESET typed exactly", () => {
    expect(upload).toContain('resetTyped !== "RESET"');
  });

  it("shows N before confirming", () => {
    expect(upload).toContain("{runningCount}</span> running");
  });

  it("toasts afterwards", () => {
    expect(upload).toContain("PNs reset. Upload a new file to start again.");
  });

  it("the upload text says running PNs only", () => {
    expect(upload).toContain("uploading replaces the RUNNING PNs of this stream only");
    expect(upload).not.toContain("uploading replaces every existing campaign");
  });

  it("goes through the server route, not a direct RPC", () => {
    const svc = readFileSync(join(__dirname, "../services/campaigns.ts"), "utf8");
    expect(svc).toContain('fetch("/api/reset-running"');
  });
});
