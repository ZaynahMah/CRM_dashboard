import type { Campaign } from "@/types/campaign";
import {
  CID_PREFIX, CAMPAIGN_TYPE_PN, CAMPAIGN_NAME_PRP, CHANNEL_NAME_PUSH,
  SEGMENT_1_MAP, CATEGORY_MAP, MULTI_BRAND, BRAND_NOT_MULTI, mapFirst, mapOffer,
} from "./trackingMasters";

/**
 * Tracking code generation, matching the format CRM actually uses in
 * production. Verified against the July'26 Fashion CRM Calendar: the
 * formula below reproduces 3,083 of 3,103 rows exactly (the remaining 20
 * are blank or #REF! rows in the sheet).
 *
 * FORMAT
 *   cid={type}:{name}:{channelName}_{channelFormat}:{seg1}_{seg2}
 *       :{category}_{subCategory}_{brand}_{landing}_{offer}_{time}_{date}
 *       :{keywords}
 *
 * The separators are part of the format: "=" after cid, ":" between groups,
 * "_" inside groups.
 *
 * Every field is a SHORT CODE picked from a dropdown — never slugified free
 * text. "Upto 60% off" is `upto`, not `upto60off`. The master lists and the
 * source-column mappings live in `trackingMasters.ts` so new values can be
 * added without touching this file.
 *
 * There are NO "na" placeholders. Real codes never contain one: a missing
 * field is a validation failure that blocks QC, not a value to pad with.
 */

/* ───────────────────────── the seven groups ───────────────────────── */

export interface TrackingField {
  /** 1-based group position in the code. */
  group: number;
  key: keyof TrackingFields;
  label: string;
  /** Separator that follows this field: ":" ends a group, "_" stays inside. */
  next: ":" | "_" | "";
}

/**
 * THE SCHEMA. Reordering here is the only change needed to reorder output;
 * nothing else in the codebase knows a position or a separator.
 */
export const TRACKING_SCHEMA: readonly TrackingField[] = [
  { group: 1, key: "campaign_type",  label: "Campaign Type",  next: ":" },
  { group: 2, key: "campaign_name",  label: "Campaign Name",  next: ":" },
  { group: 3, key: "channel_name",   label: "Channel Name",   next: "_" },
  { group: 3, key: "channel_format", label: "Channel Format", next: ":" },
  { group: 4, key: "segment_1",      label: "Segment 1",      next: "_" },
  { group: 4, key: "segment_2",      label: "Segment 2",      next: ":" },
  { group: 5, key: "category",       label: "Category",       next: "_" },
  { group: 5, key: "sub_category",   label: "Sub Category",   next: "_" },
  { group: 5, key: "brand",          label: "Brand",          next: "_" },
  { group: 5, key: "landing",        label: "Landing",        next: "_" },
  { group: 5, key: "offer",          label: "Offer",          next: "_" },
  { group: 5, key: "time",           label: "Time",           next: "_" },
  { group: 5, key: "date",           label: "Date",           next: ":" },
  { group: 6, key: "keywords",       label: "Keywords",       next: "" },
] as const;

/** The short-code values the code is built from. All required. */
export interface TrackingFields {
  campaign_type: string;
  campaign_name: string;
  channel_name: string;
  channel_format: string;
  segment_1: string;
  segment_2: string;
  category: string;
  sub_category: string;
  brand: string;
  landing: string;
  offer: string;
  time: string;
  date: string;
  keywords: string;
}

/* ───────────────────────── field normalisers ───────────────────────── */

/**
 * Brand short code: lowercase, punctuation and spaces removed.
 *   "US Polo Assn"   -> uspoloassn
 *   "Mia by Tanishq" -> miabytanishq
 *   "Levi's"         -> levis
 * More than one brand -> "multibrand".
 */
