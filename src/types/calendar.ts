export type SlotStatus = "AVAILABLE" | "ASSIGNED" | "BLOCKED";

export interface CalendarDay {
  id: string;
  date: string;
  month: number;
  year: number;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export interface CalendarSlot {
  id: string;
  calendar_day_id: string;
  slot_number: number;
  slot_time: string;
  status: SlotStatus;
  capacity: number;
  channel: string;
}

/** One date, many slots, many campaigns. */
export interface DayBoard {
  day: CalendarDay;
  slots: (CalendarSlot & { campaign: import("./campaign").Campaign | null })[];
}
