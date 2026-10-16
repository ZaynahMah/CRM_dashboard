import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const read = (p: string) => readFileSync(join(__dirname, p), "utf8");

/* ══════════ P0-1: no dummy notifications ══════════ */
describe("the notification fixture is gone, not hidden", () => {
  const shell = read("../components/AppShell.tsx");

  it("the hard-coded ALERTS array no longer exists", () => {
    expect(shell).not.toMatch(/const ALERTS\s*=/);
  });

  it("neither demo notification string survives anywhere in src", () => {
    for (const f of ["../components/AppShell.tsx", "../services/categorySla.ts"]) {
      expect(read(f)).not.toMatch(/Submissions due for Kids category today/);
      expect(read(f)).not.toMatch(/Email sent to .* category SPOCs/);
    }
  });

  it("the badge count is derived from data, never the literal 2", () => {
    expect(shell).toContain("alerts.length");
    // The old markup hard-coded >2< inside the badge span.
    expect(shell).not.toMatch(/text-white">2<\/span>/);
  });

  it("the badge is hidden when there is nothing to show", () => {
    expect(shell).toContain("alerts.length > 0 &&");
  });

  it("the drawer reads the real shared table", () => {
    expect(shell).toContain("listSystemNotifications");
    expect(shell).toContain("system_notifications".replace("_", "_"));
  });

  it("loading and empty states exist, so an empty list is not mistaken for a bug", () => {
    expect(shell).toContain("Loading notifications");
    expect(shell).toContain("No notifications");
  });

  it("a failure yields an empty list, never a crash of the shell", () => {
    expect(shell).toMatch(/\.catch\(\(\) => \{ if \(!cancelled\) setAlerts\(\[\]\); \}\)/);
  });
});

/* ══════════ P0-2: Changed Fields removed ══════════ */
describe("Changed Fields is removed from the CRM dashboard", () => {
  it("the component file no longer exists", () => {
    expect(existsSync(join(__dirname, "../components/ContentChangesForCrm.tsx"))).toBe(false);
  });

  it("the CRM dashboard does not import or render it", () => {
    const page = read("../app/(app)/overview/page.tsx");
    expect(page).not.toContain("ContentChangesForCrm");
  });

  it("its heading and explanatory copy are gone from src", () => {
    const page = read("../app/(app)/overview/page.tsx");
    expect(page).not.toMatch(/Changed Fields/);
    expect(page).not.toMatch(/What Content edited since you last looked/);
  });

  it("the read and acknowledge calls that served only it are gone", () => {
    const svc = read("../services/contentBulk.ts");
    expect(svc).not.toMatch(/export async function contentChangesForReview/);
    expect(svc).not.toMatch(/export async function acknowledgeContentChanges/);
  });

  it("the underlying edit history is KEPT, as instructed", () => {
    const svc = read("../services/contentBulk.ts");
    expect(svc).toContain("content_change_sets");   // still written
    expect(svc).toContain("diffContentFields");
  });
});

/* ══════════ P0-3: one date-range summary, never two ══════════ */
describe("the date-range summary renders exactly once", () => {
  const src = read("../components/ContentBulkExcel.tsx");

  it("each label appears exactly once in the JSX", () => {
    expect(src.match(/Campaigns Found/g) ?? []).toHaveLength(1);
    expect(src.match(/>Date Range</g) ?? []).toHaveLength(1);
    expect(src.match(/>Categories</g) ?? []).toHaveLength(1);
  });

  it("the summary block itself is not duplicated", () => {
    const block = 'rounded-lg border border-line px-4 py-3';
    expect(src.split(block).length - 1).toBe(1);
  });

  it("the no-results message appears once", () => {
    expect(src.match(/No campaigns found for selected date range/g) ?? []).toHaveLength(1);
  });

  it("the count is computed, never hard-coded", () => {
    expect(src).toContain("summary.count");
    expect(src).toContain("summariseRange(campaigns, range");
    // No literal count anywhere near the label.
    expect(src).not.toMatch(/Campaigns Found<\/dt>\s*<dd[^>]*>\s*\d+\s*</);
  });

  it("changing the range recomputes rather than appends", () => {
    // summary is derived on every render from `range`; there is no array
    // of summaries to push onto, which is what caused the duplicate.
    expect(src).not.toMatch(/setSummar(y|ies)/);
    expect(src).toContain("const summary = summariseRange");
  });
});
