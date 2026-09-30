import type { Campaign } from "@/types/campaign";

/**
 * One source of truth for what Category must fill in, shared by the inline
 * grid (IncomingData) and the drawer form (CampaignDrawer). Both surfaces
 * write the same columns, so both must agree on what "complete" means —
 * otherwise a row can look ready in one place and not the other.
 */

/** The draft a user is editing. Always held per campaign UUID, never shared. */
export interface CategoryDraft {
  sub_category: string;
  brand: string;
  offer: string;
  brief: string;
  landing: string;
  expected_cvr: string;
  expected_rpv: string;
  additional_notes: string;
  date_time_brief: string;
}

export const CATEGORY_FIELD_LABEL: Record<string, string> = {
  sub_category: "Sub Category",
  brand: "Brand",
  offer: "Offer",
  brief: "Brief",
  landing: "Landing Link",
  expected_cvr: "Expected CVR",
  expected_rpv: "Expected RPV",
  additional_notes: "Comments",
  date_time_brief: "Date / Time Brief",
};

/**
 * Required before a row can be locked. Brand and Offer were already
 * required in practice (they gated the "Filled" pill and the old bulk
 * submit); the other four are newly mandatory this iteration.
 */
export const CATEGORY_REQUIRED = [
  "brand", "offer", "brief", "landing", "expected_cvr", "expected_rpv",
] as const;

export type CategoryRequiredField = (typeof CATEGORY_REQUIRED)[number];

/**
 * Digits with at most one decimal point. Deliberately a string test rather
 * than parseFloat: parsing and re-stringifying would turn "2.50" into "2.5"
 * and "450.00" into "450", silently rewriting what the user typed. The
 * column is `text`, so the typed value is stored exactly as entered.
 */
export const DECIMAL_RE = /^\d+(\.\d+)?$/;

export const NUMERIC_MESSAGE =
  "Numbers only — digits with at most one decimal point (e.g. 2.5).";

/** Fields that must be numeric if filled. */
export const CATEGORY_NUMERIC = ["expected_cvr", "expected_rpv"] as const;

/**
 * Returns a message per invalid field, or an empty object when the draft is
 * good. Blank required fields and malformed numbers are reported separately
 * so the user sees the specific reason, not a generic "invalid".
 */
export function categoryErrors(draft: CategoryDraft): Partial<Record<keyof CategoryDraft, string>> {
  const errors: Partial<Record<keyof CategoryDraft, string>> = {};

  for (const field of CATEGORY_NUMERIC) {
    const value = (draft[field] ?? "").trim();
    if (value && !DECIMAL_RE.test(value)) errors[field] = NUMERIC_MESSAGE;
  }

  for (const field of CATEGORY_REQUIRED) {
    if (errors[field]) continue;
    if (!(draft[field] ?? "").trim()) {
      errors[field] = `${CATEGORY_FIELD_LABEL[field]} is required before this row can be locked.`;
    }
  }

  return errors;
}

/** True when the draft can be saved as a draft (numbers valid; blanks fine). */
export function draftIsSavable(draft: CategoryDraft): boolean {
  return CATEGORY_NUMERIC.every((f) => {
    const v = (draft[f] ?? "").trim();
    return !v || DECIMAL_RE.test(v);
  });
}

/** True when every mandatory field is present and valid. */
export function draftIsLockable(draft: CategoryDraft): boolean {
  return Object.keys(categoryErrors(draft)).length === 0;
}

/** Seeds a draft from one campaign row. Never reads from any other row. */
export function draftFromCampaign(c: Campaign): CategoryDraft {
  return {
    sub_category: c.sub_category ?? "",
    brand: c.brand ?? "",
    offer: c.offer ?? "",
    brief: c.brief ?? "",
    landing: c.landing ?? "",
    expected_cvr: c.expected_cvr ?? "",
    expected_rpv: c.expected_rpv ?? "",
    additional_notes: c.additional_notes ?? "",
    date_time_brief: c.date_time_brief ?? "",
  };
}

/** The patch to send to Supabase. Trimmed; blanks stored as null. */
export function draftToPatch(draft: CategoryDraft): Partial<Campaign> {
  const clean = (v: string) => {
    const t = (v ?? "").trim();
    return t === "" ? null : t;
  };
  return {
    sub_category: clean(draft.sub_category),
    brand: clean(draft.brand),
    offer: clean(draft.offer),
    brief: clean(draft.brief),
    landing: clean(draft.landing),
    expected_cvr: clean(draft.expected_cvr),
    expected_rpv: clean(draft.expected_rpv),
    additional_notes: clean(draft.additional_notes),
    date_time_brief: clean(draft.date_time_brief),
  } as Partial<Campaign>;
}

/** Whether a stored row already satisfies every mandatory field. */
export function isCategoryComplete(c: Campaign): boolean {
  return draftIsLockable(draftFromCampaign(c));
}

/* ---------- Date / Time Brief ---------- */

/** The value shape an <input type="datetime-local"> produces. */
export const DATETIME_LOCAL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export const isDateTimeLocal = (v: string) => DATETIME_LOCAL_RE.test((v ?? "").trim());

/**
 * Rows created before this iteration may hold free text here ("Brand
 * requested evening placement"). The picker can't display that, so it is
 * surfaced beside the picker instead of being silently discarded.
 */
export function legacyDateTimeNote(v: string): string | null {
  const t = (v ?? "").trim();
  return t && !isDateTimeLocal(t) ? t : null;
}
