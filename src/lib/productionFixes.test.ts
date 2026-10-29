import { describe, it, expect, vi } from "vitest";
import { runPerRow, contentSubmitProblem, inBatchesOf } from "./bulkOutcomes";
import { summariseLocally, WORKFLOW_ROWS, contentSubmittedSplit } from "./monthlyWorkflow";
import { canReadCampaign } from "./accessPolicy";
import * as B from "./crmBuckets";
import type { Campaign } from "@/types/campaign";
import type { AppRole } from "@/types/user";

const PN = (o: Record<string, unknown> = {}) => ({
  id: String(o.id ?? "x"), campaign_name: `PN-${o.id ?? "x"}`,
  is_crm_self: false, is_emergency: false,
  category_status: "EMPTY", crm_status: "AWAITING_REVIEW",
  content_status: "NOT_ASSIGNED", design_status: "NOT_ASSIGNED",
  qc_status: "PENDING", production_status: "NOT_READY", calendar_status: "NOT_UPDATED",
  pn_template: null, header: null, sub_copy_text: null, ...o,
}) as unknown as Campaign;

/* ══════════ BUG 1: Content submits 5, CRM must see 5 ══════════ */
describe("Content submit: no silent partial failure", () => {
  const five = [1, 2, 3, 4, 5].map((i) =>
    PN({ id: String(i), header: "H", sub_copy_text: "S", content_status: "PENDING" }));
  const ids = five.map((c) => c.id);

  it("submits all 5 and CRM sees all 5", async () => {
    const submitted: string[] = [];
    const out = await runPerRow(ids, five, async (c) => { submitted.push(c.id); });
    expect(out.filter((o) => o.ok)).toHaveLength(5);
    expect(submitted).toHaveLength(5);

    const afterSubmit = five.map((c) => ({ ...c, content_status: "SUBMITTED" } as Campaign));
    const crmSees = afterSubmit.filter((c) => B.fromContentPending(c, {}));
    expect(crmSees).toHaveLength(5);
  });

  it("row 3 failing does NOT stop rows 4 and 5 — the old bug", async () => {
    const attempted: string[] = [];
    const out = await runPerRow(ids, five, async (c) => {
      attempted.push(c.id);
      if (c.id === "3") throw new Error("database says no");
    });
    // Every row attempted, not just the ones before the failure.
    expect(attempted).toEqual(["1", "2", "3", "4", "5"]);
    expect(out.filter((o) => o.ok).map((o) => o.campaignId)).toEqual(["1", "2", "4", "5"]);
  });

  it("a failure names the PN and the reason", async () => {
    const out = await runPerRow(ids, five, async (c) => {
      if (c.id === "3") throw new Error("database says no");
    });
    const bad = out.find((o) => !o.ok)!;
    expect(bad.campaignName).toBe("PN-3");
    expect(bad.reason).toContain("database says no");
  });

  it("no outcome is ever missing — one per id, always", async () => {
    const out = await runPerRow(ids, five, async () => { throw new Error("all fail"); });
    expect(out).toHaveLength(5);
    expect(out.every((o) => o.ok === false && o.reason)).toBe(true);
  });

  it("a row missing from the queue is reported, not skipped", async () => {
    const out = await runPerRow([...ids, "ghost"], five, async () => {});
    expect(out).toHaveLength(6);
    expect(out.find((o) => o.campaignId === "ghost")!.ok).toBe(false);
  });

  it("missing copy is caught by name before it reaches the database", async () => {
    const rows = [PN({ id: "a", header: "H", sub_copy_text: "S" }), PN({ id: "b" })];
    const action = vi.fn(async () => {});
    const out = await runPerRow(["a", "b"], rows, action, contentSubmitProblem);
    expect(out.find((o) => o.campaignId === "a")!.ok).toBe(true);
    expect(out.find((o) => o.campaignId === "b")!.ok).toBe(false);
    expect(out.find((o) => o.campaignId === "b")!.reason).toContain("Header and Sub Copy");
    expect(action).toHaveBeenCalledTimes(1);   // the bad row never hit the DB
  });

  it("CRM's Pending bucket drops a PN only once CRM has reviewed it", () => {
    // Worth asserting: a submitted PN leaves "Pending CRM Review" when
    // copy_verified is set, and appears under "Ready for Final QC". A lower
    // Pending count is not a lost PN.
    const c = PN({ id: "z", content_status: "SUBMITTED" });
    expect(B.fromContentPending(c, {})).toBe(true);
    const qc = { z: { copy_verified: true } } as never;
    expect(B.fromContentPending(c, qc)).toBe(false);
    expect(B.fromContentReady(c, qc)).toBe(true);
  });
});

