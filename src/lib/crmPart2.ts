import type { Campaign } from "@/types/campaign";

/**
 * The four CRM Part 2 fields that must be filled before a PN can move
 * forward. ONE definition, used by the drawer, the Show All PN grid, the
 * bulk action and the service that changes the status — so the button, the
 * error text and the server can never disagree.
 *
 * Drafts are unaffected: saving is always allowed. Only moving a PN forward
 * is gated.
 */

export const PART2_FIELDS = [
  { key: "title_brief", label: "Title Brief" },
  { key: "message_brief", label: "Message Brief" },
  { key: "pn_template", label: "PN Template" },
  { key: "creative_requirements", label: "Creative Requirements" },
] as const;

/**
 * ITEM 2 — the SEND gate: all four above PLUS PN Type.
 *
 * Kept SEPARATE from PART2_FIELDS on purpose. `part2Complete` (bucket
 * membership, Pending vs Completed CRM Input) reads PART2_FIELDS, and all
 * 928 existing PNs have pn_type = NULL — folding PN Type into that list
 * would move every one of them backwards into Pending CRM Input, which you
 * ruled out. The send gate is only consulted when CRM actually sends, so
 * existing rows are untouched until someone tries to move one forward.
 */
export const SEND_FIELDS = [
  ...PART2_FIELDS,
  { key: "pn_type", label: "PN Type" },
] as const;

export type Part2Key = (typeof PART2_FIELDS)[number]["key"];

/**
 * "Select" is the dropdown's placeholder, so it does NOT count as filled.
 * Whitespace-only text is empty too.
 */
export function isPart2FieldFilled(value: unknown): boolean {
  const v = (value ?? "").toString().trim();
  if (v === "") return false;
  return v.toLowerCase() !== "select";
}

/** Which of the four are still missing, as display labels. */
export function missingPart2(c: Partial<Campaign>): string[] {
  return PART2_FIELDS
    .filter((f) => !isPart2FieldFilled(c[f.key as keyof Campaign]))
    .map((f) => f.label);
}

/** Which keys are missing, for per-field inline errors. */
export function missingPart2Keys(c: Partial<Campaign>): Part2Key[] {
  return PART2_FIELDS
    .filter((f) => !isPart2FieldFilled(c[f.key as keyof Campaign]))
    .map((f) => f.key);
}

/** All four filled. */
export const part2Ready = (c: Partial<Campaign>) => missingPart2(c).length === 0;

/** "Title Brief is required" — the inline message under an empty field. */
export const requiredMessage = (label: string) => `${label} is required`;

/** The tooltip on a disabled Send button. */
export function missingTooltip(c: Partial<Campaign>): string | undefined {
  const missing = missingToSend(c);
  if (missing.length === 0) return undefined;
  return `Still needed: ${missing.join(", ")}`;
}

/**
 * A PN that has ALREADY moved on is never re-validated. Existing rows sent
 * to Content, through QC or on the calendar keep working untouched — this
 * rule applies only to a PN about to be moved forward now.
 */
/**
 * ITEM 2 — PN Type is required only for a NEW send.
 *
 * Every one of the 928 existing PNs has pn_type = NULL. `alreadyMovedOn`
 * already grandfathers anything sent, submitted, QC-passed or on the
 * calendar, so none of them is re-validated or moved back: `part2Complete`
 * (which decides Pending vs Completed CRM Input) is only consulted for PNs
 * that have NOT yet gone to Content.
 */
export const alreadyMovedOn = (c: Partial<Campaign>) =>
  c.crm_status === "SENT_TO_CONTENT"
  || c.content_status === "SUBMITTED"
  || c.qc_status === "PASSED"
  || c.calendar_status === "UPDATED";

/** The gate used before a status change. Grandfathers anything already moved. */
/** Which SEND fields are missing — the four plus PN Type. */
export function missingToSend(c: Partial<Campaign>): string[] {
  return SEND_FIELDS
    .filter((f) => !isPart2FieldFilled(c[f.key as keyof Campaign]))
    .map((f) => f.label);
}

export const sendReady = (c: Partial<Campaign>) => missingToSend(c).length === 0;

/**
 * The gate before a status change. A PN that has already moved on is never
 * re-validated, so the 928 existing null-PN-Type rows keep flowing.
 */
export const canMoveForward = (c: Partial<Campaign>) =>
  alreadyMovedOn(c) || sendReady(c);
