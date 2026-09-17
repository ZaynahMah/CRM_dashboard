"use client";

import { useCallback, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import { log, notify } from "@/services/campaigns";
import { profileSheet } from "@/lib/sheetProfile";
import { resolveColumns, pick, type FieldKey } from "@/lib/columnMatch";
import { excelValueToIsoDate, excelValueToTime } from "@/lib/excelDates";
import { fmtDate, fmtTime } from "@/lib/format";
import { Button, Card, Pill } from "./ui";
import { Icon } from "./icons";

interface ParsedRow { day: string; time: string; slot: string; segment: string; category: string }

/**
 * Supabase/PostgREST errors (PostgrestError) are plain objects — they are
 * NOT instances of the native Error class. Code that does
 * `e instanceof Error ? e.message : "generic fallback"` silently discards
 * every real database error and shows the fallback instead, which is
 * exactly what was happening here: a real, diagnosable Postgres error
 * (a constraint violation, an RLS denial, a bad value) was being replaced
 * with a bare "Upload failed." This function extracts the real message
 * from whatever shape the error actually is.
 */
function extractErrorMessage(e: unknown): string {
  if (e && typeof e === "object") {
    const err = e as { message?: string; details?: string; hint?: string; code?: string };
    const parts = [err.message, err.details, err.hint].filter(Boolean);
    if (parts.length) return `${parts.join(" — ")}${err.code ? ` (code ${err.code})` : ""}`;
  }
  if (e instanceof Error) return e.message;
  return typeof e === "string" ? e : "An unknown error occurred.";
}

/**
 * Reads a real workbook using the same header-row-detection engine as the
 * Performance module (lib/sheetProfile.ts) — finds the real header row even
 * if it's not row 1, and matches Day/Time/Slot/Segment/Category columns by
 * meaning rather than exact text, using lib/columnMatch.ts.
 */
function parseCrmInputFile(buffer: ArrayBuffer): { rows: ParsedRow[]; headers: string[]; warnings: string[] } {
  const wb = XLSX.read(buffer, { type: "array" });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const { headers, rows } = profileSheet(ws);
  const warnings: string[] = [];

  if (rows.length === 0) {
    return { rows: [], headers, warnings: ["Could not find a real header row with data beneath it in this file."] };
  }

  const fields: FieldKey[] = ["day", "time", "slot", "segment", "category"];
  const map = resolveColumns(headers, fields);
  const missing: string[] = [];
  if (!map.day) missing.push("Day/Date");
  if (!map.segment) missing.push("Segment");
  if (!map.category) missing.push("Category");
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
      day: excelValueToIsoDate(pick(r, map, "day")) ?? "",
      time: excelValueToTime(pick(r, map, "time")) ?? "",
      slot: map.slot ? String(pick(r, map, "slot") ?? "").trim() : "",
      segment: String(pick(r, map, "segment") ?? "").trim(),
      category: String(pick(r, map, "category") ?? "").trim(),
    }))
    .filter((r) => r.day && r.time && r.segment && r.category);

  if (parsed.length === 0) {
    warnings.push("Found all the required columns, but no row had every value filled in.");
  }
  if (!map.slot) {
    warnings.push("No Slot column found — slot numbers were assigned automatically by row order within each Day + Time group.");
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

const BATCH_SIZE = 100;

interface SendResult { saved: number; failed: number; errors: string[] }

export function CrmInputUpload({ profileId, isCrmSelf = false, onDone }: {
  profileId: string; isCrmSelf?: boolean; onDone: () => void;
}) {
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<SendResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    setReading(true); setError(null); setResult(null); setParsed([]);
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
      setError(extractErrorMessage(e));
    } finally {
      setReading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }, []);

  /**
   * Persists every parsed row to Supabase. Uses upsert (not insert) keyed on
   * (launch_date, launch_time, slot_number) — see 10_slot_dedup.sql — so
   * re-running this on the same file, whether deliberately or as a retry
   * after a partial failure, updates existing rows instead of duplicating
   * them. Each batch is tried independently: one batch failing does not
   * stop the remaining batches, and the final result reports exactly how
   * many rows actually made it into the database and why any didn't —
   * never a bare "Upload failed" with no explanation.
   */
  const handleSend = async () => {
    setSending(true); setError(null); setResult(null);

    const campaigns = parsed.map((r) => ({
      campaign_name: `${r.segment} · ${r.category}`,
      campaign_origin: "CRM_PLANNED" as const,
      launch_date: r.day,
      launch_time: r.time,
      slot_number: parseInt(r.slot, 10) || null,
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

    const totalBatches = Math.ceil(campaigns.length / BATCH_SIZE);
    let saved = 0;
    const errors: string[] = [];

    for (let i = 0, batchNum = 0; i < campaigns.length; i += BATCH_SIZE, batchNum++) {
      setProgress({ done: batchNum, total: totalBatches });
      const batch = campaigns.slice(i, i + BATCH_SIZE);
      try {
        const { error: batchError } = await supabase
          .from("campaigns")
          .upsert(batch, { onConflict: "launch_date,launch_time,slot_number" });
        if (batchError) {
          errors.push(`Rows ${i + 1}-${i + batch.length}: ${extractErrorMessage(batchError)}`);
        } else {
          saved += batch.length;
        }
      } catch (e) {
        errors.push(`Rows ${i + 1}-${i + batch.length}: ${extractErrorMessage(e)}`);
      }
    }

    setProgress(null);
    const failed = campaigns.length - saved;
    setResult({ saved, failed, errors: [...new Set(errors)] });

    if (saved > 0) {
      await log(null, profileId,
        isCrmSelf ? "CRM_SELF_PN_UPLOAD" : "CRM_INPUT_UPLOAD",
        `${isCrmSelf ? "CRM Self PN file" : "CRM input file"} uploaded: ${saved} of ${campaigns.length} rows from ${fileName} saved.` +
        (isCrmSelf ? "" : " Sent to Category."));
      if (!isCrmSelf) {
        await notify("CATEGORY", "NEW_INPUT", "New campaign slots available",
          `${saved} new campaigns from ${fileName} are ready for your input.`);
      }
      onDone();
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
              : "Columns: Day, Time, Slot, Segment, Category. Header names are matched automatically — exact wording doesn't matter. Re-uploading the same file updates existing rows rather than duplicating them."}
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
            <span className="text-tiny text-muted">{parsed.length} rows · {dates.length} days ({fmtDate(dates[0])} to {fmtDate(dates[dates.length - 1])})</span>
          </div>

          <div className="max-h-[300px] overflow-auto rounded-lg border border-line">
            <table className="w-full">
              <thead><tr><th>Day</th><th>Time</th><th>Slot</th><th>Segment</th><th>Category</th></tr></thead>
              <tbody>
                {parsed.slice(0, 50).map((r, i) => (
                  <tr key={i}>
                    <td className="text-tiny font-medium">{fmtDate(r.day)}</td>
                    <td className="text-tiny text-muted">{fmtTime(r.time)}</td>
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

          {progress && (
            <div className="rounded-lg bg-[#F9FAFB] px-4 py-3">
              <div className="flex items-center justify-between text-tiny text-muted">
                <span>Saving batch {progress.done + 1} of {progress.total}...</span>
                <span>{Math.min((progress.done) * BATCH_SIZE, parsed.length)} / {parsed.length} sent so far</span>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line">
                <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
              </div>
            </div>
          )}

          {result ? (
            result.failed === 0 ? (
              <div className="flex items-center gap-2 rounded-lg bg-success-50 px-4 py-3 text-tiny text-success-700">
                {Icon.check(14)} {result.saved} of {parsed.length} campaigns saved{isCrmSelf ? "." : " and sent to Category Team."}
              </div>
            ) : (
              <div className="space-y-2 rounded-lg bg-danger-50 px-4 py-3 text-tiny text-danger-700">
                <div className="flex items-center gap-2 font-medium">
                  {Icon.alert(14)} {result.saved} of {parsed.length} records saved — {result.failed} failed.
                </div>
                <ul className="space-y-1 pl-5">
                  {result.errors.map((e, i) => <li key={i} className="list-disc">{e}</li>)}
                </ul>
                <Button size="sm" variant="danger" disabled={sending} onClick={handleSend}>
                  Retry — safe, won&rsquo;t duplicate the {result.saved} already saved
                </Button>
              </div>
            )
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
