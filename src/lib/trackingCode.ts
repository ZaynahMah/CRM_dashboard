import type { Campaign } from "@/types/campaign";

/**
 * Tracking code generation.
 *
 * ──────────────────────────────────────────────────────────────────────
 * READ THIS BEFORE CHANGING ANYTHING
 *
 * This format was previously REJECTED. After reviewing real production
 * examples the CRM team said the CID is built from business-defined
 * abbreviations, not from campaign names and free text — which is what this
 * concatenation produces. It was then re-approved from the worked examples
 * below, but the six format decisions were never actually answered.
 *
 * Every one of those decisions is a named constant in this file so changing
 * it is a one-line edit, not a rewrite. The current values are DEFAULTS
 * taken from the worked examples, not confirmed answers. If a code written
 * by this function reaches your analytics, it is permanent — confirm the
 * six before relying on it.
 * ──────────────────────────────────────────────────────────────────────
 */

/* ═══════════════════════════════════════════════════════════════════════
 * CONFIGURATION — change formatting rules HERE and nowhere else.
 *
 * Every value below is a formatting rule, not business logic. Nothing
 * outside this file reads them, and nothing outside this file knows what
 * position any field occupies. Changing a constant here changes the output
 * everywhere, with no other edit required.
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * CONFIG 1 — DELIMITER
 * The separator between positions. Must not be a character that `slug()`
 * can emit, or positions become ambiguous when split.
 * Current: "_"
 */
const DELIMITER = "_";

/**
 * CONFIG 2 — LOWERCASE
 * true  -> the whole code is lowercased (current).
 * false -> `slug()` casing is preserved.
 */
const LOWERCASE = true;

/**
 * CONFIG 3 — MISSING
 * The placeholder emitted when a field has no value. Every one of the 14
 * positions is always emitted, so `code.split(DELIMITER).length` is always
 * POSITION_COUNT and a code can be parsed back positionally.
 * Current: "na"
 */
const MISSING = "na";

/**
 * CONFIG 4 — LANDING_MODE
 * "path" -> scheme and domain stripped, path only (current):
 *           "https://tatacliq.com/womens-ethnic/kurtas" -> "womensethnickurtas"
 * "full" -> the whole URL slugged, domain included.
 */
const LANDING_MODE: "path" | "full" = "path";

/**
 * CONFIG 5 — DATE_FORMAT (position 14)
 * "ddmmyy"   -> 2026-10-12 becomes "121026" (current)
 * "yyyymmdd" -> 2026-10-12 becomes "20261012"
 */
const DATE_FORMAT: "ddmmyy" | "yyyymmdd" = "ddmmyy";

/**
 * CONFIG 6 — TIME_FORMAT (position 13)
 * "hhmm" -> 19:30 becomes "1930", zero-padded (current).
 */
const TIME_FORMAT: "hhmm" = "hhmm";

/**
 * CONFIG 7 — MAX_LENGTH
 * 0 means no truncation (current). If your analytics platform caps tracking
 * codes, set the cap here: the longest segments are shortened first, so
 * every position survives and leading fields stay readable.
 */
const MAX_LENGTH = 0;

/**
 * CONFIG 8 — REGENERATE_MODE
 * "once"   -> fill only when the field is empty; never silently rewrite a
 *             code that may already be live in analytics (current). CRM can
 *             force an overwrite with the Regenerate button.
 * "always" -> recompute whenever any input changes. More correct, but it
 *             rewrites codes already in use.
 */
export const REGENERATE_MODE: "once" | "always" = "once";

/** CONFIG 9 — warn above this length even when MAX_LENGTH is 0. */
export const LENGTH_WARNING_AT = 255;

/** Read-only view of the active configuration, for the UI and for tests. */
export const TRACKING_CONFIG = {
  DELIMITER, LOWERCASE, MISSING, LANDING_MODE,
  DATE_FORMAT, TIME_FORMAT, MAX_LENGTH, REGENERATE_MODE, LENGTH_WARNING_AT,
} as const;

/* ---------------- field order ---------------- */
/* ---------------- field order ---------------- */

/**
 * The thirteen positional fields, in the order the export's own columns sit
 * in immediately before "Tracking Code" — strong evidence this is the
 * intended sequence.
 *
 * `keyword` is a FOURTEENTH field appended only when CRM supplies one. It is
 * deliberately not padded with "na": it sits last, so omitting it cannot
 * shift any other field's position. CRM said it is added "at the very end",
 * sometimes.
 */
export interface TrackingField {
  /** 1-based position in the code. Documented, never hardcoded elsewhere. */
  position: number;
  /** Stable key used by the resolver below and by tests. */
  key: string;
  /** Human label, for the UI and error messages. */
  label: string;
}

/**
 * THE SCHEMA. Fourteen fixed positions, in this exact order.
 *
 * Nothing outside this file may assume a position number. Business logic
 * asks for `TRACKING_SCHEMA` or calls `buildTrackingCode()`; it never
 * indexes into a code by hand. Reordering the schema here is the ONLY
 * change needed to reorder the output.
 *
 * Every position is always emitted. A missing value becomes MISSING ("na"),
 * so `code.split("_")` always yields exactly POSITION_COUNT parts and a code
 * can be read back positionally.
 */
