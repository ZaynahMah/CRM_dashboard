import { describe, it, expect } from "vitest";
import {
  PN_OPTIONS, optionsFor, subcategoriesFor, isSubcategoryValid, isOffList,
  SEARCHABLE_KEYS, BULK_FILL_KEYS, isValidNewBrandCode,
} from "./pnDropdowns";
import raw from "@/config/pn_dropdown_options.json";
import { buildTrackingCode, type TrackingFields } from "./trackingCode";

const file = raw as unknown as Record<string, string[] | Record<string, string[]>>;

describe("the JSON is the only source of options", () => {
  it.each([
    ["campaign_type", 5], ["campaign_name", 4], ["channel_name", 14],
    ["channel_format", 15], ["segment_1", 47], ["segment_2", 4],
    ["category_code", 23], ["landing_code", 15], ["brand_code", 3598],
    ["offer_code", 15], ["keywords", 69], ["slot", 24],
  ])("%s has %i options", (key, n) => {
    expect((file[key] as string[]).length).toBe(n);
  });

  it("every grid column resolves to the matching JSON list", () => {
    expect(optionsFor("campaign_type")).toEqual(file.campaign_type);
    expect(optionsFor("campaign_name_code")).toEqual(file.campaign_name);
    expect(optionsFor("tracking_category")).toEqual(file.category_code);
    expect(optionsFor("tracking_brand")).toEqual(file.brand_code);
    expect(optionsFor("tracking_offer")).toEqual(file.offer_code);
    expect(optionsFor("tracking_landing")).toEqual(file.landing_code);
    expect(optionsFor("keywords")).toEqual(file.keywords);
  });

  it("slot is NOT offered as a dropdown", () => {
    expect(PN_OPTIONS.slot).toBeUndefined();
    expect(optionsFor("slot")).toEqual([]);
    expect(optionsFor("slot_label")).toEqual([]);
  });

  it("an unknown column has no options rather than throwing", () => {
    expect(optionsFor("nonsense")).toEqual([]);
  });
});

describe("dependent sub-category", () => {
  const sub = file.subcategory_by_category as Record<string, string[]>;

  it("covers all 23 category codes", () => {
    expect(Object.keys(sub)).toHaveLength(23);
    for (const c of file.category_code as string[]) {
      expect(sub[c], `${c} has no subcategory list`).toBeDefined();
    }
  });

  it("menap has 16 and watches has 4", () => {
    expect(subcategoriesFor("menap")).toHaveLength(16);
    expect(subcategoriesFor("watches")).toHaveLength(4);
  });

  it("returns nothing until a category is chosen — that is what disables it", () => {
    expect(subcategoriesFor("")).toEqual([]);
    expect(subcategoriesFor(null)).toEqual([]);
    expect(subcategoriesFor(undefined)).toEqual([]);
  });

  it("an unknown category yields no options", () => {
    expect(subcategoriesFor("not_a_category")).toEqual([]);
  });

  it("validates a sub-category against its category", () => {
    const first = subcategoriesFor("menap")[0];
    expect(isSubcategoryValid("menap", first)).toBe(true);
    expect(isSubcategoryValid("watches", first)).toBe(false);
  });

  it("an empty sub-category is never invalid", () => {
    expect(isSubcategoryValid("menap", "")).toBe(true);
    expect(isSubcategoryValid("menap", null)).toBe(true);
  });

  it("changing category invalidates a stale sub-category", () => {
    const menapOnly = subcategoriesFor("menap")
      .find((x) => !subcategoriesFor("watches").includes(x))!;
    expect(isSubcategoryValid("watches", menapOnly)).toBe(false);
  });
});

describe("off-list values are shown, never wiped", () => {
  it("flags a saved value that is not in the list", () => {
    expect(isOffList("tracking_offer", "legacy_offer_2019")).toBe(true);
  });

  it("does not flag a valid value", () => {
    expect(isOffList("tracking_offer", (file.offer_code as string[])[0])).toBe(false);
  });

  it("empty is not off-list", () => {
    expect(isOffList("tracking_offer", "")).toBe(false);
    expect(isOffList("tracking_offer", null)).toBe(false);
  });

  it("a column with no list never flags", () => {
    expect(isOffList("ops_details", "anything")).toBe(false);
  });
});

describe("searchable and bulk-fill sets", () => {
  it("the long lists are searchable", () => {
    for (const k of ["tracking_brand", "segment_1", "keywords"]) {
      expect(SEARCHABLE_KEYS.has(k)).toBe(true);
    }
  });

  it("bulk fill covers exactly the five agreed columns", () => {
    expect([...BULK_FILL_KEYS].sort()).toEqual([
      "campaign_name_code", "campaign_type", "channel_format",
      "channel_name", "segment_2"]);
  });

  it("the dependent sub-category is NOT bulk fillable", () => {
    // One value cannot be valid across rows with different category codes.
    expect(BULK_FILL_KEYS.has("tracking_sub_category")).toBe(false);
  });
});

describe("new brand codes", () => {
  it.each(["levis", "nike", "arrow2"])("%s is valid", (v) =>
    expect(isValidNewBrandCode(v)).toBe(true));

  it.each(["Levis", "two words", "has-dash", "has_underscore", ""])(
    "%s is rejected", (v) => expect(isValidNewBrandCode(v)).toBe(false));
});

describe("tracking code generation is unaffected", () => {
  it("still produces the production format from dropdown values", () => {
    const f: TrackingFields = {
      campaign_type: "pn", campaign_name: "prp", channel_name: "push",
      channel_format: "text", segment_1: "wom", segment_2: "cat",
      category: "westside", sub_category: "women", brand: "multibrand",
      landing: "plp", offer: "starts", time: "h7", date: "010726",
      keywords: "onetime",
    };
    expect(buildTrackingCode(f).code).toBe(
      "cid=pn:prp:push_text:wom_cat:westside_women_multibrand_plp_starts_h7_010726:onetime");
  });
});
