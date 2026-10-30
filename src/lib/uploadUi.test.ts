import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const read = (p: string) => readFileSync(join(__dirname, p), "utf8");
const up = read("../components/CrmInputUpload.tsx");
const route = read("../app/api/upload-backup/route.ts");
const flags = read("./featureFlags.ts");
const svc = read("../services/campaigns.ts");

/* ══════════ 4. the old global Reset is gone ══════════ */
describe("the old global reset is removed", () => {
  it("the API route no longer exists", () => {
    expect(existsSync(join(__dirname, "../app/api/reset-running/route.ts"))).toBe(false);
  });

  it("its test file no longer exists", () => {
    expect(existsSync(join(__dirname, "./resetRunning.test.ts"))).toBe(false);
  });

  it("runningPnCount and resetRunningPns are gone from the service", () => {
    expect(svc).not.toMatch(/export async function runningPnCount/);
    expect(svc).not.toMatch(/export async function resetRunningPns/);
  });

  it("nothing calls the old reset functions", () => {
    const code = up.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(code).not.toMatch(/reset_running_pns/);
    expect(up).not.toMatch(/\/api\/reset-running/);
  });

  it("the Reset (n) counter and its modal are gone", () => {
    expect(up).not.toMatch(/runningCount/);
    expect(up).not.toMatch(/Nothing running/);
  });
});

/* ══════════ 2. the feature flag ══════════ */
describe("the flag rolls back in one step", () => {
  it("defaults to OFF", () => {
    expect(flags).toContain('NEXT_PUBLIC_BATCH_UPLOAD_ENABLED ?? ""');
    expect(flags).toContain('=== "true"');
  });

  it("every new behaviour is gated on it", () => {
    for (const gated of [
      "BATCH_UPLOAD_ENABLED && priorUpload",
      "BATCH_UPLOAD_ENABLED && dayPreview.length > 0",
      "BATCH_UPLOAD_ENABLED && isCrm && batchPreview",
      "if (BATCH_UPLOAD_ENABLED) {",
    ]) expect(up).toContain(gated);
  });

  it("with the flag OFF the old upload path is untouched", () => {
    // The original RPC is still there, reached when the flag is false.
    expect(up).toContain('"reset_campaigns_with_archive"');
    expect(up.indexOf("if (BATCH_UPLOAD_ENABLED) {"))
      .toBeLessThan(up.indexOf('"reset_campaigns_with_archive"'));
  });
});

/* ══════════ 1. add-only upload ══════════ */
describe("the new upload is add-only", () => {
  it("calls add_upload_batch", () => {
    expect(up).toContain("await addUploadBatch(");
  });

  it("says add-only in the card wording", () => {
    expect(up).toContain("Uploads are ADD-ONLY");
    expect(up).toContain("Uploads from before this update can't be reset here");
  });

  it("shows the per-day preview and the past-date flag", () => {
    expect(up).toContain("Already exist");
    expect(up).toContain('d.isPast ? "past date" : ""');
  });

  it("warns when the same file was uploaded before", () => {
    expect(up).toContain("This exact file was uploaded on");
  });

  it("a failed warning never blocks the upload", () => {
    expect(up).toContain("// A failed warning must never block the upload itself.");
  });

  it("requires a typed name", () => {
    expect(up).toContain("uploadName.trim()");
  });
});

/* ══════════ 3. reset last upload ══════════ */
describe("reset last upload", () => {
  it("previews first", () => {
    expect(up).toContain("resetLastUploadPreview(isCrmSelf)");
    expect(up).toContain("will be removed");
    expect(up).toContain("kept — a team has touched them");
  });

  it("explains why rows are kept", () => {
    expect(up).toContain("Anything that cannot be checked is kept");
  });

  it("the backup must be downloaded before the button enables", () => {
    expect(up).toContain("disabled={resetBusy || !backup || resetTyped !== \"RESET\"");
  });

  it("requires the typed name and typed RESET", () => {
    expect(up).toContain('resetTyped !== "RESET"');
    expect(up).toContain('uploadName.trim() === ""');
  });

  it("presents the server hash unchanged", () => {
    expect(up).toContain("backupSha: backup.sha");
    expect(up).not.toMatch(/backupSha: await sha256Of/);
  });

  it("surfaces the stale-preview error", () => {
    expect(up).toContain("setResetError(e instanceof Error ? e.message : String(e))");
    const sql = readFileSync(
      join(__dirname, "../../supabase/32_upload_batches_and_reset.sql"), "utf8");
    expect(sql).toContain("The data changed since your preview");
  });

  it("is hidden when nothing is untouched", () => {
    expect(up).toContain("batchPreview.untouched === 0");
  });
});

/* ══════════ 5. the backup route checks CRM itself ══════════ */
describe("the backup route", () => {
  it("returns 403 for a non-CRM session", () => {
    expect(route).toContain('!== "CRM"');
    expect(route).toContain("status: 403");
  });

  it("checks the role BEFORE reading any campaign", () => {
    const code = route.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code.indexOf('!== "CRM"')).toBeLessThan(code.indexOf('.from("campaigns")'));
  });

  it("uses no service-role key", () => {
    expect(route).not.toMatch(/service_role/i);
  });

  it("reads only — it never writes or deletes", () => {
    expect(route).not.toMatch(/\.delete\(|\.insert\(|\.update\(/);
  });

  it("is deterministic: id order, sorted columns, id:updated_at signature", () => {
    expect(route).toContain('.order("id", { ascending: true })');
    expect(route).toContain("Object.keys(rows[0] ?? {}).sort()");
    expect(route).toContain("`${r.id}:${r.updated_at ?? \"\"}`");
  });
});
