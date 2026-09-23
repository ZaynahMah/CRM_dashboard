"use client";

import { useCallback, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import { log, notify } from "@/services/campaigns";
import { profileSheet } from "@/lib/sheetProfile";
import { resolveColumns, pick, type FieldKey } from "@/lib/columnMatch";
import { excelValueToIsoDate, excelValueToTime } from "@/lib/excelDates";
import { fmtDate, fmtTime } from "@/lib/format";
import { Button, Card, Modal, Pill } from "./ui";
import { Icon } from "./icons";

interface ParsedRow { day: string; time: string; slot: string; segment: string; category: string }

/**
 * Supabase/PostgREST errors (PostgrestError) are plain objects — not
 * instances of the native Error class — so `e instanceof Error` always
 * failed for a real database error. This extracts the real message
 * regardless of shape.
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
interface ReplacePreview { dates: string[]; totalToDelete: number; alreadyTouched: number }

export function CrmInputUpload({ profileId, isCrmSelf = false, onDone }: {
  profileId: string; isCrmSelf?: boolean; onDone: () => void;
}) {
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [checkingReplace, setCheckingReplace] = useState(false);
  const [replacePreview, setReplacePreview] = useState<ReplacePreview | null>(null);
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

  const dates = [...new Set(parsed.map((r) => r.day))];

  /**
   * Re-uploading a set of dates means "this sheet is now the truth for
   * those dates" — it replaces whatever's currently there, except anything
   * that's already reached the calendar (calendar_status = 'UPDATED'),
   * which is protected. This shows exactly what that will remove before
   * anything happens — not a gate that blocks it, just a confirm step.
   */
  const handleReviewReplace = async () => {
    setCheckingReplace(true); setError(null);
    try {
      const { data, error: qErr } = await supabase
        .from("campaigns")
        .select("category_status")
        .in("launch_date", dates)
        .eq("calendar_status", "NOT_UPDATED");
      if (qErr) throw qErr;
      const rows = data ?? [];
      setReplacePreview({
        dates,
        totalToDelete: rows.length,
        alreadyTouched: rows.filter((r) => r.category_status !== "EMPTY").length,
      });
    } catch (e) {
      setError(extractErrorMessage(e));
    }
    setCheckingReplace(false);
  };

  /** Deletes the rows just previewed, then inserts every parsed row fresh. */
  const handleConfirmReplace = async () => {
    setReplacePreview(null);
    setSending(true); setError(null); setResult(null);

    try {
      const { error: delErr } = await supabase
        .from("campaigns")
        .delete()
        .in("launch_date", dates)
        .eq("calendar_status", "NOT_UPDATED");
      if (delErr) throw delErr;
    } catch (e) {
      setError(`Could not clear existing rows for these dates: ${extractErrorMessage(e)}`);
      setSending(false);
      return;
    }

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
        const { error: batchError } = await supabase.from("campaigns").insert(batch);
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
              : "Columns: Day, Time, Slot, Segment, Category. Multiple PNs can share a slot — that's normal. Re-uploading a date replaces what's there for that date, except anything already on the calendar."}
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
              </div>
            )
          ) : (
            <Button onClick={handleReviewReplace} disabled={sending || checkingReplace}>
              {checkingReplace ? "Checking..." : isCrmSelf ? `Save ${parsed.length} CRM Self PNs` : `Send ${parsed.length} campaigns to Category Team`}
            </Button>
          )}
        </div>
      )}

      <Modal open={!!replacePreview} onClose={() => setReplacePreview(null)} title="This will replace existing data">
        {replacePreview && (
          <div className="space-y-4">
            <p className="text-tiny text-body">
              This file covers <span className="font-medium text-heading">{replacePreview.dates.length} date{replacePreview.dates.length === 1 ? "" : "s"}</span>:{" "}
              {replacePreview.dates.slice(0, 8).map(fmtDate).join(", ")}{replacePreview.dates.length > 8 ? `, +${replacePreview.dates.length - 8} more` : ""}.
            </p>
            <div className="rounded-lg bg-warning-50 px-4 py-3 text-tiny text-warning-700">
              <span className="font-medium">{replacePreview.totalToDelete}</span> existing row{replacePreview.totalToDelete === 1 ? "" : "s"} for these dates will be deleted and replaced with this file's {parsed.length} rows.
              {replacePreview.alreadyTouched > 0 && (
                <> Of those, <span className="font-medium">{replacePreview.alreadyTouched}</span> already have work started (Category, CRM, Content, or Design past the empty state) — that work will be lost.</>
              )}
            </div>
            <p className="text-micro text-faint">
              Anything already added to the calendar for these dates is not affected and will not be deleted.
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="ghost" onClick={() => setReplacePreview(null)}>Cancel</Button>
              <Button variant="danger" onClick={handleConfirmReplace}>
                Replace {replacePreview.totalToDelete} row{replacePreview.totalToDelete === 1 ? "" : "s"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </Card>
  );
}
