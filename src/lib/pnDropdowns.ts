import options from "@/config/pn_dropdown_options.json";

/**
 * The PN tracking dropdown options.
 *
 * `src/config/pn_dropdown_options.json` is the ONLY source. Nothing here
 * hard-codes a value, so CRM can update that file and the dropdowns change
 * with no code edit.
 *
 * Verified against the committed file: campaign_type 5, campaign_name 4,
 * channel_name 14, channel_format 15, segment_1 47, segment_2 4,
 * category_code 23, landing_code 15, brand_code 3598, offer_code 15,
 * keywords 69, slot 24, and subcategory_by_category covering all 23
 * category codes.
 */

interface DropdownFile {
  campaign_type: string[];
  campaign_name: string[];
  channel_name: string[];
  channel_format: string[];
  segment_1: string[];
  segment_2: string[];
  category_code: string[];
  subcategory_by_category: Record<string, string[]>;
  landing_code: string[];
  brand_code: string[];
  offer_code: string[];
  keywords: string[];
  /** Present in the file but deliberately NOT offered as a dropdown. */
  slot: string[];
}

const FILE = options as unknown as DropdownFile;

/**
 * Campaign column → option list.
 *
 * `slot` is absent on purpose: slot is chosen in CRM Step 1 and its logic
 * is unchanged, so no slot dropdown is offered anywhere.
 */
export const PN_OPTIONS: Record<string, readonly string[]> = {
  campaign_type: FILE.campaign_type,
  campaign_name_code: FILE.campaign_name,
  channel_name: FILE.channel_name,
  channel_format: FILE.channel_format,
  segment_1: FILE.segment_1,
  segment_2: FILE.segment_2,
  tracking_category: FILE.category_code,
  tracking_landing: FILE.landing_code,
  tracking_brand: FILE.brand_code,
  tracking_offer: FILE.offer_code,
  keywords: FILE.keywords,
};

/** Options for one column, or an empty list if it has none. */
export const optionsFor = (key: string): readonly string[] => PN_OPTIONS[key] ?? [];

/**
 * Sub-category codes valid for one category code.
 *
 * Empty until a category code is chosen, which is what disables the
 * dependent dropdown.
 */
export function subcategoriesFor(categoryCode: string | null | undefined): readonly string[] {
  const c = (categoryCode ?? "").trim();
  if (!c) return [];
  return FILE.subcategory_by_category[c] ?? [];
}

/**
 * Is a saved sub-category still valid for the chosen category?
 *
 * Used to clear a stale value when the category code changes.
 */
export function isSubcategoryValid(
  categoryCode: string | null | undefined, subCode: string | null | undefined
): boolean {
  const s = (subCode ?? "").trim();
  if (!s) return true;                       // empty is not invalid
  return subcategoriesFor(categoryCode).includes(s);
}

/**
 * A stored value that is not in the option list.
 *
 * Such values are shown as-is and never wiped — historical rows carry codes
 * that predate the current list, and silently clearing them would corrupt a
 * tracking code that is already live.
 */
export function isOffList(key: string, value: string | null | undefined): boolean {
  const v = (value ?? "").trim();
  if (!v) return false;
  const list = optionsFor(key);
  if (list.length === 0) return false;
  return !list.includes(v);
}

/** Columns whose lists are long enough to need type-to-filter. */
export const SEARCHABLE_KEYS = new Set([
  "tracking_brand",   // 3,598
  "segment_1",        // 47
  "keywords",         // 69
]);

/** Columns CRM can bulk fill. */
export const BULK_FILL_KEYS = new Set([
  "campaign_type", "campaign_name_code", "channel_name", "channel_format",
  "segment_2",
]);

/** Brand codes are lowercase alphanumerics — enforced on an added value. */
export const isValidNewBrandCode = (v: string) => /^[a-z0-9]+$/.test(v.trim());

/**
 * Which fields CRM may add new values to.
 *
 * Brand only for now. Opening Segment 1 or Keywords later is adding a key
 * here — the storage, merge and validation are already generic.
 */
export const ALLOW_ADD_NEW = new Set(["tracking_brand"]);

/** The `field` value stored in custom_pn_options for a grid column. */
export const STORAGE_FIELD: Record<string, string> = {
  tracking_brand: "brand_code",
  segment_1: "segment_1",
  keywords: "keywords",
};

/**
 * Normalises a value for duplicate checking: trimmed and lowercased, so
 * "Levis", "LEVIS" and " levis " are all the same code.
 */
export const normaliseOptionValue = (v: string) => v.trim().toLowerCase();

/**
 * JSON options first, then anything CRM has added, de-duplicated
 * case-insensitively.
 *
 * JSON order is preserved and added values are appended in the order they
 * were added, so a familiar list never reshuffles under the user.
 */
export function mergeOptions(
  key: string, custom: readonly string[]
): readonly string[] {
  const base = optionsFor(key);
  const seen = new Set(base.map(normaliseOptionValue));
  const extra: string[] = [];
  for (const c of custom) {
    const n = normaliseOptionValue(c);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    extra.push(c);
  }
  return extra.length === 0 ? base : [...base, ...extra];
}

/** Is this value already taken, in the JSON or in the added values? */
export function isDuplicateOption(
  key: string, custom: readonly string[], candidate: string
): boolean {
  const n = normaliseOptionValue(candidate);
  if (!n) return false;
  return optionsFor(key).some((o) => normaliseOptionValue(o) === n)
    || custom.some((o) => normaliseOptionValue(o) === n);
}
