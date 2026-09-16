"use client";

import { supabase } from "@/lib/supabase";
import type { CalendarDay, CalendarSlot } from "@/types/calendar";
import type { Campaign } from "@/types/campaign";
import { isoDate } from "@/lib/format";

export interface SlotWithCampaign extends CalendarSlot {
  campaign: Campaign | null;
}
export interface DayWithSlots extends CalendarDay {
  slots: SlotWithCampaign[];
}

/** The whole board for a month: days -> slots -> campaign, in one round trip. */
export async function fetchMonth(year: number, month: number): Promise<DayWithSlots[]> {
  const from = isoDate(new Date(year, month, 1));
  const to = isoDate(new Date(year, month + 1, 0));

  const [{ data: days }, { data: slots }, { data: campaigns }] = await Promise.all([
    supabase.from("calendar_days").select("*").gte("date", from).lte("date", to).order("date"),
    supabase.from("calendar_slots").select("*").order("slot_number"),
    supabase.from("campaigns").select("*").gte("launch_date", from).lte("launch_date", to),
  ]);

  const bySlot = new Map<string, Campaign>();
  (campaigns ?? []).forEach((c) => c.calendar_slot_id && bySlot.set(c.calendar_slot_id, c as Campaign));

  const slotsByDay = new Map<string, SlotWithCampaign[]>();
  (slots ?? []).forEach((s) => {
    const list = slotsByDay.get(s.calendar_day_id) ?? [];
    list.push({ ...(s as CalendarSlot), campaign: bySlot.get(s.id) ?? null });
    slotsByDay.set(s.calendar_day_id, list);
  });

  return (days ?? []).map((d) => ({
    ...(d as CalendarDay),
    slots: (slotsByDay.get(d.id) ?? []).sort((a, b) => a.slot_number - b.slot_number),
  }));
}

export const DEFAULT_SLOT_TIMES = ["10:00", "12:00", "14:00", "16:00", "18:00", "19:30", "21:00"];

/** CRM opens a date and its slots. RULE 1 — only CRM reaches this. */
export async function createDay(date: string, times: string[], createdBy: string) {
  const d = new Date(date);
  const { data: day, error } = await supabase
    .from("calendar_days")
    .upsert(
      { date, month: d.getMonth() + 1, year: d.getFullYear(), created_by: createdBy },
      { onConflict: "date" }
    )
    .select().single();
  if (error) throw error;

  const rows = times.map((t, i) => ({
    calendar_day_id: day.id, slot_number: i + 1, slot_time: t, status: "AVAILABLE" as const,
  }));
  const { error: slotError } = await supabase
    .from("calendar_slots").upsert(rows, { onConflict: "calendar_day_id,slot_number" });
  if (slotError) throw slotError;
  return day as CalendarDay;
}

/** Open an entire month of dates in one action. */
export async function createMonth(year: number, month: number, times: string[], createdBy: string) {
  const last = new Date(year, month + 1, 0).getDate();
  for (let day = 1; day <= last; day++) {
    await createDay(isoDate(new Date(year, month, day)), times, createdBy);
  }
}

export async function setSlotStatus(slotId: string, status: CalendarSlot["status"]) {
  const { error } = await supabase.from("calendar_slots").update({ status }).eq("id", slotId);
  if (error) throw error;
}
