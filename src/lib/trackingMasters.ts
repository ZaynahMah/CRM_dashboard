/**
 * Dropdown master lists and source-column mappings for tracking codes.
 *
 * ONE config file, by design: new values arrive from the CRM team regularly
 * (new segments, new sub-categories, new brands), and adding one must never
 * require a code change beyond this file. If you later move these into a
 * Supabase table, keep the shapes below as the contract.
 *
 * Every field is a SHORT CODE chosen from a dropdown, never slugified free
 * text. "Upto 60% off" does not become "upto60off" — it becomes "upto".
 */

/* ---------------- fixed values ---------------- */

export const CID_PREFIX = "cid";
export const CAMPAIGN_TYPE_PN = "pn";
/** prp = one-time campaign. */
export const CAMPAIGN_NAME_PRP = "prp";
export const CHANNEL_NAME_PUSH = "push";

/* ---------------- dropdowns ---------------- */

export const CHANNEL_FORMATS = ["text", "img"] as const;

export const SEGMENT_1_VALUES = [
  "wom", "men", "menall", "fullbase", "reactivation", "prpsty45d", "actshp",
  "represt", "rfreprest", "inb", "actrptwom", "actrptmen", "repwom", "repmen",
  "rfrepwom", "rfrepmen", "drmntwom", "dormant", "inbwom", "inbmen", "shpper",
  "nshpper", "shpperwom", "shppermen", "nshpperwom", "nshppermen", "hni",
] as const;

/**
 * Segment 2. The STORED value is always "cat" or "int"; the labels exist
 * only so the dropdown is readable.
 */
export const SEGMENT_2_VALUES = ["cat", "int"] as const;

export const SEGMENT_2_LABELS: Record<string, string> = {
  cat: "cat – Category",
  int: "int – Internal",
};

export const CATEGORY_VALUES = [
  "westside", "menap", "menf", "womapwes", "womapind", "womf", "menacc",
  "womacc", "watches", "beauty", "frag", "finejew", "fashjew", "etx",
  "wellness", "home", "eye", "kidsf", "kidsap", "multicat",
] as const;

export const SUB_CATEGORY_VALUES = [
  "overall", "casual", "other", "men", "women", "sport", "multisubc",
  "suitset", "tshirt", "bag", "dress", "formal", "makeup", "multivit",
  "topstee", "gold", "skincare", "shirt", "lingerie", "womens", "mens",
  "haircare", "mobileacc", "sneaker", "bed", "jean", "bottom", "kurti",
  "silver", "kitchen", "headphsp", "saree", "furni", "kitchenap",
  "wearabletech", "innerw", "luggage", "totebag", "short",
] as const;

export const LANDING_VALUES = ["plp", "clp"] as const;

/**
 * The ten offer codes, in the order the CRM team confirmed. "und" is
 * deliberately absent — it was never a real value.
 */
export const OFFER_VALUES = [
  "upto",    // Up to X% off
  "starts",  // Starting at a price
  "min",     // Minimum X% off
  "under",   // Under a price
  "ccash",   // CLiQ Cash
  "nooffer", // No offer
  "flat",    // Flat X% or rupee amount off
  "extra",   // Extra X% off, on its own
  "coupon",  // Coupon-led
  "buyget",  // Buy X Get Y
] as const;

export const KEYWORD_VALUES = ["onetime", "earlyaccess", "bday"] as const;

export const MULTI_BRAND = "multibrand";

/**
 * Single brands whose own name contains a separator. Without this list the
 * "&" rule would turn Jack & Jones into "multibrand", which is wrong and
 * silently so. Admin can extend this.
 */
export const BRAND_NOT_MULTI: readonly string[] = [
  "jack & jones", "jack and jones",
  "marks & spencer", "dolce & gabbana", "abercrombie & fitch",
  "tommy hilfiger", "h & m", "bath & body works", "crabtree & evelyn",
  "ben sherman", "duke & dexter", "kate spade", "johnnie walker",
];

/* ---------------- source-column mappings ---------------- */

/**
 * SEGMENTS column text -> Segment 1 short code.
 * Longest pattern first: "inb women" must win over "inb", and
 * "men overall" over "men". CRM can override the suggestion.
 */
