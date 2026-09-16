/**
 * Fuzzy column-name resolution. Real exported workbooks rarely use the exact
 * header text a spec assumes ("Reporting Month" instead of "Month", "Product
 * Category" instead of "Category", "Sessions" instead of "Visits", etc.) —
 * so every field this module reads is matched by MEANING, not literal string
 * equality. Resolved once per sheet (from its header row), then reused for
 * every data row in that sheet.
 */

export function normalizeKey(k: unknown): string {
  return String(k ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Alias groups — each is a set of normalized (no spaces/punctuation/case) header variants. */
export const FIELD_ALIASES = {
  month: ["month","reportingmonth","campaignmonth","monthyear","mon","period","reportingperiod","cycle"],
  platform: ["platform","channel","platformname","source"],
  periodStatus: ["periodstatus","status","datastatus","completionstatus"],

  category: ["category","categoryname","productcategory","cat","categorytype"],
  remarketingFlow: ["remarketingflow","flow","remarketingflowname","rmflow","remarketingtype"],
  segment: ["segment","segmentname","audiencesegment","seg","audience"],
  pnType: ["pntype","pushtype","notificationtype","type","pncategory"],
  cohort: ["cohort","cohortname","lifecyclecohort","lifecyclestage"],
  occasion: ["occasion","occasiontype","classification","occasionname"],
  tag: ["tag","tagname","interesttag","interest"],
  pnName: ["pnname","pn","campaignname","pushname","name","notificationname","pushnotificationname"],

  visits: ["visits","totalvisits","sessions","traffic","uniquevisits","visitcount"],
  orders: ["orders","totalorders","ordercount","transactions","conversions","orderscount"],
  revenue: ["revenueinr","revenue","totalrevenue","gmv","sales","revenueinrupees","revenueinrs","grossrevenue"],
  cvr: ["cvr","conversionrate","convrate","conversion","conversionratepct"],
  aov: ["aovinr","aov","averageordervalue","avgordervalue","aovinrupees"],
  rpv: ["rpvinr","rpv","revenuepervisit","revenuepervisitor","rpvinrupees"],
} as const;

export type FieldKey = keyof typeof FIELD_ALIASES;

/**
 * Given the actual header strings present in a sheet, find which real header
 * corresponds to each requested field. Exact normalized match wins first;
 * falls back to a substring match in either direction (handles headers like
 * "Total Revenue (INR)" matching the "revenue" alias "totalrevenue").
 */
export function resolveColumns(headers: string[], fields: FieldKey[]): Partial<Record<FieldKey, string>> {
  const normalized = headers.map((h) => ({ original: h, norm: normalizeKey(h) }));
  const result: Partial<Record<FieldKey, string>> = {};

  for (const field of fields) {
    const aliases = FIELD_ALIASES[field];

    let hit = normalized.find((h) => (aliases as readonly string[]).includes(h.norm));
    if (!hit) {
      hit = normalized.find((h) =>
        aliases.some((a) => h.norm.length > 0 && (h.norm.includes(a) || a.includes(h.norm)))
      );
    }
    if (hit) result[field] = hit.original;
  }
  return result;
}

/** Reads a value out of a row using the resolved column map for one field. */
export function pick(row: Record<string, unknown>, map: Partial<Record<FieldKey, string>>, field: FieldKey): unknown {
  const key = map[field];
  return key ? row[key] : null;
}

const EXCEL_EPOCH_OFFSET_DAYS = 25569; // days between 1899-12-30 and 1970-01-01

/** Handles Month values that arrive as an Excel date serial or a JS Date, not just plain text. */
export function normalizeMonthValue(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) {
    return v.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  }
  if (typeof v === "number" && v > 20000 && v < 60000) {
    // Looks like an Excel serial date, not a plain numeric month id.
    const ms = Math.round((v - EXCEL_EPOCH_OFFSET_DAYS) * 86400 * 1000);
    const d = new Date(ms);
    if (!isNaN(d.getTime())) return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  }
  return String(v).trim() || null;
}

/**
 * Fallback when no header alias matches a dimension column by name: picks the
 * first remaining column whose values are mostly non-numeric text — i.e.
 * infers the dimension from data type/shape rather than giving up.
 */
export function inferDimensionColumn(
  headers: string[],
  rows: Record<string, unknown>[],
  usedHeaders: Set<string>
): string | null {
  const candidates = headers.filter((h) => !usedHeaders.has(h));
  for (const h of candidates) {
    const values = rows.map((r) => r[h]).filter((v) => v !== null && v !== undefined && String(v).trim() !== "");
    if (values.length === 0) continue;
    const textLike = values.filter((v) => isNaN(Number(v))).length;
    if (textLike / values.length >= 0.6) return h; // mostly non-numeric -> treat as the dimension
  }
  return null;
}

/**
 * Disambiguates whether a "percentage-shaped" column (CVR, discount rate,
 * etc.) is stored as a decimal fraction (0.0157) or already as a percentage
 * number (1.57). Decided once per column from the whole column's values —
 * never per row, since a workbook is internally consistent about this even
 * if the app doesn't know which convention it used. Returns the values
 * normalized to the fraction convention (what the rest of this app expects),
 * without altering which number they represent.
 */
export function normalizePercentColumn(values: (number | null)[]): (number | null)[] {
  const present = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (present.length === 0) return values;
  const max = Math.max(...present.map((v) => Math.abs(v)));
  // If every value is already <= 1, it's a fraction — leave as-is.
  // If values exceed 1 (e.g. 3.2 meaning "3.2%"), it's a percentage number — convert to fraction.
  if (max <= 1) return values;
  return values.map((v) => (v === null ? null : v / 100));
}

