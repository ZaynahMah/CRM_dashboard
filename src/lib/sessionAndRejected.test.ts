import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  parseRejection, isRejected, rejectedOnly, pendingExcludingRejected,
  REJECT_ACTION, RESUBMIT_ACTIONS, type RejectionInfo,
} from "@/services/rejected";
import { BULK_FILL_KEYS } from "./pnDropdowns";
import {
  isCategorySubmitted, isContentSubmitted,
  incomingFromCategoryRows, incomingFromContentRows,
} from "@/services/crmSectionExport";
import type { Campaign } from "@/types/campaign";

const read = (p: string) => readFileSync(join(__dirname, p), "utf8");
const mw = read("../middleware.ts");
const auth = read("../services/auth.ts");
const sp = read("../components/SessionProvider.tsx");
const shell = read("../components/AppShell.tsx");

/* ══════════ ITEM 1 ══════════ */
describe("a failed call never signs anyone out", () => {
  it("getUser's error lets the request through", () => {
    expect(mw).toContain("const { data: userData, error: userError } = await supabase.auth.getUser();");
    expect(mw).toContain("if (userError) return withRefreshedCookies(res, NextResponse.next());");
  });

  it("a failed profile read is not a missing role", () => {
    expect(mw).toContain("if (profileError) return res;");
  });

  it("only user === null WITH NO error redirects", () => {
    expect(mw.indexOf("if (userError)")).toBeLessThan(mw.indexOf("if (!user) return redirectToLogin"));
  });
});

