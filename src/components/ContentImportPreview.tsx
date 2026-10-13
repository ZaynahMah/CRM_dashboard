"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Campaign } from "@/types/campaign";
import { savePreviewEdit } from "@/services/contentBulk";
import { countOf, validateContentRow } from "@/lib/contentExcel";
import { HEADER_LIMIT, SUB_COPY_LIMIT } from "@/lib/workflow";
import { Button, Pill } from "./ui";
import { Icon } from "./icons";
import { fmtDate, fmtTime } from "@/lib/format";

/**
 * Preview of an imported Excel batch, with inline correction.
 *
 * THE POINT OF THIS SCREEN IS READING. Copy is shown in full — no
 * truncation, no ellipsis, no hover tooltips. Header and Sub Copy render in
 * auto-growing textareas, so a long line wraps and stays visible. A
 * reviewer who cannot see the whole sentence cannot review it.
 *
 * Rows are virtualized because a batch can be 1,000+; the window is sized
 * generously so scrolling never shows a gap.
 */

const ESTIMATED_ROW_H = 150;

export function ContentImportPreview({
  campaigns, profileId, busy, onClose, onUpdated, onSend,
}: {
  campaigns: Campaign[];
  profileId: string;
  busy: boolean;
  onClose: () => void;
  onUpdated: (rows: Campaign[]) => void;
  onSend: (rows: Campaign[]) => void;
}) {
  const [rows, setRows] = useState<Campaign[]>(campaigns);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(campaigns.map((c) => c.id)));
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setRows(campaigns); }, [campaigns]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(700);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setScrollTop(el.scrollTop);
    const measure = () => setViewportH(el.clientHeight || 700);
    measure();
    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", measure);
    };
  }, []);

  const OVERSCAN = 4;
  const first = Math.max(0, Math.floor(scrollTop / ESTIMATED_ROW_H) - OVERSCAN);
  const count = Math.ceil(viewportH / ESTIMATED_ROW_H) + OVERSCAN * 2;
  const last = Math.min(rows.length, first + count);
  const visible = rows.slice(first, last);
  const padTop = first * ESTIMATED_ROW_H;
  const padBottom = Math.max(0, (rows.length - last) * ESTIMATED_ROW_H);

  /** Edits are kept locally and written on blur, so typing never lags. */
  const setField = useCallback((id: string, key: keyof Campaign, value: string) => {
    setRows((prev) => prev.map((c) => (c.id === id ? { ...c, [key]: value } as Campaign : c)));
  }, []);

  const commit = useCallback(async (c: Campaign, key: "header" | "sub_copy_text" | "reference_link") => {
    setSavingId(c.id); setError(null);
    try {
      await savePreviewEdit(c.id, { [key]: (c[key] as string) ?? "" }, profileId);
      setSavedId(c.id);
      setTimeout(() => setSavedId((s) => (s === c.id ? null : s)), 1500);
      onUpdated(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setSavingId(null);
  }, [profileId, rows, onUpdated]);

  /**
   * Validation runs on every keystroke, so the counts below and the Send
   * button can never disagree. A row over its character limit is NOT
   * sendable — incomplete content must never reach CRM silently.
   */
  const validation = useMemo(() => {
    const map = new Map<string, ReturnType<typeof validateContentRow>>();
    for (const c of rows) {
      map.set(c.id, validateContentRow(c, HEADER_LIMIT, SUB_COPY_LIMIT));
    }
    return map;
  }, [rows]);

  const ready = useMemo(
    () => rows.filter((c) => validation.get(c.id)?.ready), [rows, validation]);
  const incomplete = rows.length - ready.length;
  const selectedRows = rows.filter((c) => selected.has(c.id));
  const sendable = selectedRows.filter((c) => validation.get(c.id)?.ready);
  const excluded = selectedRows.length - sendable.length;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
      {/* No click-outside-to-close: a stray click must not discard a review. */}
      <div className="flex h-[90vh] w-[88vw] flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-pop">

        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-line px-5 py-3">
          <div className="flex items-center gap-3">
            <h2 className="font-display text-[16px] font-600 text-heading">
              Review imported content
            </h2>
            <Pill dot={false} label={`${rows.length} rows`} tone="indigo" />
            <Pill dot={false} label="Draft · Imported · Not yet submitted" tone="warning" />
            <Pill dot={false} label={`Rows Ready: ${ready.length}`} tone="success" />
            {incomplete > 0 && (
              <Pill dot={false} label={`Rows Incomplete: ${incomplete}`} tone="warning" />
            )}
            {savedId && (
              <span className="flex items-center gap-1 text-micro text-success-700">
                {Icon.check(12)} saved
              </span>
            )}
          </div>
          <button onClick={onClose} aria-label="Close preview"
            title="Closing does not remove the imported values — they are already saved as a draft."
            className="rounded-lg px-2.5 py-1.5 text-[18px] leading-none text-faint hover:bg-[#F9FAFB] hover:text-heading">
            ✕
          </button>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line bg-[#FCFCFD] px-5 py-2.5">
          <button
            onClick={() => setSelected(selected.size === rows.length
              ? new Set() : new Set(rows.map((c) => c.id)))}
            className="text-micro font-medium text-indigo-700 hover:underline">
            {selected.size === rows.length ? "Clear all" : "Select all"}
          </button>
          <span className="text-micro text-faint">{selected.size} selected</span>
          <Button size="sm" disabled={busy || sendable.length === 0}
            onClick={() => onSend(sendable)}>
            {busy ? "Sending..." : `Bulk Send To CRM (${sendable.length})`}
          </Button>
          {excluded > 0 && (
            <span className="text-micro text-warning-700">
              {excluded} selected row(s) will be EXCLUDED — missing fields or over the
              character limit. Only the {sendable.length} valid row(s) are sent.
            </span>
          )}
          {error && (
            <span className="ml-auto flex items-center gap-1.5 text-micro text-danger-700">
              {Icon.alert(12)} {error}
            </span>
          )}
        </div>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto px-5 py-3">
          <div style={{ height: padTop }} aria-hidden="true" />
          <ul className="space-y-3">
            {visible.map((c) => {
              const h = countOf(c.header ?? "");
              const s = countOf(c.sub_copy_text ?? "");
              return (
                <li key={c.id} className="rounded-lg border border-line p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <input type="checkbox" checked={selected.has(c.id)}
                      onChange={() => setSelected((p) => {
                        const n = new Set(p);
                        n.has(c.id) ? n.delete(c.id) : n.add(c.id);
                        return n;
                      })} />
                    <span className="text-[13px] font-medium text-heading">{c.campaign_name}</span>
                    {/* Campaign Date and Campaign ID: the two things that tie
                        this row back to the exported sheet. The id is shown
                        in full, not truncated, so it can be copied. */}
                    <span className="text-micro font-medium text-body">
                      {fmtDate(c.launch_date)} · {fmtTime(c.launch_time)}
                    </span>
                    <span className="font-mono text-[10px] text-faint">{c.id}</span>
                    <span className="text-micro text-faint">
                      {c.brand ? `${c.brand}` : ""}
                      {c.offer ? ` · ${c.offer}` : ""}
                    </span>
                    {savingId === c.id && <span className="text-micro text-faint">saving...</span>}
                    {/* Saved, but not sent: the distinction people most
                        need while reviewing. */}
                    {c.content_status !== "SUBMITTED" && (
                      <Pill dot={false} label="Draft — not yet submitted" tone="warning" />
                    )}
                    {!validation.get(c.id)?.ready && (
                      <Pill dot={false} label="not sendable" tone="danger" />
                    )}
                  </div>
                  {!validation.get(c.id)?.ready && (
                    <ul className="mb-2 space-y-0.5">
                      {validation.get(c.id)!.problems.map((p, i) => (
                        <li key={i} className="text-micro text-danger-700">{p}</li>
                      ))}
                    </ul>
                  )}

                  {/* Full text, always. Textareas grow with the content so a
                      long sentence wraps instead of being cut off. Counts
                      update live and turn red past the limit. */}
                  <div className="grid gap-3 lg:grid-cols-2">
                    <label className="block">
                      <span className="text-micro uppercase tracking-wide text-faint">
                        Header · {h}/{HEADER_LIMIT}
                        {h > HEADER_LIMIT && <span className="ml-1 text-danger-700">over limit</span>}
                      </span>
                      <textarea
                        rows={Math.max(2, Math.ceil((c.header ?? "").length / 55))}
                        value={c.header ?? ""}
                        onChange={(e) => setField(c.id, "header", e.target.value)}
                        onBlur={() => commit(c, "header")}
                        className={`mt-1 !text-[13px] !leading-relaxed ${
                          h > HEADER_LIMIT ? "!border-[#FECDCA]" : ""}`} />
                    </label>
                    <label className="block">
                      <span className="text-micro uppercase tracking-wide text-faint">
                        Sub Header (Sub Copy) · {s}/{SUB_COPY_LIMIT}
                        {s > SUB_COPY_LIMIT && <span className="ml-1 text-danger-700">over limit</span>}
                      </span>
                      <textarea
                        rows={Math.max(2, Math.ceil((c.sub_copy_text ?? "").length / 55))}
                        value={c.sub_copy_text ?? ""}
                        onChange={(e) => setField(c.id, "sub_copy_text", e.target.value)}
                        onBlur={() => commit(c, "sub_copy_text")}
                        className={`mt-1 !text-[13px] !leading-relaxed ${
                          s > SUB_COPY_LIMIT ? "!border-[#FECDCA]" : ""}`} />
                    </label>
                  </div>

                  <div className="mt-2 grid gap-3 lg:grid-cols-2">
                    <label className="block">
                      <span className="text-micro uppercase tracking-wide text-faint">Reference Link</span>
                      <input value={c.reference_link ?? ""}
                        onChange={(e) => setField(c.id, "reference_link", e.target.value)}
                        onBlur={() => commit(c, "reference_link")}
                        className="mt-1 !text-[12.5px]" />
                    </label>
                    {/* Read-only context, shown in FULL — whitespace-pre-wrap
                        and no line clamp, so nothing needs a hover tooltip. */}
                    {c.message_brief && (
                      <div>
                        <span className="text-micro uppercase tracking-wide text-faint">Message Brief</span>
                        <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted">
                          {c.message_brief}
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="mt-2 grid gap-3 lg:grid-cols-2">
                    {c.brief && (
                      <div>
                        <span className="text-micro uppercase tracking-wide text-faint">Category Brief</span>
                        <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted">
                          {c.brief}
                        </p>
                      </div>
                    )}
                    {c.additional_notes && (
                      <div>
                        <span className="text-micro uppercase tracking-wide text-faint">Remarks</span>
                        <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted">
                          {c.additional_notes}
                        </p>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <div style={{ height: padBottom }} aria-hidden="true" />
        </div>

        {/* Stated where the decision is made, not buried in a tooltip: the
            import is already persisted, so closing cancels the submission,
            not the data. */}
        <div className="shrink-0 border-t border-line bg-warning-50 px-5 py-2.5 text-micro text-warning-700">
          <span className="font-medium">Imported content has already been saved.</span>{" "}
          Closing preview will NOT remove imported values — only CRM submission will be
          cancelled. These rows stay as a draft until you press Bulk Send To CRM.
          Edits save as you leave each field; sending uses the normal CRM review workflow.
        </div>
      </div>
    </div>
  );
}
