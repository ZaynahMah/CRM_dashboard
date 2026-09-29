/** PN CC master data types — the source of truth for this iteration. */

export interface PnccSegment {
  id: number;
  condition_label: string;
  segment_name: string;
  gender: string | null;
  is_active: boolean;
}

export interface PnccCategory {
  id: number;
  code: string;
  label: string;
  group_id: string | null;
}

export interface ApprovedPair {
  id: number;
  segment_label: string;
  category_code: string;
}

export interface FixedTimeSlot {
  id: number;
  slot_time: string;
  slot_index: number;
  is_standard: boolean;
}

export type SlotType = "STANDARD" | "ADDITIONAL";
