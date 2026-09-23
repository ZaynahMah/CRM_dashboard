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
