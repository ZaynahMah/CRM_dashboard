import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import cohorts from "@/data/cohort_informations.json";

const read = (p: string) => readFileSync(join(__dirname, p), "utf8");

describe("cohort_informations.json", () => {
  it("lives beside masterData.json", () => {
    expect(() => read("../data/cohort_informations.json")).not.toThrow();
    expect(() => read("../data/masterData.json")).not.toThrow();
  });

  it("Tab 1 carries every segment supplied", () => {
    // 51 as counted from the source list, not the 46 originally stated.
    expect(cohorts.segment_directory).toHaveLength(51);
  });

  it("Tab 2 has the TC mappings", () => {
    expect(cohorts.tc_segments).toHaveLength(31);
    expect(cohorts.tc_segments[0]).toEqual({
      segment: "Active Repeat Women", segment_name_in_tc: "ActRpt_Wom_10July26" });
  });

  it("keeps the spellings verbatim — nothing was corrected", () => {
    const names = cohorts.segment_directory.map((s) => s.segment_name);
    expect(names).toContain("Predom_Kids45D_2yMay");      // not 27May
    expect(names).toContain("HIghHOV_IOS_Feb2026");       // capital I
    expect(names).toContain("search_kids_040825");        // lowercase
    expect(names).toContain("Two time westside purchasers");
  });

  it('"and exclude users in" stays on its own line', () => {
    const multi = cohorts.segment_directory.filter((s) => s.definition.includes("\n"));
    expect(multi.length).toBeGreaterThan(20);
    for (const s of multi) {
      expect(s.definition).toContain("\nand exclude users in\n");
    }
  });

  it("every row has a name, a base size and a definition", () => {
    for (const s of cohorts.segment_directory) {
      expect(s.segment_name.trim()).not.toBe("");
      expect(s.base_size.trim()).not.toBe("");
      expect(s.definition.trim()).not.toBe("");
    }
  });

  it("segment names are unique", () => {
    const names = cohorts.segment_directory.map((s) => s.segment_name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("the three large search segments are present in full", () => {
    const byName = Object.fromEntries(
      cohorts.segment_directory.map((s) => [s.segment_name, s]));
    expect(byName["Search_Sports"].definition.length).toBeGreaterThan(900);
    expect(byName["Search_Accessories"].definition.length).toBeGreaterThan(1500);
    expect(byName["Search_Winterwear"].definition.length).toBeGreaterThan(2000);
  });

  it("Tab 3 has both tables and the three lists", () => {
    const d = cohorts.cohort_definitions;
    expect(d.push.rows).toHaveLength(4);
    expect(d.in_app.rows).toHaveLength(4);
    expect(d.push.rows[0]).toEqual({ cohort: "Active", months: "M1-M3" });
    expect(d.combination_segments).toHaveLength(20);
    expect(d.custom_segments).toEqual(["Women", "Men", "Rest of Base", "HNI", "Fullbase"]);
    expect(d.data_segments).toHaveLength(5);
  });
});

describe("the Audience page", () => {
  const page = read("../app/(app)/audience/page.tsx");

  it("reads the file directly — no Supabase, no upload", () => {
    expect(page).toContain('from "@/data/cohort_informations.json"');
    // Comments explain the absence, so assert on CODE, not prose.
    const code = page.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/from "@\/lib\/supabase"/);
    expect(code).not.toMatch(/supabase\./);
  });

  it("has all three tabs", () => {
    for (const t of ["Segment Directory", "TC Segments", "Cohort Definitions"]) {
      expect(page).toContain(t);
    }
  });

  it("searches name AND definition", () => {
    expect(page).toContain("s.definition.toLowerCase().includes(t)");
  });

  it("shows two lines then expands, preserving line breaks", () => {
    expect(page).toContain('d.split("\\n").slice(0, 2)');
    expect(page).toContain("whitespace-pre-wrap");
    expect(page).toContain("Show full definition");
  });

  it("is visible to all four roles", () => {
    const shell = read("../components/AppShell.tsx");
    const line = shell.split("\n").find((l) => l.includes('href:"/audience"'))!;
    for (const r of ["CATEGORY", "CRM", "CONTENT", "EXECUTIVE"]) expect(line).toContain(r);
  });

  it("the route guard matches the sidebar", () => {
    expect(read("../middleware.ts")).toContain('"/audience"');
    expect(read("../lib/accessPolicy.ts")).toContain('"/audience"');
  });
});
