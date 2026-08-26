"use client";

import { supabase } from "@/lib/supabase";
import masterData from "@/data/masterData.json";

/**
 * Segment+Category pair pool for daily shuffle.
 * These are the approved combinations from the PN CC file.
 * The shuffle rotates through these pairs so the same user/segment
 * does not get the same category at the same time every day.
 */
const PAIR_POOL = [
  ["Men","MenA"],["Custom","Electronics"],["Men","MenA"],["Custom","Home"],
  ["Men","WomAE"],["Rest of the base","Westside"],["Custom","Non Fragrance"],
  ["Women","MenF"],["Men","Westside"],["Rest of the base","MenAcc"],
  ["Custom","Eyewear"],["Women","WomAE"],["Rest of the base","Westside"],
  ["Men","MenA"],["Rest of the base","Westside"],["Men","MenA"],
  ["Women","WomAE"],["Men","Westside"],["Fullbase","Westside"],
  ["Custom","MenAcc"],["Men","MenF"],["Rest of the base","MenA"],
  ["Women","Fragrance"],["Men","Fragrance"],["INB","MenA"],
  ["Repeat","Non Fragrance"],["RF + Dormant","WomAcc"],["Custom","KidsA"],
  ["Women","Westside"],["Men","Watches"],["Rest of the base","WomAE"],
  ["Custom","Eyewear"],["Women","Watches"],["Men","H&W"],
  ["Women","WomAcc"],["Men","MenA"],["Rest of the base","Westside"],
  ["Women","Westside"],["Men","Fragrance"],["Custom","Electronics"],
  ["Men","MenA"],["Custom","KidsF"],["Women","WomAE"],
  ["Men","Westside"],["Rest of the base","FineJew"],["Custom","WomF"],
  ["Women","Non Fragrance"],["Men","MenF"],["Rest of the base","MenA"],
  ["Men","Westside"],["Custom","WomAcc"],["Women","Westside"],
  ["Men","MenF"],["Rest of the base","Silver/Fashion Jew"],["Custom","Home"],
  ["Women","Westside"],["Men","Fragrance"],["Rest of the base","WomAE"],
  ["Fullbase","MenA"],["Shopper","Watches"],["Non Shopper","H&W"],
  ["INB","Westside"],["Active","MenA"],["RF + Dormant","MenF"],
  ["Custom","Home"],["Women","WomAE"],["Men","Westside"],
  ["Shopper","H&W"],["Non Shopper","WomAE"],["Custom","WomF"],
  ["Women","Westside"],["Men","MenA"],["Women","Watches"],
  ["Men","MenF"],["Rest of the base","Home"],["Custom","Non Fragrance"],
  ["Women","WomAW"],["Men","Watches"],["Rest of the base","Westside"],
  ["Custom","Fragrance"],["Men","MenF"],["Women","WomAE"],
  ["Men","Non Fragrance"],["Rest of the base","WomAW"],["INB","WomAE"],
  ["Active","Westside"],["Repeat","MenF"],["RF + Dormant","MenAcc"],
];

/** Generate a shuffled version of pairs for a given day-of-month. */
function shuffleForDay(dayOfMonth: number): [string, string][] {
  const pairs = [...PAIR_POOL];
  // Fisher-Yates with a deterministic seed so same day always gives same shuffle
  let seed = dayOfMonth * 2654435761;
  for (let i = pairs.length - 1; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const j = seed % (i + 1);
    [pairs[i], pairs[j]] = [pairs[j], pairs[i]];
  }
  return pairs as [string, string][];
}

const SLOTS_PER_TIME = 4;

export interface PopulateResult {
  totalDays: number;
  totalSlots: number;
  totalCampaigns: number;
}

/**
 * Populate an entire month of campaigns.
 * CRM clicks "Populate [Month] Campaigns" and the system generates
 * all date × time × slot rows with pre-shuffled segment+category pairs.
 */
export async function populateMonth(
  year: number,
  month: number, // 0-indexed
  userId: string
): Promise<PopulateResult> {
  const times = masterData.timeSlots;
  const lastDay = new Date(year, month + 1, 0).getDate();
  let totalCampaigns = 0;

  // Process day by day to stay within Supabase insert limits
  for (let day = 1; day <= lastDay; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const shuffled = shuffleForDay(day);

    const rows: Record<string, unknown>[] = [];
    let pairIdx = 0;

    for (const time of times) {
      for (let slot = 1; slot <= SLOTS_PER_TIME; slot++) {
        const [segment, category] = shuffled[pairIdx % shuffled.length];
        pairIdx++;

        rows.push({
          campaign_name: `${segment} · ${category}`,
          campaign_origin: "CRM_PLANNED",
          launch_date: dateStr,
          launch_time: time,
          pncc_segment_label: segment,
          pncc_category_code: category,
          category: category,
          slot_type: "STANDARD",
          category_status: "EMPTY",
          crm_status: "NOT_STARTED",
          content_status: "NOT_ASSIGNED",
          qc_status: "PENDING",
          production_status: "NOT_READY",
          priority: "NORMAL",
          created_by: userId,
        });
      }
    }

    // Insert in batches of 200
    for (let i = 0; i < rows.length; i += 200) {
      const batch = rows.slice(i, i + 200);
      const { error } = await supabase.from("campaigns").insert(batch);
      if (error) throw new Error(`Day ${day}: ${error.message}`);
    }
    totalCampaigns += rows.length;
  }

  return {
    totalDays: lastDay,
    totalSlots: times.length * SLOTS_PER_TIME,
    totalCampaigns,
  };
}

/** Check if a month has already been populated. */
export async function isMonthPopulated(year: number, month: number): Promise<number> {
  const from = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const to = `${year}-${String(month + 1).padStart(2, "0")}-${new Date(year, month + 1, 0).getDate()}`;
  const { count } = await supabase
    .from("campaigns")
    .select("id", { count: "exact", head: true })
    .gte("launch_date", from)
    .lte("launch_date", to);
  return count ?? 0;
}
