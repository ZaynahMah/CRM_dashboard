import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { TITLE_BRIEFS, isLegacyTitleBrief } from "@/config/pnOptions";
import { ROUTE_ROLES } from "./accessPolicy";

const read = (p: string) => readFileSync(join(__dirname, p), "utf8");
const page = read("../app/(app)/storage/page.tsx");
const route = read("../app/api/day-backup/route.ts");
const sql40 = readFileSync(
  join(__dirname, "../../supabase/40_storage_delete_days.sql"), "utf8");
const sql41 = readFileSync(
  join(__dirname, "../../supabase/41_storage_read_crm_only.sql"), "utf8");

/* ══════════ PART A ══════════ */
describe("A — Storage is CRM only", () => {
  it("the route policy lists CRM alone", () => {
    expect(ROUTE_ROLES["/storage"]).toEqual(["CRM"]);
  });

  it("middleware and nav agree", () => {
    expect(read("../middleware.ts")).toContain('"/storage":     ["CRM"]');
    expect(read("../components/AppShell.tsx")).toContain('href:"/storage"');
    expect(read("../components/AppShell.tsx")).toContain('roles:["CRM"]');
  });

  it("the page refuses a non-CRM profile", () => {
    expect(page).toContain('profile.role !== "CRM"');
    expect(page).toContain("Storage is a CRM-only page.");
  });

  it("the backup route checks CRM before reading anything", () => {
    const code = route.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code.indexOf('!== "CRM"')).toBeLessThan(code.indexOf('.from("campaigns")'));
    expect(route).toContain("status: 403");
  });

  it("the backup route reads only", () => {
    expect(route).not.toMatch(/\.delete\(|\.insert\(|\.update\(/);
  });

  it("the backup includes every child table", () => {
    for (const t of ["activity_logs", "notifications", "qc_checklists",
                     "change_requests", "crm_decisions",
                     "content_change_sets", "content_submissions"]) {
      expect(route, t).toContain(`"${t}"`);
    }
  });

  it("its signature matches day_delete_signature byte for byte", () => {
    expect(route).toContain("`${r.id}:${r.updated_at ?? \"\"}`");
    expect(route).toContain('.join("|")');
    expect(route).toContain('"SHA-256"');
    expect(sql40).toContain("c.id::text || ':' || coalesce(c.updated_at::text,'')");
    expect(sql40).toContain("'|' order by c.id");
  });
});

describe("A — the delete flow", () => {
  it("needs a backup, a typed name and the typed date", () => {
    expect(page).toContain("disabled={busy || !backup || typed !== day || name.trim() === \"\"}");
  });

  it("never claims success on failure", () => {
    expect(page).toContain("// Never a success message for a failed delete.");
    const fn = page.slice(page.indexOf("const runDelete"), page.indexOf("return ("));
    // setDone runs only after deleteDay resolves; the catch sets setError.
    expect(fn.indexOf("setDone(")).toBeGreaterThan(fn.indexOf("await deleteDay("));
    expect(fn).toContain("} catch (e) {");
  });

  it("shows blockers with links, and no Delete button when not ready", () => {
    expect(page).toContain("Not ready: {s.blocking} PN");
    expect(page).toContain("/campaigns?open=${b.id}");
    // Force delete sits beside it, so the condition now excludes that too.
    expect(page).toContain("{s.eligible && !isOpen && forceOpen !== day && (");
  });

  it("states in plain words what disappears", () => {
    for (const t of ["Calendar", "Final View", "every export",
                     "Executive numbers", "Reset last upload"]) {
      expect(page, t).toContain(t);
    }
    expect(page).toContain("There is no snapshot.");
    expect(page).toContain("Export first:");
  });

  it("is honest about freed space", () => {
    expect(page).toContain("does not show immediately");
  });

  it("shows the audit history", () => {
    expect(page).toContain("Deletion history");
    expect(page).toContain("listDeleteAudit");
  });
});

describe("migration 40 matches what was run", () => {
  it("uses sha256(convert_to(...)), not pgcrypto digest()", () => {
    expect(sql40).toContain("encode(sha256(convert_to(");
    expect(sql40).not.toContain("digest(");
  });

  it("qualifies relname in the size query", () => {
    expect(sql40).toContain("select c.relname,");
  });

  it("deletes nothing at install", () => {
    const D = String.fromCharCode(36, 36);
    const top = sql40.split(D).filter((_, i) => i % 2 === 0).join(" ");
    expect(top).not.toMatch(/^\s*delete from/im);
  });
});

describe("migration 41 (awaiting approval)", () => {
  it("adds the CRM check to all three read functions", () => {
    expect((sql41.match(/is_crm\(\) is not true/g) ?? [])).toHaveLength(3);
  });

  it("uses the null-safe form", () => {
    expect(sql41).not.toMatch(/if not public\.is_crm\(\)/);
  });
});

/* ══════════ PART B ══════════ */
describe("B — Title Brief is a dropdown for CRM", () => {
  it("has exactly these nine options in order", () => {
    expect([...TITLE_BRIEFS]).toEqual([
      "Offer Led", "Brand Led", "Category Led", "Sub Category Led",
      "Minimal (Short)", "Creative Content", "Clickbait (Curiosity)",
      "FOMO (Urgency)", "Emoji Led"]);
  });

  it('"Select" is only a placeholder', () => {
    expect(TITLE_BRIEFS).not.toContain("Select" as never);
    expect(read("../components/CampaignDrawer.tsx"))
      .toContain('<option value="">Select</option>');
  });

  it("an old free-text value is recognised and kept", () => {
    expect(isLegacyTitleBrief("Festive push angle")).toBe(true);
    expect(isLegacyTitleBrief("Offer Led")).toBe(false);
    expect(isLegacyTitleBrief(null)).toBe(false);
    expect(isLegacyTitleBrief("")).toBe(false);
  });

  it("it stays selectable and is flagged, never rewritten", () => {
    const d = read("../components/CampaignDrawer.tsx");
    expect(d).toContain("isLegacyTitleBrief(campaign.title_brief) && (");
    expect(d).toContain("not in list");
  });

  it("the CRM review grid uses the same constant", () => {
    const bulk = read("../components/BulkWorkspace.tsx");
    const cat = bulk.slice(bulk.indexOf("const CATEGORY_COLUMNS"),
                           bulk.indexOf("];", bulk.indexOf("const CATEGORY_COLUMNS")));
    expect(cat).toContain("options: TITLE_BRIEFS");
  });

  it("Content's view stays read-only text", () => {
    const bulk = read("../components/BulkWorkspace.tsx");
    const content = bulk.slice(bulk.indexOf("CONTENT_INPUT_COLUMNS"),
                               bulk.indexOf("];", bulk.indexOf("CONTENT_INPUT_COLUMNS")));
    expect(content.split("\n").find((l) => l.includes('key: "title_brief"'))!)
      .toContain('type: "readonly"');
  });

  it("no database CHECK was added — old values must keep working", () => {
    expect(sql40).not.toMatch(/title_brief.*check/i);
    expect(sql41).not.toMatch(/title_brief/i);
  });

  it("Title Brief is still mandatory for sending", async () => {
    const { PART2_FIELDS } = await import("./crmPart2");
    expect(PART2_FIELDS.map((f) => f.key)).toContain("title_brief");
  });
});
