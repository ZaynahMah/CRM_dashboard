import * as XLSX from "xlsx";

/**
 * The one correct way to read an Excel date/time cell in this app.
 *
 * The bug this fixes: converting an Excel date via a JS `Date` object and
 * then `.toISOString()` (or reading local getters off a UTC-constructed
 * date) silently shifts the value by a day or drops to the 1899-12-30 Excel
 * epoch whenever the browser's timezone doesn't line up with how the cell
 * was constructed — which is exactly the "01-Jul -> 2026-06-30" and
 * "7:30 AM -> 1899-12-30" symptoms. The fix is to never round-trip through
 * a `Date` object at all: read the raw numeric serial and decode it with
 * SheetJS's own date-code parser, which does pure integer Y/M/D/H/M/S math
 * with no timezone involved anywhere.
 */

interface DateCode { y: number; m: number; d: number; H: number; M: number; S: number }

function parseSerial(v: number): DateCode | null {
  const code = XLSX.SSF.parse_date_code(v);
  if (!code) return null;
  return { y: code.y, m: code.m, d: code.d, H: code.H ?? 0, M: code.M ?? 0, S: code.S ?? 0 };
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** Converts any Date/Day cell value to an ISO "YYYY-MM-DD" string. Never touches a JS Date object. */
export function excelValueToIsoDate(v: unknown, assumedYear?: number): string | null {
  if (v == null || v === "") return null;

  // A numeric Excel serial — the exact case that was breaking. Decoded with
  // pure integer math, no Date object, no timezone.
  if (typeof v === "number") {
    const code = parseSerial(v);
    if (!code || code.y < 1900) return null; // guards against a pure time-fraction (epoch 1899-12-30) leaking in as a "date"
    return `${code.y}-${String(code.m).padStart(2, "0")}-${String(code.d).padStart(2, "0")}`;
  }

  // If SheetJS already handed back a Date object (cellDates:true upstream),
  // read UTC getters only — SheetJS constructs date-only cells at UTC
  // midnight, and reading local getters is exactly what shifts the day in
  // timezones behind UTC.
  if (v instanceof Date) {
    if (v.getUTCFullYear() < 1900) return null;
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, "0")}-${String(v.getUTCDate()).padStart(2, "0")}`;
  }

  const raw = String(v).trim();
  if (!raw) return null;

  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;

  // "01-Jul", "01-Jul-2026", "1 Jul", "Jul 1 2026" — parsed by scanning
  // tokens rather than assuming a fixed order.
  const parts = raw.split(/[\s,/-]+/).filter(Boolean);
  let day: number | null = null;
  let month: number | null = null;
  let year = assumedYear ?? new Date().getFullYear();
  for (const p of parts) {
    const asMonth = MONTHS[p.toLowerCase().slice(0, 3)];
    const asNum = parseInt(p, 10);
    if (asMonth) month = asMonth;
    else if (!isNaN(asNum) && asNum > 31) year = asNum > 999 ? asNum : 2000 + asNum;
    else if (!isNaN(asNum) && day === null) day = asNum;
  }
  if (day && month) return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return null;
}

/** Converts any Time/Time Slot cell value to "HH:MM" 24-hour. Never touches a JS Date object. */
export function excelValueToTime(v: unknown): string | null {
  if (v == null || v === "") return null;

  if (typeof v === "number") {
    const code = parseSerial(v);
    if (!code) return null;
    return `${String(code.H).padStart(2, "0")}:${String(code.M).padStart(2, "0")}`;
  }

  if (v instanceof Date) {
    return `${String(v.getUTCHours()).padStart(2, "0")}:${String(v.getUTCMinutes()).padStart(2, "0")}`;
  }

  const clean = String(v).toUpperCase().trim();
  const match = clean.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/);
  if (!match) return null;
  let h = parseInt(match[1], 10);
  const m = match[2];
  const ampm = match[3];
  if (ampm === "PM" && h < 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${m}`;
}
