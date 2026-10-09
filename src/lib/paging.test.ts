import { describe, it, expect } from "vitest";
import { fetchAllPages, PAGE_SIZE } from "./paging";

/** A server that silently truncates every response at 1,000 rows. */
const cappedServer = (total: number, cap = PAGE_SIZE) => {
  let calls = 0;
  const rows = Array.from({ length: total }, (_, i) => ({ id: i }));
  return {
    get calls() { return calls; },
    fetchPage: async (from: number, to: number) => {
      calls++;
      return rows.slice(from, Math.min(to + 1, from + cap));
    },
  };
};

describe("paged reads survive the 1,000-row PostgREST cap", () => {
  it("returns all 3,000 rows, not the first 1,000", async () => {
    const s = cappedServer(3000);
    const out = await fetchAllPages(s.fetchPage);
    expect(out).toHaveLength(3000);
    expect(s.calls).toBe(4);           // 1000 + 1000 + 1000 + a short page
  });

  it("returns all 3,500 rows", async () => {
    const out = await fetchAllPages(cappedServer(3500).fetchPage);
    expect(out).toHaveLength(3500);
  });

  it("no row is duplicated or dropped", async () => {
    const out = await fetchAllPages(cappedServer(2500).fetchPage) as { id: number }[];
    expect(new Set(out.map((r) => r.id)).size).toBe(2500);
    expect(out[0].id).toBe(0);
    expect(out[out.length - 1].id).toBe(2499);
  });

  it("a single short page needs exactly one call", async () => {
    const s = cappedServer(42);
    expect(await fetchAllPages(s.fetchPage)).toHaveLength(42);
    expect(s.calls).toBe(1);
  });

  it("an exact multiple of the page size does not lose the last page", async () => {
    const out = await fetchAllPages(cappedServer(2000).fetchPage);
    expect(out).toHaveLength(2000);
  });

  it("an empty table returns nothing in one call", async () => {
    const s = cappedServer(0);
    expect(await fetchAllPages(s.fetchPage)).toHaveLength(0);
    expect(s.calls).toBe(1);
  });

  it("a server that always returns a full page cannot loop forever", async () => {
    // Guards the guard: without the hard cap this would never terminate.
    const always = async () => Array.from({ length: 10 }, (_, i) => ({ id: i }));
    const out = await fetchAllPages(always, 10, 100);
    expect(out.length).toBeLessThanOrEqual(120);
  });

  it("the unpaged behaviour would have lost 2,000 rows — the bug", async () => {
    const s = cappedServer(3000);
    const onlyFirstPage = await s.fetchPage(0, 999);
    expect(onlyFirstPage).toHaveLength(1000);   // what the app used to get
  });
});
