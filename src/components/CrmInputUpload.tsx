"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import { log, notify } from "@/services/campaigns";
import { BATCH_UPLOAD_ENABLED } from "@/lib/featureFlags";
import {
  addUploadBatch, fileSha256, previousUploadOfFile, previewByDay,
  resetLastUploadPreview, resetLastUpload, sha256Of,
  type DayPreview, type UploadBatchPreview,
} from "@/services/uploadBatch";
import { rememberedName, rememberName } from "@/services/sendBack";
import { downloadCSV } from "@/services/exportExcel";
import type { Campaign } from "@/types/campaign";
import { profileSheet } from "@/lib/sheetProfile";
import { resolveColumns, pick, type FieldKey } from "@/lib/columnMatch";
import { excelValueToIsoDate, excelValueToTime } from "@/lib/excelDates";
import { fmtDate, fmtTime } from "@/lib/format";
import { Button, Card, Modal, Pill } from "./ui";
import { useSession } from "./SessionProvider";
import { Icon } from "./icons";

interface ParsedRow {
  day: string; time: string; slot: string; segment: string; category: string;
  /** CRM Self sheet only — blank for the standard CRM input sheet. */
  sub_category?: string; brand?: string; offer?: string;
  title_brief?: string; message_brief?: string;
  pn_template?: string; creative_requirements?: string;
}

/** Reads an optional column as trimmed text, or undefined when absent. */
function text(
  row: Record<string, unknown>,
  map: Partial<Record<FieldKey, string>>,
  field: FieldKey
): string | undefined {
  if (!map[field]) return undefined;
  const v = String(pick(row, map, field) ?? "").trim();
  return v === "" ? undefined : v;
}

/**
 * Supabase/PostgREST errors (PostgrestError) are plain objects — not
 * instances of the native Error class — so `e instanceof Error` always
 * failed for a real database error. This extracts the real message
 * regardless of shape.
 */
/**
 * True when the failure is a missing function or column rather than a real
 * problem with the data — i.e. a migration has not been applied yet.
 * PGRST202 is PostgREST's "function not in the schema cache"; 42703 and
 * 42P01 are Postgres' undefined-column and undefined-table.
 */
function isMigrationPending(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null;
  const code = err?.code ?? "";
  const msg = (err?.message ?? "").toLowerCase();
  return code === "PGRST202" || code === "42703" || code === "42P01"
    || msg.includes("schema cache")
    || msg.includes("does not exist");
}