describe("refreshed cookies survive every redirect", () => {
  it("there is a helper that carries them", () => {
    expect(mw).toContain("function withRefreshedCookies(");
    expect(mw).toContain("from.cookies.getAll().forEach((c) => to.cookies.set(c));");
  });

  it("no bare NextResponse.redirect is returned", () => {
    const code = mw.replace(/\/\*[\s\S]*?\*\//g, " ")
      .split(String.fromCharCode(10))
      .filter((l) => !l.trim().startsWith("//")).join(String.fromCharCode(10));
    for (const line of code.split(String.fromCharCode(10))) {
      if (line.includes("return NextResponse.redirect(")) {
        expect(line, line).toContain("withRefreshedCookies");
      }
    }
  });

  it("redirectToLogin takes the response so it can carry them", () => {
    expect(mw).toContain("function redirectToLogin(req: NextRequest, res?: NextResponse)");
    expect(mw).toContain("return res ? withRefreshedCookies(res, redirect) : redirect;");
  });
});

describe("no session and a failed call are different things", () => {
  it("loadProfile reports three distinct outcomes", () => {
    expect(auth).toContain('{ status: "ok"; profile: Profile }');
    expect(auth).toContain('{ status: "no-session" }');
    expect(auth).toContain('{ status: "error"; message: string }');
  });

  it("a missing row is no-session; anything else is an error", () => {
    expect(auth).toContain('if (error.code === "PGRST116") return { status: "no-session" };');
  });

  it("a failed load KEEPS the profile, so the page does not move", () => {
    expect(sp).toContain('} else if (r.status === "error") {');
    expect(sp).toContain("setReconnecting(true);");
    // Only the error branch, up to the start of the else.
    const start = sp.indexOf('r.status === "error"');
    const block = sp.slice(start, sp.indexOf('} else {', start));
    expect(block).not.toContain("setProfile(null)");
  });

  it("AppShell redirects only on a genuine no-session", () => {
    expect(shell).toContain("if (!loading && !profile && !reconnecting) router.replace(\"/login\");");
  });

  it("it shows a Reconnecting banner with a retry", () => {
    expect(shell).toContain("Reconnecting… your work is safe");
    expect(shell).toContain("Retry now");
  });

  it("a background refresh does not re-fetch the profile", () => {
    expect(sp).toContain('if (event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION") return;');
  });

  it("it keeps retrying on its own", () => {
    expect(sp).toContain("setInterval(() => { void refresh(); }, 10_000)");
  });

  it("nothing signs the user out automatically", () => {
    for (const f of [mw, sp, shell, auth]) {
      const code = f.replace(/\/\*[\s\S]*?\*\//g, " ");
      const calls = (code.match(/signOut\(\)/g) ?? []).length;
      expect(calls).toBeLessThanOrEqual(1);   // only the Log out button
    }
  });
});

/* ══════════ ITEM 2 ══════════ */
describe("detecting a rejected PN", () => {
  const pn = (o: Partial<Campaign> = {}) =>
    ({ id: "c1", category_status: "DRAFT", ...o }) as unknown as Campaign;
  const info = (id = "c1"): RejectionInfo =>
    ({ campaignId: id, reason: "Fix the offer", byName: "Asha", at: "2026-11-02T10:00:00Z" });

  it("needs BOTH a DRAFT status and a live rejection", () => {
    const m = new Map([["c1", info()]]);
    expect(isRejected(pn(), m)).toBe(true);
    expect(isRejected(pn({ category_status: "LOCKED" }), m)).toBe(false);
    expect(isRejected(pn(), new Map())).toBe(false);
  });

  it("a resubmit ends the rejection", () => {
    expect(RESUBMIT_ACTIONS).toContain("CATEGORY_SUBMITTED");
    expect(REJECT_ACTION).toBe("CRM_REQUESTED_CHANGES");
  });

  it("reads back the typed name and reason", () => {
    expect(parseRejection("CRM (Asha) requested changes: Fix the offer"))
      .toEqual({ byName: "Asha", reason: "Fix the offer" });
  });

  it("still reads entries written before the name was mandatory", () => {
    expect(parseRejection("CRM requested changes: Old style"))
      .toEqual({ byName: null, reason: "Old style" });
  });

  it("the Rejected tab is EXCLUSIVE of Pending your input", () => {
    const m = new Map([["c1", info()]]);
    const rows = [pn(), pn({ id: "c2" })];
    expect(rejectedOnly(rows, m).map((c) => c.id)).toEqual(["c1"]);
    expect(pendingExcludingRejected(rows, m).map((c) => c.id)).toEqual(["c2"]);
  });

  it("is loaded in ONE query, not one per PN", () => {
    const svc = read("../services/rejected.ts");
    expect(svc).toContain('.from("activity_logs")');
    expect(svc).toContain(".in(\"action\", [REJECT_ACTION, ...RESUBMIT_ACTIONS])");
    expect((svc.match(/await supabase/g) ?? [])).toHaveLength(1);
  });

  it("the typed name is mandatory on Request Changes", () => {
    const d = read("../components/CampaignDrawer.tsx");
    expect(d).toContain("!rejectName.trim()");
    expect(d).toContain("CRM (${rejectName.trim()}) requested changes:");
  });

  it("the row shows a red badge and the reason", () => {
    const q = read("../components/RoleQueue.tsx");
    expect(q).toContain("Sent back by CRM");
    expect(q).toContain("Rejected — sent back by CRM");
    expect(q).toContain("rowNote");
  });
});

/* ══════════ ITEMS 3 and 4 ══════════ */
describe("bulk PN Template", () => {
  it("is in the shared bulk-fill set", () => {
    expect(BULK_FILL_KEYS.has("pn_template")).toBe(true);
    expect(BULK_FILL_KEYS.has("pn_type")).toBe(true);
  });
});

describe("the CRM exports carry only SUBMITTED PNs", () => {
  const c = (o: Partial<Campaign>) => ({ id: "x", ...o }) as unknown as Campaign;

  it("Category: LOCKED or SUBMITTED only", () => {
    expect(isCategorySubmitted(c({ category_status: "LOCKED" }))).toBe(true);
    expect(isCategorySubmitted(c({ category_status: "SUBMITTED" }))).toBe(true);
    for (const s of ["EMPTY", "DRAFT"]) {
      expect(isCategorySubmitted(c({ category_status: s } as Partial<Campaign>))).toBe(false);
    }
  });

  it("Content: SUBMITTED only", () => {
    expect(isContentSubmitted(c({ content_status: "SUBMITTED" }))).toBe(true);
    for (const s of ["NOT_ASSIGNED", "PENDING", "NEEDS_CHANGES"]) {
      expect(isContentSubmitted(c({ content_status: s } as Partial<Campaign>))).toBe(false);
    }
  });

  it("the row filters drop everything else", () => {
    const rows = [c({ category_status: "LOCKED" }), c({ category_status: "DRAFT" })];
    expect(incomingFromCategoryRows(rows)).toHaveLength(1);
    const crows = [c({ content_status: "SUBMITTED" }), c({ content_status: "PENDING" })];
    expect(incomingFromContentRows(crows)).toHaveLength(1);
  });

  it("Date / Time Brief is in the column list", () => {
    expect(read("../services/crmSectionExport.ts")).toContain('["Date / Time Brief"');
  });

  it("the button counts what the file will contain, and refuses an empty one", () => {
    const b = read("../components/CrmFlowBoard.tsx");
    expect(b).toContain("const eligible = exportCsv.eligible");
    expect(b).toContain("disabled={eligible.length === 0}");
    expect(b).toContain("Nothing submitted yet — nothing to export");
  });
});
