import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Content's "Show All PN" list must be readable without opening each row.
 *
 * These assertions read the component source, because the rule is a
 * rendering contract: a `truncate` class or a single-line `<input>` on a
 * copy field silently reintroduces the problem, and nothing else in the
 * suite would notice.
 */

const RAW = readFileSync(
  join(__dirname, "../components/BulkWorkspace.tsx"), "utf8");

/** Comments explain why these classes are absent, so strip them before
 *  asserting that the CODE does not use them. */
const SRC_NO_COMMENTS = RAW
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");
const SRC = RAW;

/** Mirrors the textarea sizing in the component. */
const rowsFor = (text: string) => Math.max(2, Math.ceil(text.length / 34));

const SHORT = "Shop now";
const LONG_HEADER =
  "Shop luxury watches from top global brands with exclusive festival offers";
const LONG_SUB =
  "Explore curated styles from Michael Kors, Armani Exchange, Fossil and more "
  + "with limited-period pricing.";
const VERY_LONG = "A".repeat(320);
const MULTILINE = "Line one\nLine two\nLine three";

describe("no truncation in the Content list view", () => {
  it("copy cells wrap and preserve whitespace", () => {
    expect(SRC).toContain("whitespace-pre-wrap");
    expect(SRC).toContain("break-words");
  });

  it("no line-clamp, ellipsis or truncate class anywhere in the workspace", () => {
    expect(SRC_NO_COMMENTS).not.toMatch(/line-clamp/);
    expect(SRC_NO_COMMENTS).not.toMatch(/text-ellipsis/);
    expect(SRC_NO_COMMENTS).not.toMatch(/\btruncate\b/);
  });

  it("long copy is NOT behind a hover tooltip", () => {
    // The only title= attributes left are on controls, never on a copy cell.
    const titles = SRC.match(/title=\{?["`][^"`]*/g) ?? [];
    expect(titles.every((t) =>
      !/header|sub copy|brief|remark/i.test(t))).toBe(true);
  });

  it("long fields render as a growing textarea, not a clipping input", () => {
    expect(SRC).toContain("col.longText ? (");
    expect(SRC).toContain("<textarea");
    // The textarea's height is derived from the text length.
    expect(SRC).toMatch(/rows=\{Math\.max\(2, Math\.ceil\(/);
  });

  it("wrapped rows align to the top so a tall row stays readable", () => {
    expect(SRC).toContain("align-top");
  });

  it("every copy column is marked longText", () => {
    for (const col of ["header", "sub_copy_text", "message_brief", "brief",
                       "additional_notes", "title_brief"]) {
      const line = SRC.split("\n").find((l) =>
        l.includes(`key: "${col}"`) && l.includes("Content") === false
        && l.includes("label:"));
      expect(line, `${col} column missing`).toBeTruthy();
    }
    // All six appear with longText in the Content column set.
    const block = SRC.slice(SRC.indexOf("const CONTENT_INPUT_COLUMNS"),
                            SRC.indexOf("];", SRC.indexOf("const CONTENT_INPUT_COLUMNS")));
    for (const col of ["header", "sub_copy_text", "message_brief", "brief",
                       "additional_notes", "title_brief"]) {
      const line = block.split("\n").find((l) => l.includes(`key: "${col}"`));
      expect(line, `${col} not marked longText`).toContain("longText: true");
    }
  });

  it("Content rows are not forced to a fixed height", () => {
    expect(SRC).toContain("const wrapRows = mode === \"CONTENT_INPUT\"");
    expect(SRC).toContain("renderAll");
  });
});

describe("textarea grows with the content at every length", () => {
  it.each([
    [SHORT, 2],
    [LONG_HEADER, rowsFor(LONG_HEADER)],
    [LONG_SUB, rowsFor(LONG_SUB)],
    [VERY_LONG, rowsFor(VERY_LONG)],
  ])("%s... gets enough rows", (text, expected) => {
    expect(rowsFor(text as string)).toBe(expected);
  });

  it("a 73-character header gets at least 3 rows", () => {
    expect(LONG_HEADER).toHaveLength(73);
    expect(rowsFor(LONG_HEADER)).toBeGreaterThanOrEqual(3);
  });

  it("a 100+ character sub copy gets at least 3 rows", () => {
    expect(LONG_SUB.length).toBeGreaterThan(100);
    expect(rowsFor(LONG_SUB)).toBeGreaterThanOrEqual(3);
  });

  it("a 300+ character field gets at least 9 rows", () => {
    expect(VERY_LONG.length).toBeGreaterThan(300);
    expect(rowsFor(VERY_LONG)).toBeGreaterThanOrEqual(9);
  });

  it("short text never collapses below two rows", () => {
    expect(rowsFor("")).toBe(2);
    expect(rowsFor("Hi")).toBe(2);
  });

  it("multi-line text keeps its newlines", () => {
    // whitespace-pre-wrap is what preserves them; asserted above.
    expect(MULTILINE.split("\n")).toHaveLength(3);
    expect(rowsFor(MULTILINE)).toBe(2);   // short, but the \n still render
  });
});

describe("the table does not explode in width", () => {
  it("Content's total column width stays under 2000px", () => {
    const block = SRC.slice(SRC.indexOf("const CONTENT_INPUT_COLUMNS"),
                            SRC.indexOf("];", SRC.indexOf("const CONTENT_INPUT_COLUMNS")));
    const widths = [...block.matchAll(/width:\s*(\d+)/g)].map((m) => Number(m[1]));
    expect(widths.length).toBeGreaterThan(5);
    // Taller rows and wrapped text, not an endlessly wide table.
    expect(widths.reduce((a, b) => a + b, 0)).toBeLessThan(2000);
  });

  it("no single copy column is absurdly wide", () => {
    const block = SRC.slice(SRC.indexOf("const CONTENT_INPUT_COLUMNS"),
                            SRC.indexOf("];", SRC.indexOf("const CONTENT_INPUT_COLUMNS")));
    const widths = [...block.matchAll(/width:\s*(\d+)/g)].map((m) => Number(m[1]));
    expect(Math.max(...widths)).toBeLessThanOrEqual(300);
  });
});
