import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

/**
 * Supabase enables pg_safeupdate, which rejects an unqualified DELETE or
 * UPDATE issued through the API — including inside a SECURITY DEFINER
 * function. It surfaces as:
 *
 *   DELETE requires a WHERE clause (SQLSTATE 21000)
 *
 * which is exactly what broke the upload reset: `delete from campaigns;`
 * is legal SQL and runs fine in psql, but fails through PostgREST. Every
 * DELETE and UPDATE therefore needs an explicit predicate, `where true`
 * being the honest one when the intent really is "all rows".
 *
 * This test fails on any new statement that forgets it.
 */

const SQL_DIR = join(__dirname, "../../supabase");

/** Statement-initial DELETE/UPDATE, read as far as its terminating ";". */
function unqualifiedStatements(sql: string): { line: number; text: string }[] {
  const lines = sql.split("\n");
  const out: { line: number; text: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i].trim().toLowerCase();
    if (!/^(delete\s+from|update)\s+[a-z_."]+/.test(head)) continue;
    // Skip commented-out examples and rollback suggestions.
    if (head.startsWith("--")) continue;
    let buf = "", j = i;
    while (j < lines.length && !buf.includes(";")) {
      buf += " " + lines[j].trim().toLowerCase();
      j++;
    }
    if (!/\swhere\s/.test(buf)) out.push({ line: i + 1, text: lines[i].trim() });
  }
  return out;
}

describe("every DELETE and UPDATE in supabase/*.sql has a WHERE clause", () => {
  const files = readdirSync(SQL_DIR).filter((f) => f.endsWith(".sql")).sort();

  it("finds the migration files", () => {
    expect(files.length).toBeGreaterThan(15);
  });

  it.each(files)("%s", (file) => {
    const sql = readFileSync(join(SQL_DIR, file), "utf8");
    const bad = unqualifiedStatements(sql);
    const detail = bad.map((b) => `  line ${b.line}: ${b.text}`).join("\n");
    expect(bad, `${file} has unqualified statements:\n${detail}`).toEqual([]);
  });

  it("the reset still deletes ALL rows, not a subset", () => {
    const sql = readFileSync(join(SQL_DIR, "18_upload_reset_with_archive.sql"), "utf8");
    // `where true` keeps the full wipe; a narrower predicate would be a
    // silent behaviour change, which is the thing to guard against.
    for (const t of ["change_requests", "notifications", "campaigns"]) {
      expect(sql).toContain(`delete from ${t}`);
    }
    expect(sql).toMatch(/delete from campaigns\s+where true/);
    expect(sql).toMatch(/delete from change_requests where true/);
    expect(sql).toMatch(/delete from notifications\s+where true/);
  });

  it("the detector actually catches a bad statement", () => {
    // Guards the guard: a test that can never fail is worthless.
    expect(unqualifiedStatements("delete from campaigns;")).toHaveLength(1);
    expect(unqualifiedStatements("update campaigns set a = 1;")).toHaveLength(1);
    expect(unqualifiedStatements("delete from campaigns where true;")).toHaveLength(0);
    expect(unqualifiedStatements("update campaigns set a = 1\nwhere id is not null;")).toHaveLength(0);
  });
});
