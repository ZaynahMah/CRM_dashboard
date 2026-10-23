import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { resolveBrand, BRAND_TITLES } from "./brand";

const read = (p: string) => readFileSync(join(__dirname, p), "utf8");

describe("brand resolution", () => {
  it("fashion and luxury have the exact specified titles", () => {
    expect(BRAND_TITLES.fashion).toBe("Push Notification Planning - TataCLiQ Fashion");
    expect(BRAND_TITLES.luxury).toBe("Push Notification Planning - TataCLiQ Luxury");
  });

  it.each(["luxury", "LUXURY", " Luxury "])("%s resolves to luxury", (v) => {
    expect(resolveBrand(v)).toBe("luxury");
  });

  it.each(["fashion", "FASHION", " fashion "])("%s resolves to fashion", (v) => {
    expect(resolveBrand(v)).toBe("fashion");
  });

  it("defaults to fashion when unset, so the live app keeps working", () => {
    expect(resolveBrand(undefined)).toBe("fashion");
    expect(resolveBrand("")).toBe("fashion");
  });

  it("an unrecognised value falls back rather than rendering nonsense", () => {
    expect(resolveBrand("beauty")).toBe("fashion");
  });
});

describe("the title is defined once and used everywhere", () => {
  it.each([
    ["../app/login/page.tsx", "login page"],
    ["../components/AppShell.tsx", "sidebar"],
    ["../app/layout.tsx", "browser tab"],
  ])("%s imports BRAND_TITLE", (f) => {
    expect(read(f)).toContain('from "@/lib/brand"');
    expect(read(f)).toContain("BRAND_TITLE");
  });

  it("no hard-coded old product name remains in the UI", () => {
    for (const f of ["../app/login/page.tsx", "../components/AppShell.tsx",
                     "../app/layout.tsx"]) {
      expect(read(f)).not.toContain("CLiQ Push Ops");
      expect(read(f)).not.toMatch(/Fashion &(amp;)? Luxury/);
    }
  });

  it("the sidebar shows no logo after login", () => {
    const shell = read("../components/AppShell.tsx");
    const block = shell.slice(shell.indexOf("No logo after login"),
                              shell.indexOf("<nav className="));
    expect(block).not.toContain("Icon.bell");
  });

  it("the login page keeps its icon — it is pre-login, not the app shell", () => {
    expect(read("../app/login/page.tsx")).toContain("Icon.bell(18)");
  });
});