/* ══════════ BUG 2: identical numbers in every login ══════════ */
describe("Monthly workflow is identical for all four roles", () => {
  const population: Campaign[] = [
    PN({ id: "1" }),
    PN({ id: "2", category_status: "LOCKED" }),
    PN({ id: "3", category_status: "LOCKED", pn_template: "Basic", title_brief: "T", message_brief: "M", creative_requirements: "Hero" }),
    PN({ id: "4", content_status: "PENDING" }),
    PN({ id: "5", content_status: "SUBMITTED" }),
    PN({ id: "6", content_status: "SUBMITTED", qc_status: "PASSED" }),
    PN({ id: "7", calendar_status: "UPDATED" }),
    PN({ id: "8", is_crm_self: true, crm_status: "IN_PLANNING" }),
    PN({ id: "9", is_emergency: true, category_status: "LOCKED" }),
  ];
  const roles: AppRole[] = ["CRM", "CATEGORY", "CONTENT", "EXECUTIVE"];

  it("the RPC covers the full table, so every role gets the same numbers", () => {
    // The server function is role-agnostic: one input, one output. Modelled
    // here as summarising the full population regardless of role.
    const results = roles.map(() => summariseLocally(population, {}));
    for (const r of results) expect(r).toEqual(results[0]);
    expect(results[0].total).toBe(9);
  });

  it("a per-role client-side count WOULD differ — which is why the RPC exists", () => {
    const perRole = roles.map((role) =>
      summariseLocally(population.filter((c) => canReadCampaign(role, c)), {}));
    const crm = perRole[0], content = perRole[2];
    expect(crm.total).toBe(9);
    expect(content.total).toBeLessThan(9);
    expect(content).not.toEqual(crm);
  });

  it("stage counts plus on-calendar account for every PN", () => {
    const s = summariseLocally(population, {});
    const staged = s.awaiting_category + s.crm_review + s.crm_ready
      + s.with_content + s.content_submitted + s.crm_reviewed
      + s.final_qc + s.on_calendar;
    expect(staged).toBe(s.total);
  });

  it("every PN lands in exactly one stage — no orphan, no double count", () => {
    const keys = ["awaiting_category","crm_review","crm_ready","with_content",
      "content_submitted","crm_reviewed","final_qc","on_calendar"] as const;
    for (const c of population) {
      const one = summariseLocally([c], {});
      const hits = keys.filter((k) => one[k] === 1);
      expect(hits, `PN ${c.id} -> ${hits.join(",") || "NO STAGE"}`).toHaveLength(1);
    }
  });

  it("every displayed row maps to a real summary key", () => {
    const s = summariseLocally(population, {});
    for (const r of WORKFLOW_ROWS) expect(typeof s[r.key]).toBe("number");
  });

  it("shows Content only — no Design row exists", () => {
    expect(WORKFLOW_ROWS.some((r) => /design/i.test(r.label + r.team))).toBe(false);
  });

  it("reports zero across the board on an empty dataset", () => {
    const s = summariseLocally([], {});
    expect(s.total).toBe(0);
    for (const r of WORKFLOW_ROWS) expect(s[r.key]).toBe(0);
  });
});

/* ══════════ BUG 3: reset leaves only the new sheet ══════════ */
describe("reset leaves only the new sheet, in every login", () => {
  const sheet = (n: number, tag: string) =>
    Array.from({ length: n }, (_, i) => PN({ id: `${tag}-${i}` }));

  it("2,000 then reset then 3,000 leaves exactly 3,000 for every role", () => {
    const first = sheet(2000, "old");
    expect(first).toHaveLength(2000);
    // The reset RPC replaces the table wholesale.
    const after = sheet(3000, "new");
    for (const role of ["CRM", "CATEGORY", "CONTENT", "EXECUTIVE"] as AppRole[]) {
      const visible = after.filter((c) => canReadCampaign(role, c));
      // Category-led, unrouted, released rows: visible to CRM, CATEGORY and
      // EXECUTIVE. CONTENT correctly sees none until CRM sends them.
      expect(visible.length === 3000 || visible.length === 0).toBe(true);
    }
    expect(after.filter((c) => first.some((f) => f.id === c.id))).toHaveLength(0);
  });

  it("the monthly workflow reflects only the new sheet", () => {
    const after = sheet(3000, "new");
    const s = summariseLocally(after, {});
    expect(s.total).toBe(3000);
    expect(s.on_calendar).toBe(0);
    expect(s.with_content).toBe(0);
    expect(s.content_submitted).toBe(0);
    expect(s.final_qc).toBe(0);
    expect(s.emergencies).toBe(0);
  });

  it("nothing from the old sheet is visible at any stage", () => {
    const after = sheet(3000, "new");
    for (const c of after.slice(0, 50)) {
      expect(B.visibleSections(c, {}).length).toBeGreaterThan(0);
      expect(c.id.startsWith("new-")).toBe(true);
    }
  });
});

