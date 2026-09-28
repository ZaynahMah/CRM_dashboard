"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  listCampaigns, updateCampaign, lockCategoryInput, unlockCategoryInput,
  submitContentRow, saveContentRow, log,
} from "@/services/campaigns";
import { fmtDate, fmtTime, weekStart, weekLabel, fmtWeekRange } from "@/lib/format";
import {
  categoryErrors, draftFromCampaign, draftIsLockable, draftIsSavable, draftToPatch,
  isCategoryComplete, legacyDateTimeNote, isDateTimeLocal,
  type CategoryDraft,
} from "@/lib/categoryValidation";
import { SearchSelect } from "./SearchSelect";
import { Button, Card, Field, Loading, Pill, Tabs, Empty } from "./ui";
import { HEADER_LIMIT, SUB_COPY_LIMIT } from "@/lib/workflow";
import { Icon } from "./icons";
import masterData from "@/data/masterData.json";
import type { Campaign } from "@/types/campaign";

interface Props {
  profileId: string;
  role: "CATEGORY" | "CONTENT";
  onOpenCampaign: (id: string) => void;
  /** Only CRM can reopen a locked row — RLS policy 12 forbids it for CATEGORY. */
  canUnlock?: boolean;
}

/**
 * Category: sees whatever CRM has actually sent (crm_status advanced past
 * NOT_STARTED) and fills Sub Category / Brand / Offer / etc.
 * Content: sees whatever CRM has routed to Content.
 * Driven entirely by workflow status, not by a hardcoded month.
 *
 * Category editing is per row and per UUID throughout: every draft lives in
 * a map keyed by campaign id, every write names one id, and nothing is
 * shared between rows. See the note above `patchRowLocally` for why saving
 * no longer refetches the list.
 */