/** Lowercase, accents folded, every non-alphanumeric removed. */
function normaliseBrand(v: string): string {
  return v.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

export function brandCode(brand: string | null | undefined): string {
  const raw = (brand ?? "").trim();
  if (!raw) return "";
  const flat = raw.toLowerCase().replace(/\s+/g, " ").trim();
  // A single brand whose own name contains "&" or "and" is NOT multibrand.
  // Checked before the separator rule, or Jack & Jones would be mangled.
  const known = BRAND_NOT_MULTI.some((b) => b === flat);
  // Several brands listed together, however they were separated.
  if (!known && /[,;/]|\s(?:and|&)\s|\bmulti\s*brand\b/i.test(raw)) return MULTI_BRAND;
  // For a known single brand the "&" is part of the name and is spoken as
  // "and": Jack & Jones -> jackandjones, not jackjones.
  if (known) return normaliseBrand(raw.replace(/&/g, "and"));
  return raw.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

/**
 * Time short code: "h" + hour, 24-hour, minutes dropped (floor).
 *   07:00 / 07:30 -> h7     10:30 -> h10
 *   13:30         -> h13    20:20 -> h20
 *   01:00         -> h1
 *   MIDNIGHT (00:xx) -> h24, deliberately NOT h0.
 */
export function timeCode(time: string | null | undefined): string {
  const raw = (time ?? "").trim();
  if (!raw) return "";
  let hour: number | null = null;

  // "7:30 PM" / "12:00 AM"
  const ampm = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*([AaPp])\.?[Mm]\.?$/);
  if (ampm) {
    let h = parseInt(ampm[1], 10) % 12;
    if (/[Pp]/.test(ampm[3])) h += 12;
    hour = h;
  } else {
    const h24 = raw.match(/^(\d{1,2}):(\d{2})/);
    if (h24) hour = parseInt(h24[1], 10);
  }
  if (hour === null || Number.isNaN(hour)) return "";
  if (hour === 0 || hour === 24) return "h24";   // midnight
  return `h${hour}`;
}

/**
 * Date short code: ddmmyy, ALWAYS six digits with the leading zero.
 *   2026-07-04 -> 040726
 * The source sheet has a bug writing "40726"; that is not reproduced.
 * Parsed from the ISO string by hand, never through a Date object, which
 * would shift the day across timezones.
 */
export function dateCode(date: string | null | undefined): string {
  const raw = (date ?? "").trim();
  if (!raw) return "";
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}${iso[2]}${iso[1].slice(2)}`;
  const dmy = raw.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (dmy) {
    const dd = dmy[1].padStart(2, "0");
    const mm = dmy[2].padStart(2, "0");
    const yy = dmy[3].slice(-2);
    return `${dd}${mm}${yy}`;
  }
  return "";
}

/* ───────────────────────── suggestion ───────────────────────── */

/**
 * Pre-fills the tracking fields from the campaign's source columns. Every
 * value is a SUGGESTION — CRM can override all of them, which is why these
 * are stored in their own columns rather than recomputed at render time.
 *
 * Fields with no reliable rule in the sheet are left blank rather than
 * guessed: Segment 2 (cat/int) and Sub Category are CRM's choice.
 */
export function suggestTrackingFields(c: Campaign): TrackingFields {
  const existing = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : "");
  return {
    campaign_type:  existing(c.campaign_type) || CAMPAIGN_TYPE_PN,
    campaign_name:  existing(c.campaign_name_code) || CAMPAIGN_NAME_PRP,
    channel_name:   existing(c.channel_name) || CHANNEL_NAME_PUSH,
    // img when a creative is attached, text otherwise.
    channel_format: existing(c.channel_format)
      || (c.creative_link ? "img" : "text"),
    segment_1:      existing(c.segment_1)
      || mapFirst(SEGMENT_1_MAP, c.pncc_segment_label) || "",
    // Pre-filled from the flow: CRM Self is internal, everything that came
    // through Category (including emergencies) is category-led.
    segment_2:      existing(c.segment_2) || (c.is_crm_self ? "int" : "cat"),
    category:       existing(c.tracking_category)
      || mapFirst(CATEGORY_MAP, c.category ?? c.pncc_category_code) || "",
    sub_category:   existing(c.tracking_sub_category),     // CRM picks
    brand:          existing(c.tracking_brand) || brandCode(c.brand),
    landing:        existing(c.tracking_landing) || "plp", // plp is the default
    offer:          existing(c.tracking_offer)
      // Blank unless exactly one offer type is present (#2).
      || mapOffer(c.offer) || "",
    time:           timeCode(c.launch_time),
    date:           dateCode(c.launch_date),
    keywords:       existing(c.keywords) || "onetime",
  };
}

/* ───────────────────────── build ───────────────────────── */

export interface TrackingCodeResult {
  code: string;
  /** Labels of fields that are empty. Non-empty means the code is invalid. */
  missing: string[];
  valid: boolean;
}

/**
 * Builds the code from explicit short codes. Pure: reads nothing but the
 * fields passed in, so no row can influence another.
 *
 * A code is only returned when EVERY field is present. There is no padding
 * — an incomplete code would be silently wrong in analytics forever, which
 * is worse than no code at all.
 */
export function buildTrackingCode(fields: TrackingFields): TrackingCodeResult {
  const missing = TRACKING_SCHEMA
    .filter((f) => !(fields[f.key] ?? "").trim())
    .map((f) => f.label);

  if (missing.length > 0) return { code: "", missing, valid: false };

  let code = `${CID_PREFIX}=`;
  TRACKING_SCHEMA.forEach((f) => {
    code += fields[f.key].trim() + f.next;
  });

  return { code, missing: [], valid: true };
}

/** Convenience: suggest then build, for a campaign row. */
export function buildFromCampaign(c: Campaign): TrackingCodeResult {
  return buildTrackingCode(suggestTrackingFields(c));
}

/* ───────────────────────── landing + tracking ───────────────────────── */

const TATACLIQ = /^https:\/\/www\.tatacliq\.com\//i;

export interface LandingResult {
  url: string;
  error?: string;
}

/**
 * Inserts the tracking code as the FIRST query parameter and strips any
 * existing icid2 parameter.
 *
 *   with "?":  base + "?" + code + "&" + rest (icid2 removed)
 *   without:   base + "?" + code
 *
 * Reproduced 3,040 of 3,046 sheet rows exactly; the six misses were sheet
 * errors (a stray space, #REF!, and page titles pasted where a URL belongs)
 * which is why the URL is validated rather than trusted.
 */
export function buildLandingPlusTracking(
  landingUrl: string | null | undefined, code: string
): LandingResult {
  // The sheet contains values like "Must-Have ?cid=" — trim hard.
  const raw = (landingUrl ?? "").trim().replace(/\s+/g, "");
  if (!raw) return { url: "", error: "Landing link is empty." };
  if (!code) return { url: "", error: "Tracking code is not generated yet." };
  if (!TATACLIQ.test(raw)) {
    return { url: "", error: "Missing Data: Landing link — not a https://www.tatacliq.com URL." };
  }

  const q = raw.indexOf("?");
  if (q === -1) return { url: `${raw}?${code}` };

  const base = raw.slice(0, q);
  const rest = raw.slice(q + 1)
    .split("&")
    .filter((p) => p && !/^icid2=/i.test(p))
    .join("&");

  return { url: rest ? `${base}?${code}&${rest}` : `${base}?${code}` };
}

/* ───────────────────────── check ───────────────────────── */

export interface TrackingCheck {
  ok: boolean;
  /** "✅ All Filled" or "⚠️ Missing Data". */
  label: string;
  missing: string[];
  detail: string;
}

/**
 * The Tracking Code Check shown in the grid and the drawer. "All Filled"
 * only when every field is present and the generated code is valid.
 * A warning blocks QC and Bulk Push — the existing mandatory gate.
 */
export function trackingCheck(fields: TrackingFields): TrackingCheck {
  const { missing, valid } = buildTrackingCode(fields);
  if (valid) return { ok: true, label: "✅ All Filled", missing: [], detail: "" };
  return {
    ok: false,
    label: "⚠️ Missing Data",
    missing,
    detail: `Missing: ${missing.join(", ")}.`,
  };
}

/** Generate once; Regenerate must be explicit. */
export const REGENERATE_MODE: "once" | "always" = "once";

export function shouldGenerate(c: Campaign, forced = false): boolean {
  if (forced) return true;
  if (REGENERATE_MODE === "always") return true;
  return !c.tracking_code || c.tracking_code.trim() === "";
}