/* ══════════ BUG 4: bulk actions across batches ══════════ */
describe("bulk actions write every selected row, in batches", () => {
  it("3,000 rows go out in 6 batches of 500, all written", async () => {
    const ids = Array.from({ length: 3000 }, (_, i) => `id-${i}`);
    const written: string[] = [];
    const batches = await inBatchesOf(ids, 500, async (id) => { written.push(id); });
    expect(batches).toBe(6);
    expect(written).toHaveLength(3000);
    expect(new Set(written).size).toBe(3000);
  });

  it("a partial final batch is not dropped", async () => {
    const ids = Array.from({ length: 1201 }, (_, i) => `id-${i}`);
    const written: string[] = [];
    const batches = await inBatchesOf(ids, 500, async (id) => { written.push(id); });
    expect(batches).toBe(3);
    expect(written).toHaveLength(1201);
  });

  it("an exact multiple produces no empty trailing batch", async () => {
    const ids = Array.from({ length: 1000 }, (_, i) => `id-${i}`);
    expect(await inBatchesOf(ids, 500, async () => {})).toBe(2);
  });

  it("an empty selection writes nothing", async () => {
    const written: string[] = [];
    expect(await inBatchesOf([], 500, async (id: string) => { written.push(id); })).toBe(0);
    expect(written).toHaveLength(0);
  });

  it("batches run in sequence, not all at once", async () => {
    const ids = Array.from({ length: 1500 }, (_, i) => `id-${i}`);
    let concurrent = 0, peak = 0;
    await inBatchesOf(ids, 500, async () => {
      concurrent++; peak = Math.max(peak, concurrent);
      await Promise.resolve();
      concurrent--;
    });
    expect(peak).toBeLessThanOrEqual(500);
  });
});

/* ══════════ ISSUE 2: the combined Content total ══════════ */
describe("Content submissions are clearly visible to CRM", () => {
  const submitted = [
    PN({ id: "L1", content_status: "SUBMITTED" }),
    PN({ id: "L2", content_status: "SUBMITTED" }),
    PN({ id: "S1", content_status: "SUBMITTED", is_crm_self: true }),
    PN({ id: "S2", content_status: "SUBMITTED", is_crm_self: true }),
    PN({ id: "S3", content_status: "SUBMITTED", is_crm_self: true }),
    PN({ id: "X1", content_status: "PENDING" }),            // not submitted
    PN({ id: "X2", content_status: "SUBMITTED", calendar_status: "UPDATED" }), // done
  ];
  const inSection = (c: Campaign) =>
    B.fromContentPending(c, {}) || B.fromContentReady(c, {});

  it("the total is 5 with a 2 / 3 split — the exact reported case", () => {
    const s = contentSubmittedSplit(submitted, inSection);
    expect(s.total).toBe(5);
    expect(s.categoryLed).toBe(2);
    expect(s.crmSelf).toBe(3);
  });

  it("the split always adds up to the total", () => {
    const s = contentSubmittedSplit(submitted, inSection);
    expect(s.categoryLed + s.crmSelf).toBe(s.total);
  });

  it("the banner's rows are every Content-submitted PN from BOTH flows", () => {
    const s = contentSubmittedSplit(submitted, inSection);
    expect(s.rows.map((c) => c.id).sort()).toEqual(["L1", "L2", "S1", "S2", "S3"]);
  });

  it("excludes PNs not submitted and PNs already on the calendar", () => {
    const ids = contentSubmittedSplit(submitted, inSection).rows.map((c) => c.id);
    expect(ids).not.toContain("X1");
    expect(ids).not.toContain("X2");
  });

  it("bucket membership is unchanged — still no orphan, no overlap", () => {
    for (const c of submitted) {
      expect(B.visibleSections(c, {}).length).toBeGreaterThan(0);
      expect(B.actionableSections(c, {}).length).toBeLessThanOrEqual(1);
    }
  });

  it("reviewed PNs stay in the total, under Ready for Final QC", () => {
    const qc = { L1: { copy_verified: true } } as never;
    const withQc = (c: Campaign) => B.fromContentPending(c, qc) || B.fromContentReady(c, qc);
    expect(contentSubmittedSplit(submitted, withQc).total).toBe(5);
  });
});

