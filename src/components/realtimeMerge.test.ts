import { describe, it, expect } from "vitest";
import { applyRealtimeUpdate } from "./realtimeMerge";
import type { Campaign } from "@/types/campaign";

const rows = [
  { id: "a", header: "old-a", creative_link: null },
  { id: "b", header: "old-b", creative_link: null },
] as unknown as Campaign[];
const none = new Set<string>();

/* ───────── finding 11: realtime must not clobber unsaved edits ───────── */
describe("realtime merge", () => {
  it("updates a clean row live", () => {
    const r = applyRealtimeUpdate(rows, { id: "a", header: "new-a" }, none);
    expect(r.rows[0].header).toBe("new-a");
    expect(r.stale.size).toBe(0);
  });

  it("NEVER overwrites a row with unsaved edits", () => {
    const r = applyRealtimeUpdate(rows, { id: "a", header: "server-a" }, new Set(["a"]));
    expect(r.rows[0].header).toBe("old-a");      // the user's work survives
    expect(r.rows).toBe(rows);                   // untouched, same reference
  });

  it("flags the dirty row as stale instead", () => {
    const r = applyRealtimeUpdate(rows, { id: "a", header: "server-a" }, new Set(["a"]));
    expect([...r.stale]).toEqual(["a"]);
  });

  it("a dirty row does not block updates to other rows", () => {
    const r = applyRealtimeUpdate(rows, { id: "b", header: "new-b" }, new Set(["a"]));
    expect(r.rows[1].header).toBe("new-b");
    expect(r.stale.size).toBe(0);
  });

  it("does not mutate the input array", () => {
    applyRealtimeUpdate(rows, { id: "a", header: "new-a" }, none);
    expect(rows[0].header).toBe("old-a");
  });

  it("ignores a row that is not in this filtered view", () => {
    const r = applyRealtimeUpdate(rows, { id: "zzz", header: "x" }, none);
    expect(r.rows).toBe(rows);
    expect(r.stale.size).toBe(0);
  });

  it("ignores a payload with no id", () => {
    expect(applyRealtimeUpdate(rows, { header: "x" }, none).rows).toBe(rows);
  });

  it("accumulates stale ids across several pushes", () => {
    let s = new Set<string>();
    s = applyRealtimeUpdate(rows, { id: "a" }, new Set(["a", "b"]), s).stale;
    s = applyRealtimeUpdate(rows, { id: "b" }, new Set(["a", "b"]), s).stale;
    expect([...s].sort()).toEqual(["a", "b"]);
  });

  it("merges fields rather than replacing the row", () => {
    const r = applyRealtimeUpdate(rows, { id: "a", creative_link: "x" } as Partial<Campaign>, none);
    expect(r.rows[0].header).toBe("old-a");      // untouched field survives
    expect(r.rows[0].creative_link).toBe("x");
  });

  it("a row stops being protected once its edits are saved", () => {
    const blocked = applyRealtimeUpdate(rows, { id: "a", header: "s" }, new Set(["a"]));
    expect(blocked.rows[0].header).toBe("old-a");
    const after = applyRealtimeUpdate(rows, { id: "a", header: "s" }, none);
    expect(after.rows[0].header).toBe("s");
  });
});
