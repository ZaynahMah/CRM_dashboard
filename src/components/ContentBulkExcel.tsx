"use client";

import { useRef, useState } from "react";
import type { Campaign } from "@/types/campaign";
import { buildContentWorkbook, parseContentWorkbook } from "@/lib/contentExcel";
import {
  summariseRange, validateRange, currentMonthRange, type DateRange,
} from "@/lib/dateRange";
import {
  saveImportedContent, bulkSendToCrm, fetchCampaignsByIds, logExport, pendingForContent,
} from "@/services/contentBulk";
import type { BulkCalendarOutcome } from "@/services/campaigns";
import { Button, Card, Field, Pill } from "./ui";
import { Icon } from "./icons";
import { ContentImportPreview } from "./ContentImportPreview";

/**
 * Bulk Excel workflow for the Content team — a NEW section. The existing
 * row-by-row Content flow is untouched and still works.
 *
 * Export a range → fill offline → import → preview and correct → send to
 * CRM. Identity is carried by the campaign UUID in the sheet, and the
 * import refuses anything that lost or gained a row.
 */
export function ContentBulkExcel({ campaigns, profileId, onChanged }: {
  /** The Content team's assigned rows, in their existing order. */
  campaigns: Campaign[];
  profileId: string;
  onChanged: () => void;
}) {
  /** Export mode. Pending is primary: Content thinks in outstanding work. */
  const [mode, setMode] = useState<"pending" | "dates">("pending");
  /**
   * A DATE range, not a row range. Content plans by date — "1 Oct to 10
   * Oct" — and CRM may send a whole month at once. Row numbers meant
   * nothing to them.
   */
  const [range, setRange] = useState<DateRange>(() => currentMonthRange());
  const [busy, setBusy] = useState<null | "export" | "import" | "send">(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<BulkCalendarOutcome[] | null>(null);
  const [imported, setImported] = useState<Campaign[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  /** Exactly what the last export covered, so the import can reconcile. */
  const exportedIds = useRef<string[]>([]);

  const clear = () => { setErrors([]); setWarnings([]); setNote(null); setOutcomes(null); };

  const pending = pendingForContent(campaigns);
  const rangeCheck = validateRange(range);
  // Everything the modal shows before the download: count, categories and
  // the range in words, so Content can confirm the batch is the right one.
  const summary = summariseRange(campaigns, range,
    (c) => c.launch_date, (c) => c.category ?? c.pncc_category_code);
  const slice = mode === "pending" ? pending : summary.items;
  const rangeLabel = mode === "pending" ? "pending rows" : summary.label;

  /**
   * One active imported batch at a time. Until it is sent or cancelled a
   * second import is blocked — two batches in preview at once is how the
   * wrong rows get submitted.
   */
  const batchLocked = imported.length > 0;

  /* ---------------- export ---------------- */
  const doExport = async () => {
    clear();
    if (mode === "dates" && !rangeCheck.valid) {
      setErrors([rangeCheck.error ?? "Choose a valid date range."]);
      return;
    }
    // Never generate an empty workbook: a file with headers and no rows
    // looks like a successful export and wastes a round trip.
    if (slice.length === 0) {
      setErrors([mode === "pending"
        ? "You have no pending rows — everything assigned to you has been submitted."
        : "No campaigns found for selected date range."]);
      return;
    }
    setBusy("export");
    try {
      const buf = buildContentWorkbook(slice);
      exportedIds.current = slice.map((c) => c.id);
      const blob = new Blob([buf], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = mode === "pending"
        ? `content-worklist-pending-${slice.length}.xlsx`
        : `content-worklist-${range.start}-to-${range.end}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      await logExport(slice.length, mode, rangeLabel, profileId);
      setNote(`Exported ${slice.length} ${rangeLabel}. Fill the Header and Sub Copy columns, then import the same file back.`);
    } catch (e) {
      setErrors([e instanceof Error ? e.message : String(e)]);
    }
    setBusy(null);
  };

  /* ---------------- import ---------------- */
  const doImport = async (file: File) => {
    clear();
    if (batchLocked) {
      setErrors(["A batch is already open. Send it to CRM or cancel the preview before importing another file."]);
      return;
    }
    setBusy("import");
    try {
      const buf = await file.arrayBuffer();
      // Reconciled against the last export when we have it; the manifest
      // inside the file catches a lost row either way.
      const parsed = parseContentWorkbook(
        buf, exportedIds.current.length > 0 ? exportedIds.current : undefined);

      setWarnings(parsed.warnings);
      if (!parsed.ok) {
        setErrors(parsed.errors);
        setBusy(null);
        return;
      }

      const results = await saveImportedContent(parsed.rows, profileId,
        (done, total) => setProgress({ done, total }));
      setProgress(null);
      setOutcomes(results.some((r) => !r.ok) ? results : null);

      const saved = results.filter((r) => r.ok).length;
      const rows = await fetchCampaignsByIds(parsed.rows.map((r) => r.campaignId));
      setImported(rows);
      setNote(`Imported ${saved} of ${parsed.rows.length} rows. Open Preview to review before sending to CRM.`);
      onChanged();
    } catch (e) {
      setErrors([e instanceof Error ? e.message : String(e)]);
    }
    setBusy(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  /* ---------------- send ---------------- */
  const doSend = async (rows: Campaign[]) => {
    setBusy("send"); clear();
    try {
      const results = await bulkSendToCrm(rows, profileId,
        (done, total) => setProgress({ done, total }));
      setProgress(null);
      const ok = results.filter((r) => r.ok).length;
      setOutcomes(results.some((r) => !r.ok) ? results : null);
      setNote(`${ok} of ${rows.length} rows sent to CRM review.`);
      if (ok === rows.length) { setImported([]); setPreviewOpen(false); }
      onChanged();
    } catch (e) {
      setErrors([e instanceof Error ? e.message : String(e)]);
    }
    setBusy(null);
  };

  return (
    <>
      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h3 className="font-display text-[15px] font-600 text-heading">Bulk Export / Import</h3>
          <span className="text-micro text-faint">
            Work a batch offline in Excel, then bring it back. Your row-by-row flow is unchanged.
          </span>
          <Pill dot={false} label={`${campaigns.length} assigned`} tone="indigo" />
        </div>

        <div className="mb-3 flex flex-wrap gap-2">
          <Button size="sm" variant={mode === "pending" ? "primary" : "ghost"}
            onClick={() => setMode("pending")}>
            Pending rows only ({pending.length})
          </Button>
          <Button size="sm" variant={mode === "dates" ? "primary" : "ghost"}
            onClick={() => setMode("dates")}>
            Date range
          </Button>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          {mode === "dates" && (
            <>
              <Field label="Start Date" hint="campaign date, included">
                <input type="date" className="!w-[160px]" value={range.start}
                  onChange={(e) => setRange((r) => ({ ...r, start: e.target.value }))} />
              </Field>
              <Field label="End Date" hint="included">
                <input type="date" className="!w-[160px]" value={range.end}
                  onChange={(e) => setRange((r) => ({ ...r, end: e.target.value }))} />
              </Field>
            </>
          )}

          <Button size="sm"
            disabled={busy !== null || (mode === "dates" && !rangeCheck.valid)}
            onClick={doExport}>
            {busy === "export" ? "Preparing..." : "Export Excel"}
          </Button>

          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) doImport(f); }} />
          <Button size="sm" variant="ghost" disabled={busy !== null || batchLocked}
            onClick={() => fileRef.current?.click()}>
            {busy === "import" ? "Importing..." : "Import Excel"}
          </Button>

          {mode === "dates" && (
          <div className="mt-3 rounded-lg border border-line px-4 py-3">
            {!rangeCheck.valid ? (
              <p className="text-tiny text-danger-700">{rangeCheck.error}</p>
            ) : (
              <dl className="flex flex-wrap gap-x-8 gap-y-2">
                <div>
                  <dt className="text-micro uppercase tracking-wide text-faint">Date Range</dt>
                  <dd className="text-tiny font-medium text-heading">{summary.label}</dd>
                </div>
                <div>
                  <dt className="text-micro uppercase tracking-wide text-faint">Campaigns Found</dt>
                  <dd className={`text-tiny font-medium tabular-nums ${
                    summary.count === 0 ? "text-danger-700" : "text-heading"}`}>
                    {summary.count}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-micro uppercase tracking-wide text-faint">Categories</dt>
                  <dd className="text-tiny text-body">
                    {summary.categories.length > 0 ? summary.categories.join(", ") : "—"}
                  </dd>
                </div>
              </dl>
            )}
            {rangeCheck.valid && summary.count === 0 && (
              <p className="mt-2 text-tiny text-danger-700">
                No campaigns found for selected date range.
              </p>
            )}
          </div>
        )}

        {batchLocked && (
            <>
              <Button size="sm" variant="ghost" disabled={busy !== null}
                onClick={() => setPreviewOpen(true)}>
                Preview {imported.length} imported rows
              </Button>
              {/* "Close", not "Cancel": closing does NOT undo the import.
                  The values were written to the campaigns the moment the
                  file was accepted, so calling this Cancel would promise a
                  rollback that does not happen. */}
              <Button size="sm" variant="ghost" disabled={busy !== null}
                onClick={() => {
                  setImported([]); setPreviewOpen(false); clear();
                  setNote(
                    "Preview closed. The imported content is still saved on the campaigns as a "
                    + "draft — it has NOT been removed, and it has NOT been sent to CRM. "
                    + "Export the pending rows again to keep working on them.");
                }}>
                Close Preview
              </Button>
              <span className="text-micro text-warning-700">
                One batch at a time — send it to CRM or close the preview before importing
                another file.
              </span>
            </>
          )}
        </div>

        {mode === "dates" && (
          <div className="mt-3 rounded-lg border border-line px-4 py-3">
            {!rangeCheck.valid ? (
              <p className="text-tiny text-danger-700">{rangeCheck.error}</p>
            ) : (
              <dl className="flex flex-wrap gap-x-8 gap-y-2">
                <div>
                  <dt className="text-micro uppercase tracking-wide text-faint">Date Range</dt>
                  <dd className="text-tiny font-medium text-heading">{summary.label}</dd>
                </div>
                <div>
                  <dt className="text-micro uppercase tracking-wide text-faint">Campaigns Found</dt>
                  <dd className={`text-tiny font-medium tabular-nums ${
                    summary.count === 0 ? "text-danger-700" : "text-heading"}`}>
                    {summary.count}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-micro uppercase tracking-wide text-faint">Categories</dt>
                  <dd className="text-tiny text-body">
                    {summary.categories.length > 0 ? summary.categories.join(", ") : "—"}
                  </dd>
                </div>
              </dl>
            )}
            {rangeCheck.valid && summary.count === 0 && (
              <p className="mt-2 text-tiny text-danger-700">
                No campaigns found for selected date range.
              </p>
            )}
          </div>
        )}

        {batchLocked && (
          <div className="mt-3 rounded-lg bg-warning-50 px-3 py-2.5 text-tiny text-warning-700">
            <div className="flex flex-wrap items-center gap-2">
              <Pill dot={false} label="Draft" tone="warning" />
              <Pill dot={false} label="Imported" tone="indigo" />
              <Pill dot={false} label="Not yet submitted to CRM" tone="warning" />
              <span className="font-medium">{imported.length} rows</span>
            </div>
            <p className="mt-1.5">
              Imported content has already been saved. Closing preview will NOT remove
              imported values — only CRM submission will be cancelled.
            </p>
          </div>
        )}

        {progress && (
          <p className="mt-3 text-micro tabular-nums text-muted">
            {progress.done} / {progress.total} rows written...
          </p>
        )}

        {note && (
          <p className="mt-3 flex items-start gap-2 rounded-lg bg-success-50 px-3 py-2 text-tiny text-success-700">
            {Icon.check(13)} <span>{note}</span>
          </p>
        )}

        {warnings.map((w, i) => (
          <p key={i} className="mt-2 rounded-lg bg-warning-50 px-3 py-2 text-tiny text-warning-700">{w}</p>
        ))}

        {errors.length > 0 && (
          <div className="mt-3 rounded-lg bg-danger-50 px-3 py-2">
            <p className="mb-1 flex items-center gap-1.5 text-tiny font-medium text-danger-700">
              {Icon.alert(13)} Nothing was imported
            </p>
            <ul className="space-y-1">
              {errors.map((e, i) => (
                <li key={i} className="text-tiny text-danger-700">{e}</li>
              ))}
            </ul>
          </div>
        )}

        {outcomes && (
          <div className="mt-3 max-h-[26vh] overflow-y-auto rounded-lg border border-line">
            <table className="w-full text-tiny">
              <tbody>
                {outcomes.filter((o) => !o.ok).map((o) => (
                  <tr key={o.campaignId} className="border-b border-line last:border-b-0">
                    <td className="w-5 px-2 py-1.5 text-danger-700">{Icon.alert(12)}</td>
                    <td className="px-2 py-1.5 font-medium text-heading">{o.campaignName}</td>
                    <td className="px-2 py-1.5 text-muted">{o.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {previewOpen && (
        <ContentImportPreview
          campaigns={imported}
          profileId={profileId}
          busy={busy === "send"}
          onClose={() => setPreviewOpen(false)}
          onUpdated={(updated) => setImported(updated)}
          onSend={doSend}
        />
      )}
    </>
  );
}
