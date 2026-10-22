import {
  CAMPAIGN_TYPE_PN, CAMPAIGN_NAME_PRP, CHANNEL_NAME_PUSH, CHANNEL_FORMATS,
  LANDING_VALUES,
} from "./trackingMasters";

/**
 * How CRM ENTERS each tracking field. One definition, used by both the
 * drawer (Solo PN) and the Show All PN workspace, so the two cannot drift
 * into different controls again.
 *
 * This changes INPUT METHOD only. The tracking-code composition, its field
 * order and its separators are untouched: `trackingCode.ts` still builds
 * the same 14-position `cid=` string from the same columns.
 */

export type TrackingInput =
  /** Fixed value, displayed read-only. CRM never types or picks it. */
  | { kind: "fixed"; value: string }
  /** A short list that is genuinely closed. */
  | { kind: "select"; options: readonly string[] }
  /** Free text: CRM types any value, used verbatim. */
  | { kind: "text" };

/**
 * PN-only workflow, so these three are constants rather than choices.
 * They still flow into the generator exactly as before.
 */
export const FIXED_TRACKING_VALUES = {
  campaign_type: CAMPAIGN_TYPE_PN,   // "pn"
  campaign_name_code: CAMPAIGN_NAME_PRP, // "prp"
  channel_name: CHANNEL_NAME_PUSH,   // "push"
} as const;

export const TRACKING_INPUTS: Record<string, TrackingInput> = {
  campaign_type:        { kind: "fixed", value: FIXED_TRACKING_VALUES.campaign_type },
  campaign_name_code:   { kind: "fixed", value: FIXED_TRACKING_VALUES.campaign_name_code },
  channel_name:         { kind: "fixed", value: FIXED_TRACKING_VALUES.channel_name },

  // Still a real binary choice, and the generator depends on it.
  channel_format:       { kind: "select", options: CHANNEL_FORMATS },
  tracking_landing:     { kind: "select", options: LANDING_VALUES },

  // Free text: the lookup lists were rejecting valid values CRM needs.
  // Whatever is typed is used verbatim — never replaced by a lookup.
  segment_1:            { kind: "text" },
  segment_2:            { kind: "text" },
  tracking_category:    { kind: "text" },
  tracking_sub_category:{ kind: "text" },
  tracking_offer:       { kind: "text" },
  keywords:             { kind: "text" },
};

export const isFixed = (key: string) => TRACKING_INPUTS[key]?.kind === "fixed";
export const isFreeText = (key: string) => TRACKING_INPUTS[key]?.kind === "text";