export const TRACKING_SCHEMA: readonly TrackingField[] = [
  { position: 1,  key: "campaign_type",  label: "Campaign Type" },
  { position: 2,  key: "campaign_name",  label: "Campaign Name" },
  { position: 3,  key: "channel_name",   label: "Channel Name" },
  { position: 4,  key: "channel_format", label: "Channel Format" },
  { position: 5,  key: "segment_1",      label: "Segment 1" },
  { position: 6,  key: "segment_2",      label: "Segment 2" },
  { position: 7,  key: "category",       label: "Category" },
  { position: 8,  key: "sub_category",   label: "Sub Category" },
  { position: 9,  key: "brand",          label: "Brand" },
  { position: 10, key: "landing",        label: "Landing" },
  { position: 11, key: "offer",          label: "Offer" },
  // Position 12. Keywords is a FIXED position, not an optional suffix.
  // When CRM supplies nothing it emits "na" like any other field, so every
  // later position stays where it is.
  { position: 12, key: "keywords",       label: "Keywords" },
  { position: 13, key: "time",           label: "Time" },      // hhmm
  { position: 14, key: "date",           label: "Date" },      // ddmmyy
] as const;

/** Always 14. Exported so tests and callers never hardcode the number. */
export const POSITION_COUNT = TRACKING_SCHEMA.length;

/* ---------------- normalisation ---------------- */

/**
 * Collapses a value to the alphanumeric run used in a code.
 * "Kurtas & Suit Sets" -> "kurtassuitsets"
 * "Flat 40% off"       -> "flat40off"
 * "19:30"              -> "1930"
 * Diacritics are folded first so "Café" and "Cafe" cannot produce two
 * different codes for the same campaign.
 */
export function slug(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
}

/** Strips scheme, domain and slashes, leaving the path. */
export function slugLanding(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  if (LANDING_MODE === "full") return slug(raw);
  const noScheme = raw.replace(/^[a-z]+:\/\//i, "");
  const slashAt = noScheme.indexOf("/");
  return slug(slashAt === -1 ? "" : noScheme.slice(slashAt + 1));
}

/** "19:30:00" or "19:30" -> "1930". */
export function slugTime(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  const m = raw.match(/^(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, "0")}${m[2]}` : slug(raw);
}

/**
 * "2026-10-12" -> "121026". Parsed from the ISO string by hand rather than
 * through a Date object, which would shift the day across timezones — the
 * same reason excelDates.ts avoids Date.
 */
export function slugDate(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return slug(raw);
  const [, yyyy, mm, dd] = m;
  return DATE_FORMAT === "ddmmyy" ? `${dd}${mm}${yyyy.slice(2)}` : `${yyyy}${mm}${dd}`;
}

/* ---------------- generation ---------------- */

export interface TrackingCodeResult {
  code: string;
  /** Fields that fell back to the MISSING placeholder. */
  missing: string[];
  /** True when the result exceeds LENGTH_WARNING_AT. */
  tooLong: boolean;
  length: number;
}

/**
 * Builds the code for ONE campaign. Pure: same input, same output, and it
 * reads nothing but the campaign passed in — no row can influence another.
 */
/**
 * Maps each schema key to its value on a campaign. The ONLY place a schema
 * key meets a database column — add a field to the schema and you add one
 * line here, nowhere else.
 */
export function resolveFields(c: Campaign): Record<string, string> {
  return {
    campaign_type: slug(c.campaign_type),
    campaign_name: slug(c.campaign_name),
    channel_name: slug(c.channel_name),
    channel_format: slug(c.channel_format),
    segment_1: slug(c.segment_1 ?? c.pncc_segment_label),
    segment_2: slug(c.segment_2),
    category: slug(c.category ?? c.pncc_category_code),
    sub_category: slug(c.sub_category),
    brand: slug(c.brand),
    landing: slugLanding(c.landing),
    offer: slug(c.offer),
    keywords: slug(c.keywords),
    time: slugTime(c.launch_time),
    date: slugDate(c.launch_date),
  };
}

/**
 * Builds the code for ONE campaign. Pure: same input, same output, and it
 * reads nothing but the campaign passed in — no row can influence another.
 *
 * Walks TRACKING_SCHEMA in order and emits one part per position, always.
 */
export function buildTrackingCode(c: Campaign): TrackingCodeResult {
  const raw = resolveFields(c);

  const missing: string[] = [];
  const parts: string[] = [];
  for (const field of TRACKING_SCHEMA) {
    const v = raw[field.key];
    if (v) { parts.push(v); continue; }
    missing.push(field.key);
    parts.push(MISSING);   // every position always emitted
  }

  let code = parts.join(DELIMITER);
  if (LOWERCASE) code = code.toLowerCase();

  if (MAX_LENGTH > 0 && code.length > MAX_LENGTH) {
    code = truncateLongestFirst(parts, MAX_LENGTH);
  }

  return { code, missing, length: code.length, tooLong: code.length > LENGTH_WARNING_AT };
}

/**
 * Shortens the longest segments until the whole code fits, instead of
 * cutting the end off. Keeps every field present and the leading fields
 * readable, which a plain substring would not.
 */
function truncateLongestFirst(parts: string[], max: number): string {
  const out = [...parts];
  while (out.join(DELIMITER).length > max) {
    let longest = 0;
    for (let i = 1; i < out.length; i++) if (out[i].length > out[longest].length) longest = i;
    if (out[longest].length <= 3) break; // nothing left worth cutting
    out[longest] = out[longest].slice(0, out[longest].length - 1);
  }
  return out.join(DELIMITER);
}

/**
 * Whether this campaign's code should be (re)generated now.
 * Under "once", an existing code is never overwritten automatically —
 * CRM must press Regenerate.
 */
export function shouldGenerate(c: Campaign, forced = false): boolean {
  if (forced) return true;
  if (REGENERATE_MODE === "always") return true;
  return !c.tracking_code || c.tracking_code.trim() === "";
}

/** Landing URL + tracking code, the export's "Landing Link + Tracking Code". */
export function buildLandingPlusTracking(c: Campaign, code: string): string {
  const landing = (c.landing ?? "").trim();
  if (!landing || !code) return "";
  return `${landing}${landing.includes("?") ? "&" : "?"}utm_tracking=${code}`;
}
