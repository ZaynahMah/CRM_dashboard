"use client";

import { useCallback, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import { log } from "@/services/campaigns";
import { Button, Card, Pill } from "./ui";
import { Icon } from "./icons";

interface ParsedRow { day: string; time: string; segment: string; category: string }

/** Case/whitespace-tolerant column lookup, same convention as the Performance upload parser. */
function col(row: Record<string, unknown>, name: string): unknown {
  const target = name.trim().toLowerCase();
  const key = Object.keys(row).find((k) => k.trim().toLowerCase() === target);
  return key ? row[key] : null;
}
function str(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
}

/**
 * Reads a real .xlsx/.xls workbook (first sheet, or a sheet literally named
 * "Sep Input" / "September" / "Input" if present) and maps Day / Time Slot /
 * Segment / Category columns by exact header name, case-insensitive.
 * Also accepts a plain .csv as a fallback.
 */
function parseWorkbookFile(buffer: ArrayBuffer, filename: string): ParsedRow[] {
  const isCsv = /\.csv$/i.test(filename);
  const wb = XLSX.read(buffer, { type: "array", raw: false });

  const preferredNames = ["sep input", "september", "input", "sheet1"];
  const sheetName =
    wb.SheetNames.find((n) => preferredNames.includes(n.trim().toLowerCase())) ?? wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws) return [];

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null, raw: true });

  return rows
    .map((r) => ({
      day: str(col(r, "Day")),
      time: str(col(r, "Time Slot")) || str(col(r, "Time")),
      segment: str(col(r, "Segment") ?? col(r, "Segments")),
      category: str(col(r, "Category") ?? col(r, "Categories")),
    }))
    .filter((r) => r.day && r.time && r.segment && r.category);
}

function normalizeDate(raw: string): string {
  const d = new Date(raw);
  if (!isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  const parts = raw.split(/[\s-/]+/);
  const months: Record<string, number> = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
  if (parts.length >= 2) {
    const day = parseInt(parts[0]);
    const mon = months[parts[1].toLowerCase().slice(0, 3)];
    const year = parts[2] ? parseInt(parts[2]) : new Date().getFullYear();
    if (day && mon) return `${year}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  return raw;
}

function normalizeTime(raw: string): string {
  const clean = raw.toUpperCase().trim();
  const match = clean.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/);
  if (!match) return raw;
  let h = parseInt(match[1]);
  const m = match[2];
  const ampm = match[3];
  if (ampm === "PM" && h < 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${m}`;
}

export function ExcelUpload({ profileId, onDone }: { profileId: string; onDone: () => void }) {
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    setReading(true); setError(null); setSent(false); setParsed([]);
    setFileName(file.name);
    try {
      const buffer = await file.arrayBuffer();
      const rows = parseWorkbookFile(buffer, file.name);
      if (rows.length === 0) {
        setError('No usable rows found. Check the sheet has "Day", "Time Slot", "Segment" and "Category" columns with those exact headers.');
      } else {
        setParsed(rows);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read this file. Is it a valid .xlsx/.xls/.csv?");
    } finally {
      setReading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }, []);

  const handleSend = async () => {
    setSending(true);
    try {
      const campaigns = parsed.map((r) => ({
        campaign_name: `${r.segment} · ${r.category}`,
        campaign_origin: "CRM_PLANNED" as const,
        launch_date: normalizeDate(r.day),
        launch_time: normalizeTime(r.time),
        pncc_segment_label: r.segment,
        pncc_category_code: r.category,
        category: r.category,
        slot_type: "STANDARD",
        category_status: "EMPTY" as const,
        crm_status: "AWAITING_REVIEW" as const,
        content_status: "NOT_ASSIGNED" as const,
        qc_status: "PENDING" as const,
        production_status: "NOT_READY" as const,
        priority: "NORMAL" as const,
        created_by: profileId,
      }));

      for (let i = 0; i < campaigns.length; i += 100) {
        const { error: insertError } = await supabase.from("campaigns").insert(campaigns.slice(i, i + 100));
        if (insertError) throw insertError;
      }

      await log(null, profileId, "EXCEL_UPLOAD", `Uploaded ${campaigns.length} campaigns from ${fileName} and sent to Category.`);
      setSent(true);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    }
    setSending(false);
  };

  const dates = [...new Set(parsed.map((r) => r.day))];

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="font-display text-[15px] font-600 text-heading">Upload September Excel</h3>
          <p className="mt-0.5 text-micro text-faint">
            .xlsx, .xls or .csv with columns: Day, Time Slot, Segment, Category (7 days at a time)
          </p>
        </div>

        {/* Plain text/icon inside the label, not a nested <button> — a real <button>
            nested in a <label> breaks native label-click-forwards-to-input behavior
            in most browsers, since <button> is itself a labelable element. */}
        <label className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface px-4 py-2.5 text-[13px] font-medium text-body transition-colors hover:bg-[#F9FAFB] ${reading ? "pointer-events-none opacity-60" : ""}`}>
          {reading ? "Reading file..." : <>{Icon.chart(13)} Choose file</>}
          <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" disabled={reading}
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
        </label>
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg bg-danger-50 px-4 py-3 text-tiny text-danger-700">
          {Icon.alert(14)} <span>{error}</span>
        </div>
      )}

      {parsed.length > 0 && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Pill dot={false} label={fileName} tone="indigo" />
            <span className="text-tiny text-muted">{parsed.length} rows · {dates.length} days ({dates[0]} to {dates[dates.length - 1]})</span>
          </div>

          <div className="max-h-[300px] overflow-auto rounded-lg border border-line">
            <table className="w-full">
              <thead><tr><th>Day</th><th>Time</th><th>Segment</th><th>Category</th></tr></thead>
              <tbody>
                {parsed.slice(0, 50).map((r, i) => (
                  <tr key={i}>
                    <td className="text-tiny font-medium">{r.day}</td>
                    <td className="text-tiny text-muted">{r.time}</td>
                    <td><Pill dot={false} label={r.segment} tone="indigo" /></td>
                    <td><Pill dot={false} label={r.category} tone="neutral" /></td>
                  </tr>
                ))}
                {parsed.length > 50 && (
                  <tr><td colSpan={4} className="text-center text-micro text-faint">+{parsed.length - 50} more rows</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {sent ? (
            <div className="flex items-center gap-2 rounded-lg bg-success-50 px-4 py-3 text-tiny text-success-700">
              {Icon.check(14)} {parsed.length} campaigns uploaded and sent to Category Team.
            </div>
          ) : (
            <Button onClick={handleSend} disabled={sending}>
              {sending ? "Sending..." : `Send ${parsed.length} campaigns to Category Team`}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