const MIGRATION_PENDING_MESSAGE =
  "Database update pending — contact your admin. The app needs Supabase " +
  "migrations 14 to 19 applied before uploads can run. Nothing has been changed.";

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
function parseCrmInputFile(buffer: ArrayBuffer, isCrmSelf = false):
  { rows: ParsedRow[]; headers: string[]; warnings: string[] } {
  const wb = XLSX.read(buffer, { type: "array" });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const { headers, rows } = profileSheet(ws);
  const warnings: string[] = [];

  if (rows.length === 0) {
    return { rows: [], headers, warnings: ["Could not find a real header row with data beneath it in this file."] };
  }

  // The two uploads read different sheets. The standard CRM input asks
  // Category to supply brand/offer/brief later; the CRM Self sheet already
  // carries them, so those columns are read here instead.
  const selfFields: FieldKey[] = [
    "subCategory", "brand", "offer", "titleBrief", "messageBrief",
    "pnTemplate", "creativeRequirements",
  ];
  const fields: FieldKey[] = isCrmSelf
    ? ["day", "time", "slot", "segment", "category", ...selfFields]
    : ["day", "time", "slot", "segment", "category"];
  const map = resolveColumns(headers, fields);
  const missing: string[] = [];
  // Date stays required for BOTH sheets: campaigns.launch_date is NOT NULL,
  // so a row without one cannot be inserted at all.
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
      sub_category: text(r, map, "subCategory"),
      brand: text(r, map, "brand"),
      offer: text(r, map, "offer"),
      title_brief: text(r, map, "titleBrief"),
      message_brief: text(r, map, "messageBrief"),
      pn_template: text(r, map, "pnTemplate"),
      creative_requirements: text(r, map, "creativeRequirements"),
    }))
    .filter((r) => r.day && r.time && r.segment && r.category);

  if (parsed.length === 0) {
    warnings.push("Found all the required columns, but no row had every value filled in.");
  }
  if (isCrmSelf) {
    const optional: [FieldKey, string][] = [
      ["subCategory", "Sub Category"], ["brand", "Brand"], ["offer", "Offer"],
      ["titleBrief", "Title Brief"], ["messageBrief", "Message Brief"],
      ["pnTemplate", "PN Template"], ["creativeRequirements", "Creative Requirements"],
    ];
    const absent = optional.filter(([k]) => !map[k]).map(([, label]) => label);
    if (absent.length > 0) {
      warnings.push(
        `These CRM Self columns weren't found and will be left blank: ${absent.join(", ")}. ` +
        `Everything else imported normally.`
      );
    }
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


interface SendResult { saved: number; failed: number; errors: string[]; note?: string }
/** Stage breakdown returned by upload_reset_preview(), computed server-side
 *  so the numbers shown and the rows deleted come from the same query. */
/**
 * Scoped to ONE planning stream. CRM Self and Category-led are independent:
 * resetting one must never touch the other, so the preview names both the
 * stream being replaced and the one left alone.
 */
interface ReplacePreview {
  stream: string;
  total: number;
  at_category: number;
  with_content: number;
  in_qc: number;
  on_calendar: number;
  emergencies: number;
  change_requests: number;
  unaffected_total: number;
  unaffected_stream: string;
}

export function CrmInputUpload({
  profileId, isCrmSelf = false, onDone, existingCampaigns,
}: {
  profileId: string; isCrmSelf?: boolean; onDone: () => void;
  /** Current PNs, used only for the per-day duplicate preview. */
  existingCampaigns?: Campaign[];
}) {
  // This component is only rendered for CRM, but the Reset control is
  // gated explicitly rather than by assumption — and the server route
  // returns 403 regardless of what the UI renders.
  const { profile } = useSession();
  const isCrm = profile?.role === "CRM";
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [checkingReplace, setCheckingReplace] = useState(false);
  const [replacePreview, setReplacePreview] = useState<ReplacePreview | null>(null);
  /** Typed confirmation. The button stays disabled until it reads RESET. */
  const [confirmText, setConfirmText] = useState("");
  /** Shared success line for the upload and the batch reset. */
  const [toast, setToast] = useState<string | null>(null);
  /** SHA-256 of the chosen file, for the "already uploaded" warning. */
  const [fileHash, setFileHash] = useState<string | null>(null);
  const [priorUpload, setPriorUpload] =
    useState<{ created_at: string; file_name: string | null } | null>(null);
  /** Per-day split of the chosen file: new versus already present. */
  const [dayPreview, setDayPreview] = useState<DayPreview[]>([]);
  /** Required on an upload and on a reset. Remembered per browser. */
  const [uploadName, setUploadName] = useState(() => rememberedName());

  /* ── Reset last upload ── */
  const [batchPreview, setBatchPreview] = useState<UploadBatchPreview | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetTyped, setResetTyped] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [backup, setBackup] =
    useState<{ sha: string; rowIds: string[]; fileName: string } | null>(null);

  const flowLabel = isCrmSelf ? "CRM Self" : "Category-led";



  const [downloading, setDownloading] = useState(false);

  /**
   * CRM's own copy of what is about to be deleted, taken before the reset.
   * The database archive is the real safety net; this is the one CRM can
   * open without asking anybody.
   */
  const downloadBackup = async () => {
    setDownloading(true);
    try {
      const { data, error: err } = await supabase.from("campaigns").select("*");
      if (err) throw err;
      downloadCSV((data ?? []) as Campaign[],
        `cliq-push-backup-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (e) {
      setError(`Could not prepare the backup: ${extractErrorMessage(e)}`);
    }
    setDownloading(false);
  };
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<SendResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const refreshBatch = useCallback(() => {
    if (!BATCH_UPLOAD_ENABLED || !isCrm) return;
    resetLastUploadPreview(isCrmSelf)
      .then(setBatchPreview).catch(() => setBatchPreview(null));
  }, [isCrm, isCrmSelf]);

  useEffect(() => { refreshBatch(); }, [refreshBatch]);

  /** Fetches the server-generated backup for the batch, and keeps its hash. */
  const downloadResetBackup = async () => {
    if (!batchPreview) return;
    setResetError(null);
    const res = await fetch("/api/upload-backup", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ batchId: batchPreview.batch_id }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setResetError(body.error ?? `Backup failed (${res.status}).`);
      return;
    }
    const blob = new Blob(["\uFEFF" + body.csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = body.fileName; a.click();
    URL.revokeObjectURL(url);
    setBackup({ sha: body.sha, rowIds: body.rowIds, fileName: body.fileName });
  };

  const doBatchReset = async () => {
    if (!batchPreview || !backup) return;
    setResetBusy(true); setResetError(null);
    try {
      /**
       * The hash came from the server with the backup. It is presented
       * back unchanged; `reset_last_upload()` re-derives the untouched set
       * inside the transaction and refuses if it differs, so a row edited
       * since the backup aborts the reset rather than removing a different
       * set.
       */
      const removed = await resetLastUpload({
        isCrmSelf, batchId: batchPreview.batch_id,
        rowIds: backup.rowIds, backupSha: backup.sha,
        backupName: backup.fileName, byName: uploadName.trim(),
      });
      rememberName(uploadName);
      setResetOpen(false); setBackup(null); setResetTyped("");
      setToast(`${removed} untouched PN(s) removed. Touched rows were kept.`);
      refreshBatch();
      onDone();
    } catch (e) {
      setResetError(e instanceof Error ? e.message : String(e));
    }
    setResetBusy(false);
  };

  const handleFile = useCallback(async (file: File) => {
    setReading(true); setError(null); setResult(null); setParsed([]);
    setFileName(file.name);
    setFileHash(null); setPriorUpload(null); setDayPreview([]);
    try {
      const buffer = await file.arrayBuffer();
      const { rows, warnings } = parseCrmInputFile(buffer, isCrmSelf);
      if (rows.length === 0) {
        setError(warnings.join(" ") || "No usable rows found in this file.");
      } else {
        const withSlots = assignSlotsIfMissing(rows);
        setParsed(withSlots);

        /**
         * Add-only extras, flag-gated so the old path is untouched:
         * a hash of the file for the "already uploaded" warning, and a
         * per-day split of new versus already-present rows.
         */
        if (BATCH_UPLOAD_ENABLED) {
          try {
            const sha = await fileSha256(file);
            setFileHash(sha);
            setPriorUpload(await previousUploadOfFile(sha));
            setDayPreview(previewByDay(
              withSlots as unknown as Parameters<typeof previewByDay>[0],
              existingCampaigns ?? []));
          } catch {
            // A failed warning must never block the upload itself.
            setFileHash(null);
          }
        }
        if (warnings.length) setError(warnings.join(" "));
      }
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setReading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
    // isCrmSelf decides which sheet shape is parsed and which set the
    // replace-preview counts, so it belongs in the dependency list — an
    // empty array here would pin the callback to the value from first render.
  }, [isCrmSelf]);

  const dates = [...new Set(parsed.map((r) => r.day))];

  /**
   * The CRM Input file is the single source of truth: uploading a new one
   * clears every existing campaign and starts fresh with exactly what's in
   * this file. Not scoped by date, not filtered by status — a full wipe.
   * All six related tables (qc_checklists, change_requests,
   * content_submissions, crm_decisions, activity_logs, notifications) cascade
   * automatically via ON DELETE CASCADE in 01_schema.sql — nothing else
   * needs to be cleared separately.
   */
  const handleReviewReplace = async () => {
    setCheckingReplace(true); setError(null);
    try {
      // Both counts are scoped exactly the way the delete is scoped. A
      // confirmation that counts rows the delete will not touch is a
      // confirmation that lies about what it is destroying.
      // One server-side call. The old version ran two client queries whose
      // predicates had to be kept in step with the delete by hand.
      // Scoped by upload type: the counts must describe only the stream
      // this upload replaces.
      const { data: preview, error: prevErr } = await supabase
        .rpc("upload_reset_preview", { p_is_crm_self: isCrmSelf });
      if (prevErr) {
        // The reset function is what performs the upload, so without it
        // there is nothing useful to confirm. Say why, plainly, and stop
        // before anything is touched.
        if (isMigrationPending(prevErr)) {
          setError(MIGRATION_PENDING_MESSAGE);
          setReading(false);
          return;
        }
        throw prevErr;
      }
      const p = Array.isArray(preview) ? preview[0] : preview;
      setReplacePreview({
        stream: p?.stream ?? (isCrmSelf ? "CRM Self" : "Category-led"),
        unaffected_total: p?.unaffected_total ?? 0,
        unaffected_stream: p?.unaffected_stream ?? (isCrmSelf ? "Category-led" : "CRM Self"),
        total: p?.total ?? 0,
        at_category: p?.at_category ?? 0,
        with_content: p?.with_content ?? 0,
        in_qc: p?.in_qc ?? 0,
        on_calendar: p?.on_calendar ?? 0,
        emergencies: p?.emergencies ?? 0,
        change_requests: p?.change_requests ?? 0,
      });
    } catch (e) {
      setError(extractErrorMessage(e));
    }
    setCheckingReplace(false);
  };

  /**
   * Full fresh start. Archives everything, deletes everything, inserts the
   * uploaded sheet — all inside ONE server-side transaction, so a failure
   * anywhere leaves the dashboard exactly as it was.
   *
   * There is deliberately NO client-side insert or delete path. The reset
   * RPC is the only way an upload writes campaigns; a client fallback could
   * insert without archiving, which is the partial wipe the RPC prevents.
   */
  const handleConfirmReplace = async () => {
    setReplacePreview(null);
    setConfirmText("");
    setSending(true); setError(null); setResult(null);
    setProgress({ done: 0, total: 1 });

    const campaigns = parsed.map((r) => ({
      campaign_name: `${r.segment} \u00b7 ${r.category}`,
      campaign_origin: "CRM_PLANNED",
      launch_date: r.day,
      launch_time: r.time,
      // The raw uploaded value, trimmed only. "0" and "h3" survive here;
      // the integer column below cannot hold either.
      slot_label: (r.slot ?? "").toString().trim() || null,
      slot_number: Number.isFinite(parseInt(r.slot, 10)) ? parseInt(r.slot, 10) : null,
      pncc_segment_label: r.segment,
      pncc_category_code: r.category,
      category: r.category,
      slot_type: "STANDARD",
      is_crm_self: isCrmSelf,
      sub_category: r.sub_category ?? null,
      brand: r.brand ?? null,
      offer: r.offer ?? null,
      title_brief: r.title_brief ?? null,
      message_brief: r.message_brief ?? null,
      pn_template: r.pn_template ?? null,
      creative_requirements: r.creative_requirements ?? null,
      category_status: isCrmSelf ? "LOCKED" : "EMPTY",
      crm_status: isCrmSelf ? "IN_PLANNING" : "AWAITING_REVIEW",
      content_status: "NOT_ASSIGNED",
      qc_status: "PENDING",
      production_status: "NOT_READY",
      priority: "NORMAL",
      created_by: profileId,
    }));

    try {
      /**
       * FLAG ON  → `add_upload_batch()`: ADD-ONLY. Inserts and nothing else,
       *            tagged with a batch so it can be undone.
       * FLAG OFF → the existing `reset_campaigns_with_archive()` path,
       *            byte-for-byte unchanged, so rolling back is one variable.
       */
      if (BATCH_UPLOAD_ENABLED) {
        const id = await addUploadBatch(
          campaigns as unknown as Record<string, unknown>[],
          isCrmSelf, fileName, fileHash ?? "", uploadName.trim());
        setProgress(null);
        setParsed([]);
        setToast(
          `${campaigns.length} PN(s) added. Nothing existing was changed. `
          + `You can reset this upload while no team has touched it.`);
        await log(null, profileId,
          isCrmSelf ? "CRM_SELF_PN_UPLOAD" : "CRM_INPUT_UPLOAD",
          `${campaigns.length} rows added (batch ${id}).`);
        setSending(false);
        onDone();
        return;
      }

      const { data: batchId, error: resetErr } = await supabase.rpc(
        "reset_campaigns_with_archive",
        { p_rows: campaigns, p_is_crm_self: isCrmSelf }
      );
      if (resetErr) {
        if (isMigrationPending(resetErr)) {
          setProgress(null);
          setError(MIGRATION_PENDING_MESSAGE);
          setSending(false);
          return;
        }
        throw resetErr;
      }

      setProgress(null);
      setResult({
        saved: campaigns.length, failed: 0, errors: [],
        note: `Dashboard reset. Previous data archived as batch ${String(batchId ?? "").slice(0, 8)}.`,
      });
      await log(null, profileId,
        isCrmSelf ? "CRM_SELF_PN_UPLOAD" : "CRM_INPUT_UPLOAD",
        `${isCrmSelf ? "CRM Self PN file" : "CRM input file"} uploaded: dashboard reset to ` +
        `${campaigns.length} rows from ${fileName}.`);
      if (!isCrmSelf) {
        await notify("CATEGORY", "NEW_INPUT", "New campaign slots available",
          `${campaigns.length} new campaigns from ${fileName} are ready for your input.`);
      }
      onDone();
    } catch (e) {
      setProgress(null);
      setError("Reset failed, so nothing was changed \u2014 your existing campaigns are intact. "
        + extractErrorMessage(e));
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
              : BATCH_UPLOAD_ENABLED
                ? "Columns: Day, Time, Slot, Segment, Category. Multiple PNs can share a slot — that's normal. Add-only: existing PNs are never changed or removed."
                : "Columns: Day, Time, Slot, Segment, Category. Multiple PNs can share a slot — that's normal. This file is the source of truth: uploading replaces the RUNNING PNs of this stream only — campaigns already on the calendar, past Final QC or production-ready are kept."}
          </p>
        </div>

        <label className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface px-4 py-2.5 text-[13px] font-medium text-body transition-colors hover:bg-[#F9FAFB] ${reading ? "pointer-events-none opacity-60" : ""}`}>
          {reading ? "Reading file..." : <>{Icon.chart(13)} Choose file</>}
          <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" disabled={reading}
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
        </label>

        {/* Undoes only the MOST RECENT batch of this stream, and only its
            untouched rows. CRM only; the server checks the role again. */}
        {BATCH_UPLOAD_ENABLED && isCrm && batchPreview && (
          <span title={batchPreview.untouched === 0
            ? "Nothing in the last upload is still untouched" : undefined}>
            <Button variant="danger" disabled={reading || batchPreview.untouched === 0}
              onClick={() => { setResetTyped(""); setResetError(null);
                               setBackup(null); setResetOpen(true); }}>
              Reset last upload ({batchPreview.untouched})
            </Button>
          </span>
        )}

      </div>

      {/* The batch a reset would act on, stated before the button is used. */}
      {BATCH_UPLOAD_ENABLED && isCrm && batchPreview && (
        <div className="mt-4 rounded-lg border border-line px-4 py-2.5">
          <p className="text-tiny font-600 text-heading">Your last upload</p>
          <p className="mt-0.5 text-micro text-muted">
            {batchPreview.file_name ?? "(file name not recorded)"} ·{" "}
            {fmtDate(batchPreview.uploaded_at.slice(0, 10))}
            {batchPreview.uploaded_name ? ` by ${batchPreview.uploaded_name}` : ""} ·{" "}
            {batchPreview.total} PN{batchPreview.total === 1 ? "" : "s"}
          </p>
          <p className="mt-1 text-micro text-muted">
            This removes only the PNs from your last upload. PNs a team has
            already worked on are kept.{" "}
            <span className="text-faint">
              Uploads from before this update can&rsquo;t be reset.
            </span>
          </p>
        </div>
      )}

      {BATCH_UPLOAD_ENABLED && priorUpload && (
        <div className="mt-4 rounded-lg bg-warning-50 px-4 py-3 text-tiny text-warning-700">
          This exact file was uploaded on {fmtDate(priorUpload.created_at.slice(0, 10))}
          {priorUpload.file_name ? ` as "${priorUpload.file_name}"` : ""}. Uploading again
          adds a second copy of any row that is not already present.
        </div>
      )}

      {BATCH_UPLOAD_ENABLED && dayPreview.length > 0 && (
        <div className="mt-4 rounded-lg border border-line">
          <div className="border-b border-line px-4 py-2.5">
            <span className="text-tiny font-600 text-heading">Before you confirm</span>
            <span className="ml-2 text-micro text-faint">
              Add-only — nothing existing is changed or removed.
            </span>
          </div>
          <table className="w-full">
            <thead><tr><th>Day</th><th>New</th><th>Already exist</th><th /></tr></thead>
            <tbody>
              {dayPreview.map((d) => (
                <tr key={d.date}>
                  <td className="text-tiny font-medium text-heading">{fmtDate(d.date)}</td>
                  <td className="text-tiny tabular-nums text-success-700">{d.incoming}</td>
                  <td className={`text-tiny tabular-nums ${
                    d.alreadyExist > 0 ? "text-warning-700" : "text-muted"}`}>
                    {d.alreadyExist}
                  </td>
                  <td className="text-micro text-warning-700">
                    {d.isPast ? "past date" : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {BATCH_UPLOAD_ENABLED && parsed.length > 0 && (
        <label className="mt-4 block">
          <span className="mb-1 block text-tiny font-medium text-body">
            Your name <span className="text-danger-500">*</span>
          </span>
          <input value={uploadName} onChange={(e) => setUploadName(e.target.value)}
            placeholder="Typed once, then remembered on this browser" />
        </label>
      )}

      {toast && (
        <div className="mt-4 flex items-start justify-between gap-2 rounded-lg bg-success-50 px-4 py-3 text-tiny text-success-700">
          <span>{toast}</span>
          <button onClick={() => setToast(null)} className="font-medium hover:underline">
            Dismiss
          </button>
        </div>
      )}

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
                <span>Archiving and replacing {parsed.length} rows...</span>
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

      {/* Reset last upload: preview, server backup, typed name, typed RESET. */}
      <Modal open={resetOpen} onClose={() => setResetOpen(false)}
        title="Reset last upload">
        <div className="space-y-4">
          {batchPreview && (
            <>
              <p className="text-tiny text-muted">
                {batchPreview.file_name ? `"${batchPreview.file_name}"` : "The last upload"}
                {batchPreview.uploaded_name ? ` by ${batchPreview.uploaded_name}` : ""} ·{" "}
                {fmtDate(batchPreview.uploaded_at.slice(0, 10))}
              </p>
              <div className="flex flex-wrap gap-2">
                <Pill dot={false} tone="danger"
                  label={`${batchPreview.untouched} will be removed`} />
                <Pill dot={false} tone="success"
                  label={`${batchPreview.touched} kept — a team has touched them`} />
              </div>
              <p className="rounded-lg bg-[#FCFCFD] px-3 py-2 text-micro text-muted">
                A row is kept if any team has entered a value, a status has moved,
                it has QC, change-request, decision or content-change rows, it has
                activity beyond the upload, it has defaulted, or it is on the
                calendar. Anything that cannot be checked is kept.
              </p>
            </>
          )}

          <div>
            <Button size="sm" variant="ghost" disabled={resetBusy || !batchPreview}
              onClick={downloadResetBackup}>
              {backup ? "Backup downloaded — download again" : "1. Download backup"}
            </Button>
            {backup && (
              <p className="mt-1 text-micro text-success-700">
                {backup.rowIds.length} row(s) saved to {backup.fileName}.
              </p>
            )}
          </div>

          <label className="block">
            <span className="mb-1 block text-tiny font-medium text-body">
              2. Your name <span className="text-danger-500">*</span>
            </span>
            <input value={uploadName} onChange={(e) => setUploadName(e.target.value)} />
          </label>

          <label className="block">
            <span className="mb-1 block text-tiny font-medium text-body">
              3. Type <span className="font-mono text-heading">RESET</span> to confirm
            </span>
            <input value={resetTyped} onChange={(e) => setResetTyped(e.target.value)}
              className="!font-mono" placeholder="RESET" />
          </label>

          {resetError && (
            <p className="rounded-lg bg-danger-50 px-3 py-2 text-tiny text-danger-700">
              {resetError}
            </p>
          )}

          <div className="flex justify-end gap-3">
            <Button variant="ghost" disabled={resetBusy}
              onClick={() => setResetOpen(false)}>Cancel</Button>
            <Button variant="danger"
              disabled={resetBusy || !backup || resetTyped !== "RESET"
                || uploadName.trim() === ""}
              onClick={doBatchReset}>
              {resetBusy ? "Removing..." : `Remove ${batchPreview?.untouched ?? 0} PNs`}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!replacePreview} onClose={() => { setReplacePreview(null); setConfirmText(""); }}
        title="Full reset — this deletes every campaign">
        {replacePreview && (
          <div className="space-y-4">
            {/* A reset removes EVERYTHING, both flows, every status. The
                breakdown is here so nobody confirms a number they did not
                understand. */}
            <div className="rounded-lg bg-warning-50 px-4 py-3 text-tiny text-warning-700">
              <div>
                <span className="font-medium">Upload type:</span> {replacePreview.stream}
              </div>
              <div className="mt-1">
                <span className="font-medium">Running rows to archive and replace:</span>{" "}
                {replacePreview.total} — replaced with this file&rsquo;s{" "}
                <span className="font-medium">{parsed.length}</span> rows.
              </div>
              <div className="mt-1">
                <span className="font-medium">Rows unaffected:</span>{" "}
                {replacePreview.unaffected_total} {replacePreview.unaffected_stream} campaign
                {replacePreview.unaffected_total === 1 ? "" : "s"} — these are a separate
                planning stream and will not be touched.
              </div>
            </div>

            <ul className="divide-y divide-line rounded-lg border border-line text-tiny">
              {[
                ["At Category", replacePreview.at_category],
                ["With Content", replacePreview.with_content],
                ["In QC", replacePreview.in_qc],
                ["On Calendar", replacePreview.on_calendar],
                ["Emergency PNs", replacePreview.emergencies],
                ["Open change requests", replacePreview.change_requests],
              ].map(([label, n]) => (
                <li key={String(label)} className="flex justify-between px-3 py-1.5">
                  <span className={label === "On Calendar" && Number(n) > 0 ? "font-medium text-danger-700" : "text-muted"}>
                    {label}
                  </span>
                  <span className={label === "On Calendar" && Number(n) > 0 ? "font-medium text-danger-700" : "tabular-nums text-heading"}>
                    {n}
                  </span>
                </li>
              ))}
            </ul>

            {replacePreview.on_calendar > 0 && (
              <div className="rounded-lg bg-danger-50 px-4 py-3 text-tiny text-danger-700">
                <span className="font-medium">
                  {replacePreview.on_calendar} campaign{replacePreview.on_calendar === 1 ? " is" : "s are"} already
                  live on the Calendar.
                </span>{" "}
                They will be removed from the Calendar, Final View and the export. Everything is
                archived first and can be recovered, but the live calendar will be empty until the
                new sheet is processed.
              </div>
            )}

            <div className="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5">
              <Button size="sm" variant="ghost" disabled={downloading} onClick={downloadBackup}>
                {downloading ? "Preparing..." : "Download backup (Excel)"}
              </Button>
              <span className="text-micro text-faint">
                Everything is archived in the database as well — this is your own copy.
              </span>
            </div>

            <div>
              <label className="text-tiny text-muted">
                Type <span className="font-mono font-medium text-heading">RESET</span> to confirm
              </label>
              <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)}
                placeholder="RESET" className="mt-1 !font-mono" autoFocus />
            </div>

            <div className="flex justify-end gap-3">
              <Button variant="ghost" onClick={() => { setReplacePreview(null); setConfirmText(""); }}>
                Cancel
              </Button>
              <Button variant="danger" disabled={confirmText !== "RESET"} onClick={handleConfirmReplace}>
                Delete {replacePreview.total} and load {parsed.length}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </Card>
  );
}
