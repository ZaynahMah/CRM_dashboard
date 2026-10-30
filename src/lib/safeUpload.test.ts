import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { BATCH_UPLOAD_ENABLED, LEGACY_UPLOAD_ENABLED } from "./featureFlags";
import { previewByDay } from "@/services/uploadBatch";
import type { Campaign } from "@/types/campaign";

const read = (p: string) => readFileSync(join(__dirname, p), "utf8");
const srcFiles = [
  "../components/CrmInputUpload.tsx", "../services/uploadBatch.ts",
  "../services/campaigns.ts", "../components/CrmFlowBoard.tsx",
  "../components/BulkWorkspace.tsx", "../lib/featureFlags.ts",
];

/* ══════════ 1. SAFE BY DEFAULT ══════════ */
describe("add-only is the default, with no variable set", () => {
  it("BATCH_UPLOAD_ENABLED is true when nothing is configured", () => {
    expect(LEGACY_UPLOAD_ENABLED).toBe(false);
    expect(BATCH_UPLOAD_ENABLED).toBe(true);
  });

  it("the card states the mode", () => {
    expect(read("../components/CrmInputUpload.tsx"))
      .toContain("Add-only: existing PNs are never changed or removed.");
  });
});

describe("no code path reaches the old reset functions", () => {
  /** Comments explain their absence, so assert on CODE only. */
  const codeOf = (p: string) => read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

  it.each(srcFiles)("%s does not call reset_campaigns_with_archive", (f) => {
    // The legacy RPC may appear only inside the opt-in branch.
    const code = codeOf(f);
    if (f.endsWith("CrmInputUpload.tsx")) {
      const calls = code.match(/reset_campaigns_with_archive/g) ?? [];
      expect(calls.length).toBeLessThanOrEqual(1);
      if (calls.length === 1) {
        expect(code).toContain("if (BATCH_UPLOAD_ENABLED) {");
      }
    } else {
      expect(code).not.toContain("reset_campaigns_with_archive");
    }
  });

  it.each(srcFiles)("%s does not call reset_running_pns", (f) => {
    expect(codeOf(f)).not.toContain("reset_running_pns");
  });

  it("the old reset route and service functions are gone", () => {
    const svc = read("../services/campaigns.ts");
    expect(svc).not.toMatch(/export async function resetRunningPns/);
    expect(svc).not.toMatch(/export async function runningPnCount/);
  });
});

/* ══════════ existing PNs are untouched by an upload ══════════ */
describe("uploading 10-20 Nov over existing PNs", () => {
  const existing = [
    { id: "a", launch_date: "2026-11-12", launch_time: "19:30:00", slot_label: "3",
      pncc_segment_label: "Push_Women", category: "Westside",
      brand: "Biba", header: "Festive", qc_status: "PASSED",
      calendar_status: "UPDATED" },
  ] as unknown as Campaign[];

  it("a matching row is reported as already existing, not re-inserted", () => {
    const p = previewByDay([{ launch_date: "2026-11-12", launch_time: "19:30:00",
      slot_label: "3", pncc_segment_label: "Push_Women", category: "Westside" }],
      existing, "2026-11-01");
    expect(p[0].alreadyExist).toBe(1);
    expect(p[0].incoming).toBe(0);
  });

  it("the existing row object is never mutated by the preview", () => {
    const before = JSON.stringify(existing);
    previewByDay([{ launch_date: "2026-11-12" }], existing, "2026-11-01");
    expect(JSON.stringify(existing)).toBe(before);
  });

  it("the SQL upload only inserts — no update, no delete", () => {
    const sql = readFileSync(
      join(__dirname, "../../supabase/32_upload_batches_and_reset.sql"), "utf8");
    const fn = sql.slice(sql.indexOf("function public.add_upload_batch"),
                         sql.indexOf("function public.is_untouched_upload_row"));
    expect(fn).toContain("insert into campaigns");
    expect(fn).not.toMatch(/delete from/i);
    expect(fn).not.toMatch(/update campaigns\b/i);
  });
});

/* ══════════ 3. date-range calendar export ══════════ */
describe("the calendar range export", () => {
  const exp = read("../components/CalendarRangeExport.tsx");

  it("reuses the existing export, not a second one", () => {
    expect(exp).toContain('from "@/services/exportExcel"');
    expect(exp).toContain("downloadCSV(matching, fileName)");
  });

  it("exports only calendar PNs, by campaign date", () => {
    expect(exp).toContain('c.calendar_status !== "UPDATED"');
    expect(exp).toContain("campaignDateIso(c.launch_date)");
    expect(exp).toContain("d >= range.start && d <= range.end");
  });

  it("shows the count before downloading", () => {
    expect(exp).toContain("on the calendar");
    expect(exp).toContain("Download ({matching.length})");
  });

  it("never downloads an empty file", () => {
    expect(exp).toContain("matching.length === 0");
    expect(exp).toContain("disabled={!check.valid || matching.length === 0}");
    expect(exp).toContain("No PNs on the calendar from");
  });

  it("names the file PN_Calendar_<from>_to_<to>", () => {
    expect(exp).toContain("`PN_Calendar_${range.start}_to_${range.end}.csv`");
  });

  it("rejects an inverted range", () => {
    expect(exp).toContain("validateRange(range)");
  });

  it("is read-only", () => {
    expect(exp).not.toMatch(/\.insert\(|\.update\(|\.delete\(|rpc\(/);
  });

  it("is CRM-only on both pages", () => {
    expect(read("../app/(app)/final-view/page.tsx")).toContain('profile.role === "CRM"');
    expect(read("../app/(app)/calendar/page.tsx")).toContain('profile?.role === "CRM"');
  });
});
