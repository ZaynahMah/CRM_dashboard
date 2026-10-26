/**
 * The controlled Category FILTER list.
 *
 * Defined ONCE and reused by Show All PN and All Campaigns so every login
 * sees the same options. Deliberately fixed rather than derived from the
 * data: a filter built from historical records grows stale category names
 * nobody recognises.
 *
 * This is a FILTER list only. Campaign Sub Category and Brand remain FREE
 * TEXT inputs — do not use this to turn an input back into a dropdown.
 */

export const ALL_CATEGORIES_LABEL = "All Categories";

/** Exactly the twenty approved labels, in the order given. */
export const CAMPAIGN_CATEGORY_FILTER_OPTIONS = [
  "Electronics",
  "Women AE",
  "MenA",
  "Non Fragrance",
  "Eyewear",
  "Westside",
  "Watches",
  "KidsA",
  "MenF",
  "Fine jewl",
  "Fragrance",
  "CRM",
  "PC/CC",
  "H & W",
  "WomenF",
  "Silver/Fashion Jew",
  "Women AW",
  "Home",
  "MenAcc",
  "WomenAcc",
] as const;

export type CategoryFilterOption = (typeof CAMPAIGN_CATEGORY_FILTER_OPTIONS)[number];

/**
 * Stored category values do not always match these labels: the source
 * sheets use abbreviations and inconsistent spacing. Matching is therefore
 * done on a normalised key rather than by string equality.
 *
 * Normalisation ONLY affects matching. No stored record is rewritten.
 */
const normalise = (v: string) =>
  v.toLowerCase().replace(/[\s_\-/&.]/g, "");

/**
 * Explicit aliases, for cases normalisation alone cannot resolve — the
 * label and the stored value are genuinely different strings.
 *
 * Derived from the category codes already in `trackingMasters.CATEGORY_MAP`,
 * which is the app's existing mapping from sheet values to canonical codes.
 * Nothing here is guessed: each entry corresponds to a value that mapping
 * already recognises.
 */
const ALIASES: Record<string, string[]> = {
  "Women AE":           ["womae", "womensindianwear", "womenae", "womapind"],
  "Women AW":           ["womaw", "womenaw", "womapwes"],
  "WomenF":             ["womf", "womenf"],
  "WomenAcc":           ["womacc", "accessorieswomen", "womenacc"],
  "MenA":               ["mena", "menapparel", "menap"],
  "MenF":               ["menf"],
  "MenAcc":             ["menacc", "accessoriesmen"],
  "Non Fragrance":      ["nonfragrance", "beautynonfragrance", "beauty"],
  "Fine jewl":          ["finejew", "finejewellery", "finesilverjewellery", "finejewl"],
  "Silver/Fashion Jew": ["silverfashionjew", "fashionjewellery", "fashjew", "silver"],
  "H & W":              ["hw", "healthwellness", "wellness"],
  "KidsA":              ["kidsa", "kidsapparel", "kidsap"],
  "PC/CC":              ["pccc", "cliqcash", "powercash", "multicat", "midnightproperty"],
  "Electronics":        ["electronics", "etx"],
  "Eyewear":            ["eyewear", "eye"],
  "Watches":            ["watches"],
  "Westside":           ["westside"],
  "Fragrance":          ["fragrance", "frag"],
  "Home":               ["home", "homedecor"],
  "CRM":                ["crm"],
};

/**
 * Does a campaign's stored category belong to the selected filter label?
 *
 * An empty or "All Categories" selection matches everything. A campaign
 * with no category never matches a specific label — it is not silently
 * grouped into one.
 */
export function matchesCategoryFilter(
  storedCategory: string | null | undefined,
  selectedLabel: string
): boolean {
  if (!selectedLabel || selectedLabel === ALL_CATEGORIES_LABEL) return true;
  const stored = (storedCategory ?? "").trim();
  if (!stored) return false;

  const key = normalise(stored);
  if (key === normalise(selectedLabel)) return true;
  return (ALIASES[selectedLabel] ?? []).includes(key);
}

/** Filters any campaign-like list by the selected label. */
export function filterByCategory<T extends { category?: string | null; pncc_category_code?: string | null }>(
  rows: T[], selectedLabel: string
): T[] {
  if (!selectedLabel || selectedLabel === ALL_CATEGORIES_LABEL) return rows;
  return rows.filter((r) =>
    matchesCategoryFilter(r.category, selectedLabel)
    || matchesCategoryFilter(r.pncc_category_code, selectedLabel));
}
