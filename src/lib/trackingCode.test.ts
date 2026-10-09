import { describe, it, expect } from "vitest";
import {
  buildTrackingCode, suggestTrackingFields, buildLandingPlusTracking,
  trackingCheck, brandCode, timeCode, dateCode, TRACKING_SCHEMA, type TrackingFields,
} from "./trackingCode";
import {
  KEYWORD_VALUES, OFFER_VALUES, SEGMENT_1_MAP, CATEGORY_MAP, SEGMENT_2_VALUES,
  mapFirst, mapOffer,
} from "./trackingMasters";
import type { Campaign } from "@/types/campaign";

const F = (o: Partial<TrackingFields> = {}): TrackingFields => ({
  campaign_type: "pn", campaign_name: "prp", channel_name: "push", channel_format: "text",
  segment_1: "wom", segment_2: "cat", category: "westside", sub_category: "women",
  brand: "multibrand", landing: "plp", offer: "starts", time: "h7", date: "010726",
  keywords: "onetime", ...o,
});

describe("the five real production codes", () => {
  const cases: [string, Partial<TrackingFields>][] = [
    ["cid=pn:prp:push_text:wom_cat:westside_women_multibrand_plp_starts_h7_010726:onetime", {}],
    ["cid=pn:prp:push_text:menall_cat:menap_sport_multibrand_plp_min_h7_010726:onetime",
      { segment_1: "menall", category: "menap", sub_category: "sport", offer: "min" }],
    ["cid=pn:prp:push_text:menall_cat:menf_sport_multibrand_plp_upto_h8_010726:onetime",
      { segment_1: "menall", category: "menf", sub_category: "sport", offer: "upto", time: "h8" }],
    ["cid=pn:prp:push_img:menall_int:multicat_multisubc_decathlon_plp_upto_h8_060726:onetime",
      { channel_format: "img", segment_1: "menall", segment_2: "int", category: "multicat",
        sub_category: "multisubc", brand: "decathlon", offer: "upto", time: "h8", date: "060726" }],
    ["cid=pn:prp:push_text:nshpper_int:multicat_multisubc_multibrand_plp_nooffer_h1_190726:onetime",
      { segment_1: "nshpper", segment_2: "int", category: "multicat", sub_category: "multisubc",
        offer: "nooffer", time: "h1", date: "190726" }],
  ];
  it.each(cases)("reproduces %s", (want, over) => {
    expect(buildTrackingCode(F(over)).code).toBe(want);
  });
  it("has no 'na' padding anywhere", () => {
    cases.forEach(([w]) => expect(/(^|[:_])na([:_]|$)/.test(w)).toBe(false));
  });
});

describe("time", () => {
  it.each([["07:00:00","h7"],["07:30:00","h7"],["10:30:00","h10"],["12:00:00","h12"],
    ["13:30:00","h13"],["20:20:00","h20"],["01:00:00","h1"],
    ["00:00:00","h24"],["00:20:00","h24"],["00:30:00","h24"],
    ["12:00 AM","h24"],["1:30 PM","h13"],["10:30 AM","h10"]])("%s -> %s", (i, o) => {
    expect(timeCode(i)).toBe(o);
  });
  it("midnight is h24, never h0", () => expect(timeCode("00:00:00")).not.toBe("h0"));
});

describe("date", () => {
  it.each([["2026-07-04","040726"],["2026-07-01","010726"],["2026-11-05","051126"],
    ["2026-10-28","281026"]])("%s -> %s", (i, o) => expect(dateCode(i)).toBe(o));
  it("is always six digits", () =>
    ["2026-01-01","2026-12-31","2026-07-04"].forEach(d => expect(dateCode(d)).toHaveLength(6)));
  it("does not reproduce the sheet's 5-digit bug", () =>
    expect(dateCode("2026-07-04")).not.toBe("40726"));
});

describe("brand", () => {
  it.each([["US Polo Assn","uspoloassn"],["Mia by Tanishq","miabytanishq"],
    ["Levi's","levis"],["Decathlon","decathlon"]])("%s -> %s", (i,o) =>
    expect(brandCode(i)).toBe(o));
  it.each(["Biba, W, Aurelia","Nike & Adidas","Puma/Reebok","Multi Brand","Nike and Adidas"])
    ("%s -> multibrand", (i) => expect(brandCode(i)).toBe("multibrand"));
  it("a single brand containing & is NOT multibrand", () => {
    expect(brandCode("Jack & Jones")).toBe("jackandjones");
    expect(brandCode("Marks & Spencer")).toBe("marksandspencer");
  });
});

