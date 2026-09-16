"use client";

import { useCallback, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import { log, notify } from "@/services/campaigns";
import { profileSheet } from "@/lib/sheetProfile";
import { resolveColumns, pick, normalizeMonthValue, inferDimensionColumn, type FieldKey } from "@/lib/columnMatch";
import { Button, Card, Pill } from "./ui";
import { Icon } from "./icons";

interface ParsedRow { day: string; time: string; slot: string; segment: string; category: string }

function str(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
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
  if (!match) return raw || "00:00";
  let h = parseInt(match[1]);
  const m = match[2];
  const ampm = match[3];
  if (ampm === "PM" && h < 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${m}`;
}

/**
 * Reads a real workbook using the same header-row-detection engine as the
 * Performance module (lib/sheetProfile.ts) — finds the real header row even
 * if it's not row 1, and matches Day/Time/Slot/Segment/Category columns by
 * meaning rather than exact text, using lib/columnMatch.ts.
 */
function parseCrmInputFile(buffer: ArrayBuffer): { rows: ParsedRow[]; headers: string[]; warnings: string[] } {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const { headers, rows } = profileSheet(ws);
  const warnings: string[] = [];

  if (rows.length === 0) {
    return { rows: [], headers, warnings: ["Could not find a real header row with data beneath it in this file."] };
  }

  const fields: FieldKey[] = ["day", "time", "slot", "segment", "category"];
  let map = resolveColumns(headers, fields);
  const missing: string[] = [];
  if (!map.day) missing.push("Day/Date");
  if (!map.segment) missing.push("Segment");
  if (!map.category) missing.push("Category");

  // Slot and Time are recoverable if missing — Slot can be inferred as row
  // order within the same day+time group; Time is genuinely required.
  if (!map.time) missing.push("Time");

  if (missing.length > 0) {
    warnings.push(
      `Couldn't find a ${missing.join(", ")}-like column among [${headers.join(", ")}]. ` +
      `Rename the header(s) to something recognizable or tell me the actual names and I'll map them directly.`
    );
    return { rows: [], headers, warnings };
  }

  const parsed = rows
    .map((r) => ({
      day: str(pick(r, map, "day")),
      time: str(pick(r, map, "time")),
      slot: map.slot ? str(pick(r, map, "slot")) : "",
      segment: str(pick(r, map, "segment")),
      category: str(pick(r, map, "category")),
    }))
    .filter((r) => r.day && r.time && r.segment && r.category);

  if (parsed.length === 0) {
    warnings.push("Found all the required columns, but no row had every value filled in.");
  }
  if (!map.slot) {
    warnings.push('No Slot column found — slot numbers were assigned automatically by row order within each Day + Time group.');
  }

  return { rows: parsed, headers, warnings };
}

/** Assigns sequential slot numbers within each Day+Time group when the file has no Slot column. */
function assignSlotsIfMissing(rows: ParsedRow[]): ParsedRow[] {
  const counters = new Map<string, number>();
  return rows.map((r) => {
    if (r.slot) return r;
    const key = `${r.day}|${r.time}`;
    const n = (counters.get(key) ?? 0) + 1;
    counters.set(key, n);
    return { ...r, slot: String(n) };
  });
}

export function CrmInputUpload({ profileId, isCrmSelf = false, onDone }: {
  profileId: string; isCrmSelf?: boolean; onDone: () => void;
}) {
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
      const { rows, warnings } = parseCrmInputFile(buffer);
      if (rows.length === 0) {
        setError(warnings.join(" ") || "No usable rows found in this file.");
      } else {
        setParsed(assignSlotsIfMissing(rows));
        if (warnings.length) setError(warnings.join(" "));
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
        is_crm_self: isCrmSelf,
        category_status: isCrmSelf ? "LOCKED" : "EMPTY",
        crm_status: isCrmSelf ? "IN_PLANNING" : "AWAITING_REVIEW",
        content_status: "NOT_ASSIGNED" as const,
        design_status: "NOT_ASSIGNED",
        qc_status: "PENDING" as const,
        production_status: "NOT_READY" as const,
        priority: "NORMAL" as const,
        created_by: profileId,
      }));

      for (let i = 0; i < campaigns.length; i += 100) {
        const { error: insertError } = await supabase.from("campaigns").insert(campaigns.slice(i, i + 100));
        if (insertError) throw insertError;
      }

      await log(null, profileId,
        isCrmSelf ? "CRM_SELF_PN_UPLOAD" : "CRM_INPUT_UPLOAD",
        `${isCrmSelf ? "CRM Self PN file" : "CRM input file"} uploaded: ${campaigns.length} rows from ${fileName}.` +
        (isCrmSelf ? "" : " Sent to Category."));

      if (!isCrmSelf) {
        await notify("CATEGORY", "NEW_INPUT", "New campaign slots available",
          `${campaigns.length} new campaigns from ${fileName} are ready for your input.`);
      }

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
          <h3 className="font-display text-[15px] font-600 text-heading">
            {isCrmSelf ? "Upload CRM Self PNs" : "Upload CRM Input"}
          </h3>
          <p className="mt-0.5 text-micro text-faint">
            {isCrmSelf
              ? "Campaigns CRM owns end-to-end — no Category input needed. Same columns: Day, Time, Slot, Segment, Category."
              : "Columns: Day, Time, Slot, Segment, Category. Header names are matched automatically — exact wording doesn't matter."}
          </p>
        </div>

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
              <thead><tr><th>Day</th><th>Time</th><th>Slot</th><th>Segment</th><th>Category</th></tr></thead>
              <tbody>
                {parsed.slice(0, 50).map((r, i) => (
                  <tr key={i}>
                    <td className="text-tiny font-medium">{r.day}</td>
                    <td className="text-tiny text-muted">{r.time}</td>
                    <td className="text-tiny text-muted">{r.slot}</td>
                    <td><Pill dot={false} label={r.segment} tone="indigo" /></td>
                    <td><Pill dot={false} label={r.category} tone="neutral" /></td>
                  </tr>
                ))}
                {parsed.length > 50 && (
                  <tr><td colSpan={5} className="text-center text-micro text-faint">+{parsed.length - 50} more rows</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {sent ? (
            <div className="flex items-center gap-2 rounded-lg bg-success-50 px-4 py-3 text-tiny text-success-700">
              {Icon.check(14)} {parsed.length} campaigns uploaded{isCrmSelf ? "." : " and sent to Category Team."}
            </div>
          ) : (
            <Button onClick={handleSend} disabled={sending}>
              {sending ? "Sending..." : isCrmSelf ? `Save ${parsed.length} CRM Self PNs` : `Send ${parsed.length} campaigns to Category Team`}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
