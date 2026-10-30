/**
 * PN Template and PN Type options.
 *
 * ONE definition each, so the grid, the drawer, imports, exports, the
 * server check and the tests cannot drift.
 */

/**
 * PN Template, replacing the old list (Basic / Bezel / Timer / Coloured BG).
 * "Select" is the empty placeholder, never a stored value — it counts as
 * empty for the mandatory Part 2 rule, which is unchanged.
 */
export const PN_TEMPLATES = [
  "Basic",
  "Bezel",
  "Timer",
  "Background Coloured",
  "Title Coloured",
  "Carousel",
  "Video",
  "Multi CTA",
  "Icons",
  "Rating",
] as const;

export type PnTemplate = (typeof PN_TEMPLATES)[number];

/**
 * Values that existed before this list and may still be stored.
 *
 * They are shown AS-IS with a "not in list" hint, never rewritten: a PN
 * already through QC or on the calendar must not have its template silently
 * changed. "Coloured BG" is deliberately NOT auto-mapped — only CRM can
 * decide whether it meant Background Coloured or Title Coloured.
 */
export const LEGACY_PN_TEMPLATES = ["Coloured BG"] as const;

/** Is a stored template outside the current list? */
export const isLegacyTemplate = (v: string | null | undefined) => {
  const s = (v ?? "").trim();
  if (!s) return false;
  return !(PN_TEMPLATES as readonly string[]).includes(s);
};

/**
 * PN Type — Content's fifth input. Exactly two values.
 * NULL is allowed: PNs that pre-date this field show "—".
 */
export const PN_TYPES = ["SALE", "BAU"] as const;
export type PnType = (typeof PN_TYPES)[number];

export const isValidPnType = (v: string | null | undefined) =>
  (PN_TYPES as readonly string[]).includes((v ?? "").trim());