export const SEGMENT_1_MAP: [RegExp, string][] = [
  [/men[_\s]*overall/i, "menall"],
  // NOTE: \b is wrong here — "_" is a word character in JS regex, so \b
  // never matches between "Wom" and "_" in "Rep_Wom_Sale". END is an
  // explicit "not followed by a letter or digit" instead.
  [/active[_\s]*wom(en)?(?![a-z0-9])/i, "actrptwom"],
  [/active[_\s]*men(?![a-z0-9])/i, "actrptmen"],
  // rf FIRST: "RFRep_Wom" contains "Rep_Wom", so the plain repeat patterns
  // would otherwise claim it and produce repwom instead of rfrepwom.
  [/(rfrep|rf)[_\s]*wom(en)?(?![a-z0-9])/i, "rfrepwom"],
  [/(rfrep|rf)[_\s]*men(?![a-z0-9])/i, "rfrepmen"],
  [/(repeat|rep)[_\s]*wom(en)?(?![a-z0-9])/i, "repwom"],
  [/(repeat|rep)[_\s]*men(?![a-z0-9])/i, "repmen"],
  [/(dormant|drmnt)[_\s]*wom(en)?(?![a-z0-9])/i, "drmntwom"],
  [/(dormant|drmnt)[_\s]*men(?![a-z0-9])/i, "dormant"],
  [/inb[_\s]*wom(en)?(?![a-z0-9])/i, "inbwom"],
  [/inb[_\s]*men(?![a-z0-9])/i, "inbmen"],
  [/rf[_\s]*drmnt|rf\s*\+\s*dormant/i, "rfreprest"],
  [/predom.*45d|^custom$|cliqcash/i, "prpsty45d"],
  [/active[_\s]*m1\s*to\s*m3|^active$/i, "actshp"],
  [/repeat[_\s]*m4\s*to\s*m6|^repeat$/i, "represt"],
  [/rest\s*of\s*(the\s*)?base/i, "reactivation"],
  [/fullbase|full\s*base/i, "fullbase"],
  [/push[_\s]*women?seg\d*|push[_\s]*women|^women$/i, "wom"],
  [/push[_\s]*menseg|push[_\s]*men|^men$/i, "men"],
  [/\bdormant\b/i, "dormant"],
  [/\binb(?![a-z0-9])/i, "inb"],
  [/non[\s-]*shopper\s*women/i, "nshpperwom"],
  [/non[\s-]*shopper\s*men/i, "nshppermen"],
  [/non[\s-]*shopper/i, "nshpper"],
  [/shopper\s*women/i, "shpperwom"],
  [/shopper\s*men/i, "shppermen"],
  [/shopper/i, "shpper"],
  [/\bhni\b/i, "hni"],
];

/** CATEGORY column text -> Category short code. */
export const CATEGORY_MAP: [RegExp, string][] = [
  [/westside/i, "westside"],
  [/^men\s*a$|^mena$|men\s*apparel/i, "menap"],
  [/^men\s*f$|^menf$/i, "menf"],
  [/wom\s*aw|womaw/i, "womapwes"],
  [/wom\s*ae|womae|women.?s?\s*indianwear/i, "womapind"],
  [/^wom\s*f$|^womf$/i, "womf"],
  [/accessories\s*men|menacc/i, "menacc"],
  [/accessories\s*women|womacc/i, "womacc"],
  [/watches/i, "watches"],
  [/non\s*fragrance|beauty\s*non\s*fragrance/i, "beauty"],
  [/fragrance/i, "frag"],
  [/fine\s*jew|fine\/silver\s*jewellery|finejew/i, "finejew"],
  [/fashion\s*jew|fashjew/i, "fashjew"],
  [/electronics/i, "etx"],
  [/h\s*&\s*w|health.*wellness/i, "wellness"],
  [/^home$|home\s*decor|^home\b/i, "home"],
  [/eyewear/i, "eye"],
  [/kids\s*f|kidsf/i, "kidsf"],
  [/kids\s*apparel|kidsap/i, "kidsap"],
  [/cliq\s*cash|power\s*cash|pc\/cc|multi[\s-]*categ|midnight\s*propert/i, "multicat"],
];

/**
 * OFFER column text -> Offer short code.
 *
 * There is NO "first match wins" rule. A combined offer such as
 * "Upto 60% + Extra 10%" matches two types, and guessing which one CRM
 * meant produced wrong codes that are permanent once in analytics. Multiple
 * matches leave the field blank for CRM to pick. See `mapOffer`.
 */
export const OFFER_MAP: [RegExp, string][] = [
  [/\bupto\b|\bup\s*to\b/i, "upto"],
  [/\bstart(s|ing)\b|\bstarting\s*@/i, "starts"],
  [/\bmin\b|\bminimum\b/i, "min"],
  [/\bunder\b/i, "under"],
  [/\bflat\b/i, "flat"],
  [/buy\s*\d*\s*get/i, "buyget"],
  [/cliq\s*cash|\bccash\b/i, "ccash"],
  [/\bcoupon\b/i, "coupon"],
  [/\bextra\b/i, "extra"],
  [/no\s*offer|^none$/i, "nooffer"],
];

/**
 * Offer pre-fill. Returns a code ONLY when exactly one offer type is
 * present; blank for none and blank for more than one.
 */
export function mapOffer(text: string | null | undefined): string | null {
  const t = (text ?? "").trim();
  if (!t) return null;
  const hits = new Set<string>();
  for (const [re, code] of OFFER_MAP) if (re.test(t)) hits.add(code);
  return hits.size === 1 ? [...hits][0] : null;
}

/** First matching pattern wins; null when nothing matches. */
export function mapFirst(map: [RegExp, string][], text: string | null | undefined): string | null {
  const t = (text ?? "").trim();
  if (!t) return null;
  for (const [re, code] of map) if (re.test(t)) return code;
  return null;
}