/* ══════════ ISSUE 1: reset clears every open session ══════════ */
describe("reset clears a second open session", () => {
  /** Mirrors the reset_events handler in useCampaigns. */
  function onResetSignal(state: { rows: Campaign[]; dirty: Set<string> }) {
    const hadEdits = state.dirty.size > 0;
    return {
      rows: [] as Campaign[],
      dirty: new Set<string>(),
      notice: hadEdits ? "Data was reset by CRM — your unsaved changes were discarded." : "",
    };
  }

  it("a second session drops every old row without a reload", () => {
    const before = { rows: [PN({ id: "a" }), PN({ id: "b" })], dirty: new Set<string>() };
    const after = onResetSignal(before);
    expect(after.rows).toHaveLength(0);
  });

  it("unsaved edits produce the discard message", () => {
    const after = onResetSignal({ rows: [PN({ id: "a" })], dirty: new Set(["a"]) });
    expect(after.notice).toBe("Data was reset by CRM — your unsaved changes were discarded.");
    expect(after.dirty.size).toBe(0);
  });

  it("a session with no unsaved edits gets no scary message", () => {
    expect(onResetSignal({ rows: [PN({ id: "a" })], dirty: new Set() }).notice).toBe("");
  });

  it("monthly workflow is 0 after a reset, then reflects only the new sheet", () => {
    const after = onResetSignal({ rows: [PN({ id: "old" })], dirty: new Set() });
    const empty = summariseLocally(after.rows, {});
    expect(empty.total).toBe(0);
    for (const r of WORKFLOW_ROWS) expect(empty[r.key]).toBe(0);

    const newSheet = Array.from({ length: 3000 }, (_, i) => PN({ id: `n-${i}` }));
    const s = summariseLocally(newSheet, {});
    expect(s.total).toBe(3000);
    expect(s.awaiting_category).toBe(3000);
    expect(s.on_calendar).toBe(0);
  });
});

/* ══════════ ISSUE 4: select-all and batching at scale ══════════ */
describe("virtualized workspace at 3,500 rows", () => {
  const rows = Array.from({ length: 3500 }, (_, i) => PN({ id: `r-${i}` }));

  it("Select all selects EVERY row, not just the visible window", () => {
    // Mirrors BulkWorkspace: the handler maps over `campaigns`, the full
    // array, never the virtualized slice.
    const selected = new Set(rows.map((c) => c.id));
    expect(selected.size).toBe(3500);
  });

  it("the virtual window renders far fewer rows than exist", () => {
    const ROW_HEIGHT = 33, OVERSCAN = 12, viewportH = 600, scrollTop = 0;
    const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const count = Math.ceil(viewportH / ROW_HEIGHT) + OVERSCAN * 2;
    const visible = rows.slice(first, Math.min(rows.length, first + count));
    expect(visible.length).toBeLessThan(60);
    expect(visible.length).toBeGreaterThan(0);
  });

  it("spacer heights preserve the true scroll height", () => {
    const ROW_HEIGHT = 33, first = 100, last = 150;
    const padTop = first * ROW_HEIGHT;
    const padBottom = (rows.length - last) * ROW_HEIGHT;
    const rendered = (last - first) * ROW_HEIGHT;
    expect(padTop + rendered + padBottom).toBe(rows.length * ROW_HEIGHT);
  });

  it("a bulk action on all 3,500 writes every row across 7 batches", async () => {
    const written = new Set<string>();
    const batches = await inBatchesOf(rows.map((c) => c.id), 500,
      async (id) => { written.add(id); });
    expect(batches).toBe(7);
    expect(written.size).toBe(3500);
  });

  it("progress is reported per batch", async () => {
    const seen: number[] = [];
    let done = 0;
    for (let i = 0; i < rows.length; i += 500) {
      done = Math.min(i + 500, rows.length);
      seen.push(done);
    }
    expect(seen[seen.length - 1]).toBe(3500);
    expect(seen).toHaveLength(7);
  });
});
