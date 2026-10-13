import type { Campaign } from "@/types/campaign";
import type { AppRole } from "@/types/user";

/**
 * The read rules from migration 17, expressed once in TypeScript so they can
 * be tested and so the middleware and the SQL cannot drift apart silently.
 *
 * This is NOT the security boundary — Postgres RLS is. It exists so a change
 * to one is caught against the other by `accessPolicy.test.ts`.
 */

/** Mirrors the `campaigns_read` policy. */
export function canReadCampaign(role: AppRole, c: Campaign): boolean {
  switch (role) {
    case "CRM":
    case "EXECUTIVE":
      return true;
    case "CONTENT":
      // Only what CRM has actually sent. An un-routed CRM Self row is
      // invisible, matching the dashboard rule exactly.
      return c.content_status !== "NOT_ASSIGNED";
    case "CATEGORY":
      // CRM Self skips Category entirely, and nothing before CRM releases it.
      return c.is_crm_self === false && c.crm_status !== "NOT_STARTED";
    default:
      return false;
  }
}

/** Mirrors the route table in `src/middleware.ts`. */
export const ROUTE_ROLES: Record<string, readonly AppRole[]> = {
  "/overview":    ["CATEGORY", "CRM", "CONTENT", "EXECUTIVE"],
  "/campaigns":   ["CATEGORY", "CRM", "CONTENT", "EXECUTIVE"],
  "/calendar":    ["CATEGORY", "CRM", "CONTENT", "EXECUTIVE"],
  "/sla":         ["CRM", "EXECUTIVE"],
  "/emergency":   ["CATEGORY", "CRM", "CONTENT"],
  "/changes":     ["CATEGORY", "CRM"],
  "/performance": ["CRM", "EXECUTIVE"],
  "/segments":    ["CRM"],
  "/final-view":  ["CRM"],
  "/qc":          ["CRM"],
};

export function canVisit(role: AppRole, path: string): boolean {
  const entry = Object.entries(ROUTE_ROLES)
    .find(([p]) => path === p || path.startsWith(p + "/"));
  return entry ? (entry[1] as readonly string[]).includes(role) : true;
}

/* ---------------- column ownership (migration 17's trigger) ---------------- */

/** Columns CONTENT may write. Everything else is rejected by the trigger. */
export const CONTENT_OWNED = [
  "header", "sub_copy_text", "h_count", "s_count", "reference_link",
  "content_status",
] as const;

/** Columns CATEGORY may write. */
export const CATEGORY_OWNED = [
  "sub_category", "brand", "offer", "brief", "landing",
  "expected_cvr", "expected_rpv", "additional_notes", "date_time_brief",
  "category_status",
] as const;

/** Mirrors `enforce_column_ownership()`. Returns the rejected columns. */
export function rejectedColumns(role: AppRole, columns: string[]): string[] {
  if (role === "CRM" || role === "EXECUTIVE") return [];
  const owned: readonly string[] =
    role === "CONTENT" ? CONTENT_OWNED
    : role === "CATEGORY" ? CATEGORY_OWNED
    : [];
  return columns.filter((c) => !owned.includes(c));
}
