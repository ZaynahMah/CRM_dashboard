const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

export function toDate(value: string): Date {
  // Dates arrive as YYYY-MM-DD. Parse as local, not UTC, so the board never
  // shifts a day for users east or west of the server.
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export const today = () => {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
};

export const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const fmtDate = (v: string) => {
  const d = toDate(v);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
};

export const fmtLongDate = (v: string) => {
  const d = toDate(v);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};

export const fmtMonth = (d: Date) => `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

/** 19:30:00 -> 7:30 PM */
export function fmtTime(v: string | null): string {
  if (!v) return "—";
  const [hh, mm] = v.split(":").map(Number);
  const suffix = hh >= 12 ? "PM" : "AM";
  const h = hh % 12 === 0 ? 12 : hh % 12;
  return `${h}:${String(mm).padStart(2, "0")} ${suffix}`;
}

export const daysBetween = (from: Date, to: Date) =>
  Math.round((to.getTime() - from.getTime()) / 86_400_000);

export function fmtRelative(iso: string): string {
  const d = new Date(iso);
  const diff = Math.round((Date.now() - d.getTime()) / 60_000);
  if (diff < 1) return "just now";
  if (diff < 60) return `${diff}m ago`;
  if (diff < 1440) return `${Math.round(diff / 60)}h ago`;
  return `${fmtDate(isoDate(d))} · ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export const titleCase = (v: string) =>
  v.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/* ---------- weeks ---------- */

/**
 * Monday-start week key for a launch date, as YYYY-MM-DD of that Monday.
 * Category works to a weekly rhythm — rows are filled across the week and
 * submitted as a batch — so the week, not the month, is the unit the
 * dashboard groups by.
 */
export function weekStart(value: string): string {
  const d = toDate(value);
  const dow = (d.getDay() + 6) % 7; // Mon = 0
  d.setDate(d.getDate() - dow);
  return isoDate(d);
}

/** "6 Oct – 12 Oct" */
export function fmtWeekRange(mondayIso: string): string {
  const start = toDate(mondayIso);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return `${fmtDate(mondayIso)} – ${fmtDate(isoDate(end))}`;
}

/** Relative label for a week: This week / Next week / Last week / date range. */
export function weekLabel(mondayIso: string): string {
  const thisMonday = weekStart(isoDate(today()));
  const diff = Math.round(daysBetween(toDate(thisMonday), toDate(mondayIso)) / 7);
  if (diff === 0) return "This week";
  if (diff === 1) return "Next week";
  if (diff === -1) return "Last week";
  return fmtWeekRange(mondayIso);
}

/**
 * The Slot to SHOW: the raw uploaded label, falling back to the parsed
 * number only for rows saved before slot_label existed.
 *
 * Never shows slot_type — that is a different field (STANDARD/ADDITIONAL),
 * and showing it in a "Slot" column is the bug this replaces.
 */
export const slotDisplay = (
  c: { slot_label?: string | null; slot_number?: number | null }
): string => {
  const raw = (c.slot_label ?? "").trim();
  if (raw) return raw;
  return c.slot_number !== null && c.slot_number !== undefined
    ? String(c.slot_number) : "—";
};