describe("offer dropdown", () => {
  it("is exactly the ten approved values in order", () =>
    expect([...OFFER_VALUES]).toEqual(
      ["upto","starts","min","under","ccash","nooffer","flat","extra","coupon","buyget"]));
  it("does not contain 'und'", () =>
    expect([...OFFER_VALUES]).not.toContain("und"));
});

describe("offer pre-fill: one type only", () => {
  it.each([
    ["Upto 60% off", "upto"], ["Starting @699", "starts"], ["Min 30%", "min"],
    ["Under 999", "under"], ["Flat 40%", "flat"], ["Extra 10% off", "extra"],
    ["Buy 1 Get 1", "buyget"], ["CLiQ Cash", "ccash"],
  ])("%s -> %s", (text, code) => expect(mapOffer(text)).toBe(code));

  it.each([
    "Upto 60% + Extra 10%",
    "Min 30% + Extra 10% off",
    "Use coupon SAVE10 & get Flat 20%",
    "Starting @499, Upto 50% off",
  ])("combined offer %s leaves it BLANK for CRM", (text) =>
    expect(mapOffer(text)).toBeNull());

  it("blank offer text is blank", () => {
    expect(mapOffer("")).toBeNull();
    expect(mapOffer(null)).toBeNull();
  });

  it("there is no 'first offer wins' behaviour left", () =>
    expect(mapOffer("Upto 60% + Extra 10%")).not.toBe("upto"));
});

describe("source mappings", () => {
  it("more specific segment patterns win", () => {
    expect(mapFirst(SEGMENT_1_MAP, "INB Women")).toBe("inbwom");
    expect(mapFirst(SEGMENT_1_MAP, "INB_Wom_Festive")).toBe("inbwom");
    expect(mapFirst(SEGMENT_1_MAP, "INB")).toBe("inb");
    expect(mapFirst(SEGMENT_1_MAP, "INB_Festive")).toBe("inb");
    expect(mapFirst(SEGMENT_1_MAP, "Men_Overall_Sport")).toBe("menall");
  });
  it.each([
    ["Rep_Wom_Sale", "repwom"], ["Rep_Men_Sale", "repmen"],
    ["RFRep_Wom_X", "rfrepwom"], ["RFRep_Men_X", "rfrepmen"],
    ["Drmnt_Wom_X", "drmntwom"], ["Drmnt_Men_X", "dormant"],
    ["Active_Wom_X", "actrptwom"], ["Active_Men_X", "actrptmen"],
    ["Rest of Base", "reactivation"], ["Rest of the base", "reactivation"],
  ])("%s -> %s", (i, o) => expect(mapFirst(SEGMENT_1_MAP, i)).toBe(o));
  it("no match leaves it blank", () =>
    expect(mapFirst(SEGMENT_1_MAP, "Something Unmapped")).toBeNull());
  it("Midnight Property -> multicat", () =>
    expect(mapFirst(CATEGORY_MAP, "Midnight Property")).toBe("multicat"));
  it("category codes", () => {
    expect(mapFirst(CATEGORY_MAP, "MenA")).toBe("menap");
    expect(mapFirst(CATEGORY_MAP, "H&W")).toBe("wellness");
    expect(mapFirst(CATEGORY_MAP, "PC/CC")).toBe("multicat");
  });
});

describe("landing + tracking", () => {
  const code = "cid=pn:prp:push_text:wom_cat:westside_women_multibrand_plp_starts_h7_010726:onetime";
  it("puts the code first and strips icid2", () => {
    const r = buildLandingPlusTracking(
      "https://www.tatacliq.com/search?text=a&icid2=quick:qul", code);
    expect(r.url.startsWith(`https://www.tatacliq.com/search?${code}`)).toBe(true);
    expect(r.url).not.toMatch(/icid2/i);
    expect(r.url).toContain("&text=a");
  });
  it("appends ? when there is no query", () =>
    expect(buildLandingPlusTracking("https://www.tatacliq.com/men-homepage", code).url)
      .toBe(`https://www.tatacliq.com/men-homepage?${code}`));
  it("leaves no trailing & when icid2 was the only param", () =>
    expect(buildLandingPlusTracking("https://www.tatacliq.com/x?icid2=o", code).url)
      .toBe(`https://www.tatacliq.com/x?${code}`));
  it.each(["Must-Have Dresses", "https://evil.com/x", ""])
    ("rejects %s", (bad) => expect(buildLandingPlusTracking(bad, code).error).toBeTruthy());
  it("a pasted page title reports Missing Data: Landing link", () =>
    expect(buildLandingPlusTracking("Must-Have Dresses", code).error)
      .toContain("Missing Data: Landing link"));
  it("trims stray spaces", () =>
    expect(buildLandingPlusTracking(" https://www.tatacliq.com/x ", code).url).toContain("/x?"));
});