export function IncomingData({ profileId, role, onOpenCampaign, canUnlock = false }: Props) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [tab, setTab] = useState("pending");

  // Editing state, all keyed by campaign UUID.
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, CategoryDraft>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [showErrorsFor, setShowErrorsFor] = useState<Record<string, boolean>>({});
  const [rowMessage, setRowMessage] = useState<Record<string, string>>({});

  const loadData = useCallback(async () => {
    setLoading(true);
    const all = await listCampaigns();
    const filtered = role === "CATEGORY"
      ? all.filter((c) => c.crm_status !== "NOT_STARTED" && !c.is_crm_self)
      : all.filter((c) =>
          c.crm_status === "SENT_TO_CONTENT" || c.content_status === "PENDING" ||
          c.content_status === "SUBMITTED" || c.content_status === "NEEDS_CHANGES"
        );
    setCampaigns(filtered);
    setLoading(false);
  }, [role]);

  useEffect(() => { loadData(); }, [loadData]);

  /**
   * Applies a saved change to the one row it belongs to, in place, instead
   * of refetching the whole list.
   *
   * The old code called loadData() after every field blur, which set
   * loading=true and replaced the entire table with a spinner. That is what
   * closed open dropdowns, discarded half-typed input, remounted every row,
   * and threw scroll position back to the top of the page on every single
   * field. The write is already confirmed by the time this runs — the row
   * state and the database agree — so there is nothing to re-read.
   */
  const patchRowLocally = useCallback((id: string, patch: Partial<Campaign>) => {
    setCampaigns((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } as Campaign : c)));
  }, []);

  const pending = useMemo(() => campaigns.filter((c) =>
    role === "CATEGORY" ? !isCategoryComplete(c) : c.content_status !== "SUBMITTED"
  ), [campaigns, role]);

  const completed = useMemo(() => campaigns.filter((c) =>
    role === "CATEGORY" ? isCategoryComplete(c) : c.content_status === "SUBMITTED"
  ), [campaigns, role]);

  /* ---------- per-row draft handling (Category only) ---------- */

  const draftFor = useCallback((c: Campaign): CategoryDraft =>
    drafts[c.id] ?? draftFromCampaign(c), [drafts]);

  const openEditor = useCallback((c: Campaign) => {
    // Seed this row's draft from this row only, and only if it has no draft
    // yet — reopening a row must not discard what the user already typed.
    setDrafts((prev) => (prev[c.id] ? prev : { ...prev, [c.id]: draftFromCampaign(c) }));
    setOpenRowId((cur) => (cur === c.id ? null : c.id));
  }, []);

  const setField = useCallback((c: Campaign, field: keyof CategoryDraft, value: string) => {
    setDrafts((prev) => {
      const base = prev[c.id] ?? draftFromCampaign(c);
      return { ...prev, [c.id]: { ...base, [field]: value } };
    });
    setRowMessage((prev) => (prev[c.id] ? { ...prev, [c.id]: "" } : prev));
  }, []);

  const saveRow = useCallback(async (c: Campaign) => {
    const draft = drafts[c.id] ?? draftFromCampaign(c);
    if (!draftIsSavable(draft)) {
      setShowErrorsFor((p) => ({ ...p, [c.id]: true }));
      setRowMessage((p) => ({ ...p, [c.id]: "Fix the highlighted numbers before saving." }));
      return;
    }
    setSavingId(c.id);
    try {
      // Saving never locks. Locking is an explicit, separate action — the
      // old auto-lock on "brand and offer are filled" locked rows the user
      // had not finished with.
      const nextStatus = c.category_status === "LOCKED" ? c.category_status : "DRAFT";
      const patch = { ...draftToPatch(draft), category_status: nextStatus } as Partial<Campaign>;
      const saved = await updateCampaign(c.id, patch);
      patchRowLocally(c.id, saved);
      setRowMessage((p) => ({ ...p, [c.id]: "Saved." }));
    } catch (e) {
      setRowMessage((p) => ({ ...p, [c.id]: e instanceof Error ? e.message : "Could not save this row." }));
    }
    setSavingId(null);
  }, [drafts, patchRowLocally]);

  const lockRow = useCallback(async (c: Campaign) => {
    const draft = drafts[c.id] ?? draftFromCampaign(c);
    if (!draftIsLockable(draft)) {
      setShowErrorsFor((p) => ({ ...p, [c.id]: true }));
      setRowMessage((p) => ({ ...p, [c.id]: "Every field marked * must be filled before this row can be locked." }));
      return;
    }
    setSavingId(c.id);
    try {
      // Save this row's values first, then lock this row's id. Two writes,
      // both scoped to c.id, neither touching any other campaign.
      const saved = await updateCampaign(c.id, draftToPatch(draft));
      await lockCategoryInput(c.id, profileId);
      patchRowLocally(c.id, { ...saved, category_status: "LOCKED", crm_status: "AWAITING_REVIEW" } as Partial<Campaign>);
      setRowMessage((p) => ({ ...p, [c.id]: "" }));
      setOpenRowId((cur) => (cur === c.id ? null : cur));
    } catch (e) {
      setRowMessage((p) => ({ ...p, [c.id]: e instanceof Error ? e.message : "Could not lock this row." }));
    }
    setSavingId(null);
  }, [drafts, profileId, patchRowLocally]);

  const unlockRow = useCallback(async (c: Campaign) => {
    setSavingId(c.id);
    try {
      await unlockCategoryInput(c.id, profileId);
      patchRowLocally(c.id, { category_status: "DRAFT" } as Partial<Campaign>);
    } catch (e) {
      setRowMessage((p) => ({ ...p, [c.id]: e instanceof Error ? e.message : "Could not reopen this row." }));
    }
    setSavingId(null);
  }, [profileId, patchRowLocally]);

  /**
   * Bulk lock. Kept, but it now states its scope in the label and applies
   * exactly the same validation as the per-row action — it locks only rows
   * that are genuinely complete, and skips the rest instead of locking a
   * half-filled row. Each iteration writes one UUID.
   */
  const handleBulkSubmit = async () => {
    setSubmitting(true);
    try {
      if (role === "CATEGORY") {
        const eligible = campaigns.filter((c) =>
          c.category_status !== "LOCKED" && draftIsLockable(drafts[c.id] ?? draftFromCampaign(c))
        );
        for (const c of eligible) {
          await updateCampaign(c.id, draftToPatch(drafts[c.id] ?? draftFromCampaign(c)));
          await lockCategoryInput(c.id, profileId);
          patchRowLocally(c.id, { category_status: "LOCKED", crm_status: "AWAITING_REVIEW" } as Partial<Campaign>);
        }
        alert(`${eligible.length} row${eligible.length === 1 ? "" : "s"} locked and submitted to CRM.`);
      } else {
        const toSubmit = campaigns.filter((c) => c.content_status === "PENDING");
        for (let i = 0; i < toSubmit.length; i += 50) {
          const slice = toSubmit.slice(i, i + 50);
          await Promise.all(slice.map((c) =>
            updateCampaign(c.id, { content_status: "SUBMITTED", crm_status: "FINAL_QC" })
          ));
        }
        await log(null, profileId, "CONTENT_BULK_SUBMIT", `CONTENT submitted ${toSubmit.length} campaigns to CRM.`);
        await loadData();
        alert(`${toSubmit.length} campaigns submitted to CRM.`);
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Submission failed");
    }
    setSubmitting(false);
  };

  if (loading) return <Loading label="Loading incoming campaigns" />;

  if (campaigns.length === 0) {
    return (
      <Card>
        <Empty title="Nothing waiting on you right now"
          hint={role === "CATEGORY"
            ? "CRM hasn't sent any campaign slots yet. Check back once they've uploaded and sent the input file."
            : "CRM hasn't handed over any campaigns for creative input yet."} />
      </Card>
    );
  }

  /* ---------- Category: weekly buckets ---------- */

  // Category works a week at a time: rows are filled across the week, locked
  // individually as they are finished, then submitted as a weekly batch.
  // Both buckets are keyed by the Monday of the launch week.
  const weeks = useMemo(() => {
    if (role !== "CATEGORY") return [];
    const map = new Map<string, { pending: Campaign[]; submitted: Campaign[] }>();
    for (const c of campaigns) {
      const key = weekStart(c.launch_date);
      const bucket = map.get(key) ?? { pending: [], submitted: [] };
      (c.category_status === "LOCKED" ? bucket.submitted : bucket.pending).push(c);
      map.set(key, bucket);
    }
    return [...map.entries()].sort(([x], [y]) => x.localeCompare(y));
  }, [campaigns, role]);

  const lockableInWeek = useCallback((weekRows: Campaign[]) =>
    weekRows.filter((c) => c.category_status !== "LOCKED"
      && draftIsLockable(drafts[c.id] ?? draftFromCampaign(c))), [drafts]);

  /**
   * Weekly bulk submit. Locks every complete row in ONE week, one UUID at a
   * time, and skips anything still missing a mandatory field rather than
   * locking it half-filled. Rows can equally be locked one at a time from
   * the row itself — this is a convenience, not the only route.
   */
  const submitWeek = async (weekKey: string, weekRows: Campaign[]) => {
    const eligible = lockableInWeek(weekRows);
    if (eligible.length === 0) return;
    setSubmitting(true);
    try {
      for (const c of eligible) {
        await updateCampaign(c.id, draftToPatch(drafts[c.id] ?? draftFromCampaign(c)));
        await lockCategoryInput(c.id, profileId);
        patchRowLocally(c.id, { category_status: "LOCKED", crm_status: "AWAITING_REVIEW" } as Partial<Campaign>);
      }
      await log(null, profileId, "CATEGORY_WEEK_SUBMITTED",
        `Category submitted ${eligible.length} rows for the week of ${weekKey}.`);
      alert(`${eligible.length} row${eligible.length === 1 ? "" : "s"} submitted to CRM for ${fmtWeekRange(weekKey)}.`);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Weekly submit failed.");
    }
    setSubmitting(false);
  };

  if (role === "CATEGORY") {
    const totalPending = weeks.reduce((n, [, w]) => n + w.pending.length, 0);
    const totalSubmitted = weeks.reduce((n, [, w]) => n + w.submitted.length, 0);

    return (
      <div className="space-y-5">
        <div>
          <h3 className="font-display text-[16px] font-600 text-heading">Incoming Data</h3>
          <p className="text-tiny text-muted">
            {totalPending} pending from Category · {totalSubmitted} submitted back to CRM · {campaigns.length} total
          </p>
        </div>

        {weeks.map(([weekKey, week]) => {
          const eligible = lockableInWeek(week.pending);
          return (
            <Card key={weekKey} pad={false}>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
                <div className="flex items-center gap-2">
                  <span className="font-display text-[14px] font-600 text-heading">{weekLabel(weekKey)}</span>
                  <span className="text-micro text-faint">{fmtWeekRange(weekKey)}</span>
                </div>
                {eligible.length > 0 && (
                  <Button size="sm" disabled={submitting} onClick={() => submitWeek(weekKey, week.pending)}>
                    {submitting ? "Submitting..." : `Submit ${eligible.length} to CRM`}
                  </Button>
                )}
              </div>

              <Bucket
                title="Pending from Category"
                tone="warning"
                count={week.pending.length}
                empty="Everything this week has been submitted."
              >
                {week.pending.map((c) => (
                  <CategoryRow
                    key={c.id}
                    campaign={c}
                    draft={draftFor(c)}
                    isOpen={openRowId === c.id}
                    saving={savingId === c.id}
                    showErrors={Boolean(showErrorsFor[c.id])}
                    message={rowMessage[c.id] ?? ""}
                    canUnlock={canUnlock}
                    onToggle={() => openEditor(c)}
                    onField={(f, v) => setField(c, f, v)}
                    onSave={() => saveRow(c)}
                    onLock={() => lockRow(c)}
                    onUnlock={() => unlockRow(c)}
                    onOpenDrawer={() => onOpenCampaign(c.id)}
                  />
                ))}
              </Bucket>

              <Bucket
                title="Submitted back to CRM"
                tone="success"
                count={week.submitted.length}
                empty="Nothing submitted for this week yet."
              >
                {week.submitted.map((c) => (
                  <CategoryRow
                    key={c.id}
                    campaign={c}
                    draft={draftFor(c)}
                    isOpen={false}
                    saving={savingId === c.id}
                    showErrors={false}
                    message={rowMessage[c.id] ?? ""}
                    canUnlock={canUnlock}
                    onToggle={() => openEditor(c)}
                    onField={(f, v) => setField(c, f, v)}
                    onSave={() => saveRow(c)}
                    onLock={() => lockRow(c)}
                    onUnlock={() => unlockRow(c)}
                    onOpenDrawer={() => onOpenCampaign(c.id)}
                  />
                ))}
              </Bucket>
            </Card>
          );
        })}
      </div>
    );
  }

  /* ---------- Content: split by origin ---------- */

  // Emergencies get their own bucket rather than being buried in the other
  // two — they jump the queue by definition, so they need to be findable
  // without scrolling a hundred normal rows.
  const emergencies = campaigns.filter((c) => c.is_emergency);
  const withCategoryInput = campaigns.filter((c) => !c.is_crm_self && !c.is_emergency);
  const crmOwned = campaigns.filter((c) => c.is_crm_self && !c.is_emergency);
  const contentRows = tab === "crm_owned" ? crmOwned
    : tab === "emergency" ? emergencies
    : withCategoryInput;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-[16px] font-600 text-heading">Incoming Data</h3>
          <p className="text-tiny text-muted">
            {pending.length} awaiting copy · {completed.length} submitted · {campaigns.length} total
          </p>
        </div>
      </div>

      {/* Two buckets, because the two kinds of PN read differently: one
          arrives with Category's brand/offer/brief filled in, the other is
          CRM's own and has no Category block at all. */}
      <Tabs active={tab} onChange={setTab} tabs={[
        { key: "pending", label: "PNs with Category Input", count: withCategoryInput.length },
        { key: "crm_owned", label: "CRM-Owned PNs", count: crmOwned.length },
        ...(emergencies.length > 0
          ? [{ key: "emergency", label: "Emergency", count: emergencies.length }]
          : []),
      ]} />

      <Card pad={false} className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px]">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-[#F9FAFB]">Day</th>
                <th>Time</th><th>Segment</th><th>Category</th>
                <th>Header</th><th>Sub Copy</th><th>H</th><th>S</th><th>Ref Link</th>
                <th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {contentRows.slice(0, 100).map((c) => (
                <ContentRow key={c.id} campaign={c} profileId={profileId}
                  onSaved={(patch) => patchRowLocally(c.id, patch)}
                  onOpen={() => onOpenCampaign(c.id)} />
              ))}
            </tbody>
          </table>
          {contentRows.length === 0 && (
            <div className="px-5 py-8 text-center text-tiny text-muted">
              Nothing in this bucket right now.
            </div>
          )}
          {contentRows.length > 100 && (
            <div className="border-t border-line px-4 py-3 text-tiny text-muted">
              Showing 100 of {contentRows.length} — use All Campaigns to search the rest
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

/** A labelled group of rows inside a week card. */
function Bucket({ title, tone, count, empty, children }: {
  title: string; tone: "warning" | "success"; count: number; empty: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-line last:border-b-0">
      <div className="flex items-center gap-2 bg-[#FCFCFD] px-5 py-2.5">
        <span className="text-micro font-medium uppercase tracking-wide text-faint">{title}</span>
        <Pill dot={false} label={String(count)} tone={tone} />
      </div>
      {count === 0 ? (
        <p className="px-5 py-3 text-tiny text-faint">{empty}</p>
      ) : (
        <table className="w-full">
          <tbody>{children}</tbody>
        </table>
      )}
    </div>
  );
}

/* ───────────────────────── Category row ───────────────────────── */

function CategoryRow({
  campaign: c, draft, isOpen, saving, showErrors, message, canUnlock,
  onToggle, onField, onSave, onLock, onUnlock, onOpenDrawer,
}: {
  campaign: Campaign;
  draft: CategoryDraft;
  isOpen: boolean;
  saving: boolean;
  showErrors: boolean;
  message: string;
  canUnlock: boolean;
  onToggle: () => void;
  onField: (field: keyof CategoryDraft, value: string) => void;
  onSave: () => void;
  onLock: () => void;
  onUnlock: () => void;
  onOpenDrawer: () => void;
}) {
  const locked = c.category_status === "LOCKED";
  const errors = categoryErrors(draft);
  const complete = isCategoryComplete(c);
  const legacyNote = legacyDateTimeNote(draft.date_time_brief);

  return (
    <>
      <tr>
        <td className="whitespace-nowrap text-tiny font-medium text-heading">{fmtDate(c.launch_date)}</td>
        <td className="whitespace-nowrap text-tiny text-muted">{fmtTime(c.launch_time)}</td>
        <td><Pill dot={false} label={c.pncc_segment_label ?? "—"} tone="indigo" /></td>
        <td><Pill dot={false} label={c.pncc_category_code ?? c.category ?? "—"} tone="neutral" /></td>
        <td className="text-tiny text-muted">{c.brand ?? "—"}</td>
        <td className="text-tiny text-muted">{c.offer ?? "—"}</td>
        <td>
          {locked
            ? <Pill label="Locked" tone="indigo" />
            : <Pill label={complete ? "Complete" : "Incomplete"} tone={complete ? "success" : "warning"} />}
        </td>
        <td className="text-right">
          <div className="flex justify-end gap-2">
            {locked ? (
              canUnlock ? (
                <Button size="sm" variant="ghost" disabled={saving} onClick={onUnlock}>Unlock</Button>
              ) : (
                <span className="text-micro text-faint">Submitted</span>
              )
            ) : (
              <Button size="sm" variant={isOpen ? "subtle" : "ghost"} onClick={onToggle}>
                {isOpen ? "Close" : "Open"}
              </Button>
            )}
            <button onClick={onOpenDrawer} className="text-micro font-medium text-indigo-700 hover:underline">
              Details
            </button>
          </div>
        </td>
      </tr>

      {isOpen && !locked && (
        <tr>
          {/* The editor spans the full table width and belongs to exactly one
              campaign UUID. Nothing here reads or writes any other row. */}
          <td colSpan={8} className="!p-0">
            <div className="border-t border-line bg-[#FCFCFD] px-5 py-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-600 text-heading">{c.campaign_name}</span>
                <Pill dot={false} label={fmtDate(c.launch_date)} tone="neutral" />
                <span className="font-mono text-[10px] text-faint">{c.id}</span>
              </div>

              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                <Field label="Sub Category">
                  <input value={draft.sub_category} onChange={(e) => onField("sub_category", e.target.value)} />
                </Field>

                <Field label="Brand" required hint={showErrors ? errors.brand : undefined} error={Boolean(showErrors && errors.brand)}>
                  <SearchSelect portal allowCreate value={draft.brand} onChange={(v) => onField("brand", v)}
                    options={masterData.brands} placeholder="Search or add a brand" />
                </Field>

                {/* Free text: the offer wording is written per campaign and a
                    fixed list was rejecting legitimate values. */}
                <Field label="Offer" required hint={showErrors ? errors.offer : undefined} error={Boolean(showErrors && errors.offer)}>
                  <input value={draft.offer} onChange={(e) => onField("offer", e.target.value)}
                    placeholder="e.g. Flat 40% off" />
                </Field>

                <Field label="Landing Link" required hint={showErrors ? errors.landing : undefined} error={Boolean(showErrors && errors.landing)}>
                  <input value={draft.landing} onChange={(e) => onField("landing", e.target.value)}
                    placeholder="https://..." />
                </Field>

                {/* inputMode="decimal" raises the numeric keypad on mobile;
                    the real rule is enforced by categoryErrors(), not by the
                    input type, so a paste of "2.5%" is caught and explained
                    rather than silently dropped by the browser. */}
                <Field label="Expected CVR" required
                  hint={errors.expected_cvr && (showErrors || draft.expected_cvr.trim()) ? errors.expected_cvr : "Number only, decimals allowed"}
                  error={Boolean(errors.expected_cvr && (showErrors || draft.expected_cvr.trim()))}>
                  <input inputMode="decimal" value={draft.expected_cvr}
                    onChange={(e) => onField("expected_cvr", e.target.value)} placeholder="2.5" />
                </Field>

                <Field label="Expected RPV" required
                  hint={errors.expected_rpv && (showErrors || draft.expected_rpv.trim()) ? errors.expected_rpv : "Number only, decimals allowed"}
                  error={Boolean(errors.expected_rpv && (showErrors || draft.expected_rpv.trim()))}>
                  <input inputMode="decimal" value={draft.expected_rpv}
                    onChange={(e) => onField("expected_rpv", e.target.value)} placeholder="450.75" />
                </Field>

                <Field label="Date / Time Brief"
                  hint={legacyNote ? `Existing note kept until you pick a date: “${legacyNote}”` : "Optional — when the brand wants this placed"}>
                  <input type="datetime-local"
                    value={isDateTimeLocal(draft.date_time_brief) ? draft.date_time_brief : ""}
                    onChange={(e) => onField("date_time_brief", e.target.value)} />
                </Field>
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <Field label="Brief" required hint={showErrors ? errors.brief : undefined} error={Boolean(showErrors && errors.brief)}>
                  <textarea rows={2} value={draft.brief} onChange={(e) => onField("brief", e.target.value)} />
                </Field>
                <Field label="Comments">
                  <textarea rows={2} value={draft.additional_notes} onChange={(e) => onField("additional_notes", e.target.value)} />
                </Field>
              </div>

              {message && (
                <div className={`mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-tiny ${
                  message === "Saved."
                    ? "bg-success-50 text-success-700"
                    : "bg-danger-50 text-danger-700"}`}>
                  {message === "Saved." ? Icon.check(13) : Icon.alert(13)} <span>{message}</span>
                </div>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button size="sm" variant="ghost" disabled={saving} onClick={onSave}>
                  {saving ? "Saving..." : "Save draft"}
                </Button>
                <Button size="sm" disabled={saving} onClick={onLock}>
                  {Icon.check(13)} Lock Input
                </Button>
                <span className="text-micro text-faint">
                  Locking submits this row to CRM. Only CRM can reopen it afterwards.
                </span>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/* ───────────────────────── Content row ───────────────────────── */

/**
 * These rows used to be inert — `defaultValue=""` with no handler, so
 * nothing Content typed here was ever saved. They now write for real, and
 * H/S counts are derived from the text rather than typed.
 */
function ContentRow({ campaign: c, profileId, onSaved, onOpen }: {
  campaign: Campaign; profileId: string;
  onSaved: (patch: Partial<Campaign>) => void;
  onOpen: () => void;
}) {
  const [header, setHeader] = useState(c.header ?? "");
  const [subCopy, setSubCopy] = useState(c.sub_copy_text ?? "");
  const [refLink, setRefLink] = useState(c.reference_link ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitted = c.content_status === "SUBMITTED";
  const hCount = header.trim().length;
  const sCount = subCopy.trim().length;

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const saved = await submitContentRow(c.id,
        { header, sub_copy_text: subCopy, reference_link: refLink }, profileId);
      // Immediate UI update from the confirmed row, no refetch.
      onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit.");
    }
    setBusy(false);
  };

  const saveDraft = async () => {
    setBusy(true); setError(null);
    try {
      const saved = await saveContentRow(c.id,
        { header, sub_copy_text: subCopy, reference_link: refLink });
      onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    }
    setBusy(false);
  };

  return (
    <tr>
      <td className="sticky left-0 z-10 bg-surface whitespace-nowrap text-tiny font-medium text-heading">
        {fmtDate(c.launch_date)}
      </td>
      <td className="whitespace-nowrap text-tiny text-muted">{fmtTime(c.launch_time)}</td>
      <td><Pill dot={false} label={c.pncc_segment_label ?? "—"} tone="indigo" /></td>
      <td>
        <Pill dot={false} label={c.pncc_category_code ?? c.category ?? "—"} tone="neutral" />
        {c.is_emergency && <Pill label="Emergency" tone="danger" />}
      </td>
      <td className="min-w-[180px]">
        <input className={`!py-1 !text-tiny ${hCount > HEADER_LIMIT ? "!border-[#FECDCA]" : ""}`}
          value={header} disabled={submitted || busy}
          onChange={(e) => setHeader(e.target.value)} onBlur={saveDraft} placeholder="Header" />
      </td>
      <td className="min-w-[180px]">
        <input className={`!py-1 !text-tiny ${sCount > SUB_COPY_LIMIT ? "!border-[#FECDCA]" : ""}`}
          value={subCopy} disabled={submitted || busy}
          onChange={(e) => setSubCopy(e.target.value)} onBlur={saveDraft} placeholder="Sub copy" />
      </td>
      {/* Derived, never typed. */}
      <td className={`text-tiny tabular-nums ${hCount > HEADER_LIMIT ? "text-danger-700" : "text-muted"}`}>{hCount}</td>
      <td className={`text-tiny tabular-nums ${sCount > SUB_COPY_LIMIT ? "text-danger-700" : "text-muted"}`}>{sCount}</td>
      <td className="min-w-[140px]">
        <input className="!py-1 !text-tiny" value={refLink} disabled={submitted || busy}
          onChange={(e) => setRefLink(e.target.value)} onBlur={saveDraft} placeholder="Link" />
      </td>
      <td>
        {submitted
          ? <Pill label="Content Submitted" tone="success" />
          : <Pill label="Pending" tone="warning" />}
        {error && <div className="mt-1 text-micro text-danger-700">{error}</div>}
      </td>
      <td className="whitespace-nowrap">
        <div className="flex items-center gap-2">
          {!submitted && (
            <Button size="sm" disabled={busy || !header.trim() || !subCopy.trim()} onClick={submit}>
              {busy
                ? <><span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" /> Submitting</>
                : "Submit"}
            </Button>
          )}
          <button onClick={onOpen} className="text-micro font-medium text-indigo-700 hover:underline">Open</button>
        </div>
      </td>
    </tr>
  );
}
