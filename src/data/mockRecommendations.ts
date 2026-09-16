import type { Campaign } from "@/types/campaign";
import type { Segment } from "@/types/targeting";

/**
 * Placeholder for the future model. The shape returned here is the contract the
 * trained model will have to honour, so swapping the implementation should not
 * touch a single component.
 *
 * Until the model exists, the reasoning is rule-based rather than random. Every
 * rule below comes from the CRM logic workbook: the offer factor table, the
 * segment-to-offer playbook, and the behavioural app-launch segments that show
 * when each part of the base is actually awake.
 */
export interface Recommendation {
  bestDay: string;
  bestTime: string;
  audience: string;
  segmentMoeName: string | null;
  cohort: string;
  offerConstruct: string;
  confidence: number;
  reason: string;
  factors: { factor: string; reading: string }[];
  source: "RULES" | "MODEL";
}

/** Behavioural windows from the Applaunch segments, with their live base sizes. */
const TIME_WINDOWS = [
  { time: "19:30", label: "evening peak", base: 0 },
  { time: "22:00", label: "10pm–12am browsers", base: 671041 },
  { time: "12:00", label: "midday", base: 0 },
  { time: "07:00", label: "5am–8am browsers", base: 312195 },
  { time: "00:30", label: "12am–2am browsers", base: 335223 },
];

/** Category to predominance segment, matching the MoEngage library. */
const CATEGORY_SEGMENT: Record<string, string> = {
  Beauty: "Predom_Beauty&Groom45D_27May",
  Fashion: "Predom_WomenApparel45D_27May",
  Luxury: "WomenPremium_15July25",
  Watches: "Predom_Watches45D_27May",
  Footwear: "Predom_MenFW45D_27May",
  Accessories: "Predom_Acc45D_27May",
  Jewellery: "Predom_FineJewell45D_27May",
};

/** Offer playbook, keyed by the customer state the campaign is aimed at. */
const OFFER_BY_STATE: Record<string, string> = {
  VIP: "Early access, gift or bonus points rather than discount",
  LAPSED: "15–25% off as a win-back",
  INTENT: "5–10% off — intent is already high",
  ACTIVE: "Personalised category offer",
  NEW: "15–20% off, or a flat ₹ off construct",
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function hash(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 100_000;
  return h;
}

export function recommendFor(campaign: Campaign, segments: Segment[] = []): Recommendation {
  const category = campaign.category ?? "Fashion";
  const h = hash(campaign.id + category);

  // --- audience: category predominance is the strongest available signal ---
  const moeName = CATEGORY_SEGMENT[category] ?? "Push_WomenSeg1_06June25";
  const segment = segments.find((s) => s.moe_name === moeName) ?? null;

  // --- offer: driven by the state the campaign is aimed at, per the playbook ---
  const state =
    campaign.priority === "CRITICAL" ? "VIP"
    : campaign.is_emergency ? "INTENT"
    : campaign.campaign_origin === "CRM_PLANNED" ? "LAPSED"
    : "ACTIVE";

  // --- timing: prefer a behavioural window with a real base behind it ---
  const window = TIME_WINDOWS[h % TIME_WINDOWS.length];

  // --- confidence: rises with how much we actually know about the target ---
  let confidence = 0.55;
  if (segment) confidence += 0.15;
  if (segment?.base_count && segment.base_count > 100_000) confidence += 0.08;
  if (campaign.brand) confidence += 0.06;
  if (window.base > 0) confidence += 0.07;
  confidence = Math.min(confidence, 0.94);

  const factors = [
    { factor: "Category Affinity",
      reading: segment
        ? `${segment.display_name} — ${segment.base_count?.toLocaleString("en-IN") ?? "unsized"} reachable`
        : "No predominance segment mapped for this category" },
    { factor: "Recency",
      reading: state === "LAPSED"
        ? "Aimed at a re-engagement window, so a win-back construct applies"
        : "Target is currently active, so relevance beats depth of discount" },
    { factor: "LTV",
      reading: state === "VIP"
        ? "High-value target — exclusives outperform discount"
        : "Mixed value base, standard construct" },
    { factor: "Brand Affinity",
      reading: campaign.brand
        ? `${campaign.brand} affinity can be layered onto the predominance segment`
        : "No brand set, so the offer stays category-level" },
  ];

  return {
    bestDay: WEEKDAYS[h % 7],
    bestTime: window.time,
    audience: segment?.display_name ?? "Women — broad push base",
    segmentMoeName: segment?.moe_name ?? null,
    cohort: state === "VIP" ? "High Value Customers"
      : state === "LAPSED" ? "Inactive base — no order in 12 months"
      : "Same-month shoppers",
    offerConstruct: OFFER_BY_STATE[state],
    confidence,
    reason: `${category} pushes index best against the predominance segment, and ${window.label} carries a measurable share of app launches for this base. The offer construct follows the playbook for this customer state.`,
    factors,
    source: "RULES",
  };
}