describe("validation blocks QC", () => {
  it("every field is required", () =>
    TRACKING_SCHEMA.forEach((f) =>
      expect(trackingCheck(F({ [f.key]: "" } as Partial<TrackingFields>)).ok).toBe(false)));
  it("a missing field yields no code at all", () =>
    expect(buildTrackingCode(F({ segment_2: "" })).code).toBe(""));
  it("names the missing field", () =>
    expect(trackingCheck(F({ segment_2: "" })).detail).toContain("Segment 2"));
  it("all filled reads ✅", () => expect(trackingCheck(F()).label).toBe("✅ All Filled"));
  it("names several missing fields at once", () => {
    const d = trackingCheck(F({ segment_2: "", offer: "" })).detail;
    expect(d).toContain("Segment 2");
    expect(d).toContain("Offer");
  });
  it("exactly one '=' and five ':'", () => {
    const c = buildTrackingCode(F()).code;
    expect((c.match(/=/g) ?? []).length).toBe(1);
    expect((c.match(/:/g) ?? []).length).toBe(5);
  });
});

describe("keywords", () => {
  it("offers exactly the three approved values", () =>
    expect([...KEYWORD_VALUES].sort()).toEqual(["bday", "earlyaccess", "onetime"]));
  it.each(["onetime", "earlyaccess", "bday"])("%s renders last", (k) =>
    expect(buildTrackingCode(F({ keywords: k })).code.endsWith(`:${k}`)).toBe(true));
});

describe("suggestion", () => {
  it("image creative suggests img, otherwise text", () => {
    expect(suggestTrackingFields({ creative_link: "https://x.png" } as Campaign).channel_format).toBe("img");
    expect(suggestTrackingFields({ creative_link: null } as Campaign).channel_format).toBe("text");
  });
  it("fixed values cannot end up blank", () => {
    const s = suggestTrackingFields({} as Campaign);
    expect([s.campaign_type, s.campaign_name, s.channel_name]).toEqual(["pn", "prp", "push"]);
  });
  it("CRM overrides beat the suggestion", () =>
    expect(suggestTrackingFields({ segment_1: "hni", pncc_segment_label: "Push_Women" } as Campaign).segment_1).toBe("hni"));
  it("Sub Category has no auto-derivation", () =>
    expect(suggestTrackingFields({} as Campaign).sub_category).toBe(""));

  it("Segment 2: Category-led -> cat, CRM Self -> int, Emergency -> cat", () => {
    expect(suggestTrackingFields({ is_crm_self: false } as Campaign).segment_2).toBe("cat");
    expect(suggestTrackingFields({ is_crm_self: true } as Campaign).segment_2).toBe("int");
    expect(suggestTrackingFields({ is_crm_self: false, is_emergency: true } as Campaign).segment_2).toBe("cat");
  });

  it("a CRM-set Segment 2 survives pre-fill and regeneration", () => {
    // The override must win even when it disagrees with the flow rule.
    const c = { is_crm_self: true, segment_2: "cat" } as Campaign;
    expect(suggestTrackingFields(c).segment_2).toBe("cat");
    expect(suggestTrackingFields(c).segment_2).toBe("cat");   // regenerate
  });

  it("a CRM-set Offer survives pre-fill even when the text is combined", () =>
    expect(suggestTrackingFields(
      { tracking_offer: "extra", offer: "Upto 60% + Extra 10%" } as Campaign).offer).toBe("extra"));

  it("Segment 2 stores the code, not the label", () =>
    expect([...SEGMENT_2_VALUES]).toEqual(["cat", "int"]));
});
