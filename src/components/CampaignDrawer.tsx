"use client";

import { useCallback, useEffect, useState } from "react";
import type { ActivityLog, Campaign, QcChecklist } from "@/types/campaign";
import type { Profile } from "@/types/user";
import * as api from "@/services/campaigns";
import { fmtLongDate, fmtRelative, fmtTime, titleCase, slotDisplay } from "@/lib/format";
import {
  QC_FIELDS, qcComplete, creativeRequired, QC_NA_LABEL, stageOf,
  HEADER_LIMIT, SUB_COPY_LIMIT,
} from "@/lib/workflow";
import { trackingCheck, suggestTrackingFields } from "@/lib/trackingCode";
import { CHANNEL_FORMATS, LANDING_VALUES } from "@/lib/trackingMasters";
import { FIXED_TRACKING_VALUES } from "@/lib/trackingFields";
import {
  categoryErrors, draftFromCampaign, draftIsLockable, draftIsSavable, draftToPatch,
  isDateTimeLocal, legacyDateTimeNote, type CategoryDraft,
} from "@/lib/categoryValidation";
import { Button, Card, Drawer, Field, Modal, Pill } from "./ui";
import { SearchSelect } from "./SearchSelect";
import { Icon } from "./icons";
import masterData from "@/data/masterData.json";

const SUB_CATEGORIES = ['Kurtas & Suit Sets', 'Sportswear', 'Dresses & Jumpsuits', 'Sports Shoes', 'Sling bags', 'Everyday Athleisure', 'Kids Apparel', 'Overall Indianwear', 'Overall - Bestseller', 'Skincare', 'Fine Jewellery', 'Formalwear', 'Makeup', 'Sandal', 'Analog & Digital', 'Herbal supplements', 'Shirts, T-shirts', 'Jeans', 'Handbags', 'Overall Hair', 'Sunglasses', 'Tshirt', 'Bed-Linen', 'Polos', 'Sneaker', 'Bedsheet', 'Bottomwear', 'Kurtas', 'Lingerie', 'Watches', 'Accessories', 'Formal wear', 'Top brands', 'Bras', 'Heels, Comfort, Ethnic', 'Footwear', 'Boys Clothing', 'Skin Care', 'Gold Jewellery', 'Premium Whey Proteins', 'Furnishing', 'Perfumes', 'Sleepwear', 'Diamond Jewellery', 'Audio', 'Speakers', 'Kitchen & Appliances', 'Decor', 'Furniture Overall', 'Shorts', 'T-shirts', 'Dresses', 'Western Wear', 'Casual wear', 'Ethnic Sets', 'Makeup essentials'];

const TIME_SLOTS: string[] = (masterData as { timeSlots?: string[] }).timeSlots ?? [];
const SEGMENT_OPTIONS: string[] = (masterData as { segments?: string[] }).segments ?? [];
const CATEGORY_OPTIONS: string[] = (masterData as { categories?: string[] }).categories ?? [];

export function CampaignDrawer({ campaignId, profile, onClose, onChanged }: {
  campaignId: string | null; profile: Profile; onClose: () => void; onChanged: () => void;
}) {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [qc, setQc] = useState<QcChecklist | null>(null);
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [pushOpen, setPushOpen] = useState(false);
  /** Shown inside the modal when the backend refuses the finalization. */
  const [pushError, setPushError] = useState<string | null>(null);
  /** Visible confirmation that the write actually landed. */
  const [pushDone, setPushDone] = useState<string | null>(null);
  const [genBusy, setGenBusy] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [requestChangesOpen, setRequestChangesOpen] = useState(false);
  const [changeReason, setChangeReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!campaignId) return;
    const r = await api.getCampaign(campaignId);
    setCampaign(r.campaign); setQc(r.qc); setLogs(r.logs);
  }, [campaignId]);

  /**
   * Clearing state before the fetch is load-bearing, not tidiness. This
   * drawer is rendered unconditionally on every page and returns null when
   * closed, so the component instance survives switching from one campaign
   * to another. Without this reset there is a window where `campaignId` is
   * already row B while `campaign` still holds row A — and the child forms,
   * which seed their state from the `campaign` prop, would keep row A's
   * values and write them to row B on save.
   */
  useEffect(() => {
    setCampaign(null); setQc(null); setLogs([]);
    load();
  }, [load]);

  if (!campaignId || !campaign) return null;

  const role = profile.role;
  const stage = stageOf(campaign);
  const refresh = async () => { await load(); onChanged(); };
  const hasCategoryInput = Boolean(campaign.brand && campaign.offer);
  // CRM's review decision gates Part 2 — this is what makes "CRM Review" a
  // real step rather than something implied by just filling in fields later.
  const awaitingCrmReview = campaign.category_status === "LOCKED" && campaign.crm_status === "AWAITING_REVIEW";
  const crmApproved = campaign.crm_status !== "NOT_STARTED" && campaign.crm_status !== "AWAITING_REVIEW";
  // Creative verification only applies when a creative link exists (#7).
  const qcPassed = qcComplete(qc, campaign);
  const creativeNeeded = creativeRequired(campaign);
  // #2: the drawer must enforce the tracking code exactly as Bulk Push does.
  const tracking = trackingCheck(suggestTrackingFields(campaign));
  /**
   * The PERSISTED code, not merely "the fields look complete".
   *
   * The check above validates the input fields. A green state was shown
   * while `tracking_code` in the database was still null, which is exactly
   * what let a user reach Update Calendar and be refused.
   */
  const hasPersistedCode =
    Boolean((campaign.tracking_code ?? "").trim())
    && (campaign.tracking_code ?? "").startsWith("cid=");

  const save = async (patch: Partial<Campaign>) => {
    await api.updateCampaign(campaign.id, patch);
    await refresh();
  };

  const logAndSave = async (patch: Partial<Campaign>, action: string, desc: string) => {
    await api.updateCampaign(campaign.id, patch);
    await api.log(campaign.id, profile.id, action, desc);
    await refresh();
  };

  return (
    <Drawer open onClose={onClose}>
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-line bg-surface px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Pill dot={false} label={campaign.pncc_segment_label ?? "—"} tone="indigo" />
              <Pill dot={false} label={campaign.pncc_category_code ?? campaign.category ?? "—"} tone="neutral" />
              <Pill label={hasCategoryInput ? "Cat filled" : "Pending"} tone={hasCategoryInput ? "success" : "warning"} />
              {campaign.is_emergency && <Pill label="Emergency" tone="danger" />}
              {campaign.is_crm_self && <Pill dot={false} label="CRM Self PN" tone="indigo" />}
              {campaign.calendar_status === "UPDATED" && <Pill label="In Calendar" tone="success" />}
            </div>
            <h2 className="mt-2 font-display text-[18px] font-700 text-heading">{campaign.campaign_name}</h2>
            <p className="mt-1 flex items-center gap-3 text-tiny text-muted">
              {Icon.calendar(12)} {fmtLongDate(campaign.launch_date)} · {fmtTime(campaign.launch_time)}
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-faint hover:text-body">✕</button>
        </div>
      </div>

      <div className="space-y-3 p-5">

        {/* ── PART 1: CRM Scheduling ── */}
        <Block title="Part 1 — CRM Scheduling" tag="CRM" tagColor="indigo">
          {role === "CRM" ? (
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Date">
                <input type="date" defaultValue={campaign.launch_date}
                  onBlur={(e) => save({ launch_date: e.target.value })} />
              </Field>
              <Field label="Time">
                <select defaultValue={campaign.launch_time ?? ""}
                  onChange={(e) => save({ launch_time: e.target.value })}>
                  {TIME_SLOTS.map((t) => <option key={t} value={t}>{fmtTime(t)}</option>)}
                </select>
              </Field>
              <Field label="Slot type">
                <select defaultValue={campaign.slot_type ?? "STANDARD"}
                  onChange={(e) => save({ slot_type: e.target.value })}>
                  <option value="STANDARD">Standard</option>
                  <option value="ADDITIONAL">Additional</option>
                </select>
              </Field>
              <Field label="Segment">
                <SearchSelect value={campaign.pncc_segment_label ?? ""}
                  onChange={(v) => save({ pncc_segment_label: v, campaign_name: `${v} · ${campaign.pncc_category_code ?? ""}` })}
                  options={SEGMENT_OPTIONS} placeholder="Select segment" />
              </Field>
              <Field label="Category">
                <SearchSelect value={campaign.pncc_category_code ?? ""}
                  onChange={(v) => save({ pncc_category_code: v, category: v, campaign_name: `${campaign.pncc_segment_label ?? ""} · ${v}` })}
                  options={CATEGORY_OPTIONS} placeholder="Select category" />
              </Field>
            </div>
          ) : (
            <ReadGrid rows={[
              ["Date", fmtLongDate(campaign.launch_date)],
              ["Time", fmtTime(campaign.launch_time)],
              // Shows the RAW uploaded Slot. This previously rendered
              // `slot_type` ("Standard"), which is a different field.
              ["Slot", slotDisplay(campaign)],
              ["Segment", campaign.pncc_segment_label],
              ["Category", campaign.pncc_category_code ?? campaign.category],
            ]} />
          )}
          {role === "CRM" && campaign.crm_status === "NOT_STARTED" && (
            <div className="mt-4">
              <Button size="sm" onClick={() => logAndSave(
                { crm_status: "AWAITING_REVIEW" },
                "CRM_SENT_TO_CATEGORY", "CRM sent slots to Category team.")}>
                {Icon.send(13)} Send to Category Team
              </Button>
            </div>
          )}
        </Block>

        {/* ── CATEGORY INPUT ── */}
        <Block title="Category Input" tag="Category" tagColor="warning">
          {(role === "CATEGORY" || role === "CRM") ? (
            /* key={campaign.id} forces a fresh form instance per campaign.
               These forms seed their state from props once, so without a key
               React would reuse one instance across two different campaigns
               and carry the previous row's values into the next one. */
            <CategoryForm key={campaign.id} campaign={campaign} profileId={profile.id} onSaved={refresh} />
          ) : (
            <ReadGrid rows={[
              ["Sub Category", campaign.sub_category], ["Brand", campaign.brand],
              ["Offer", campaign.offer], ["Landing Link", campaign.landing],
              ["Expected CVR", campaign.expected_cvr], ["Expected RPV", campaign.expected_rpv],
              ["Category Brief", campaign.brief], ["Comments", campaign.additional_notes],
              ["Date/Time Brief", campaign.date_time_brief],
            ]} />
          )}
        </Block>

        {/* ── CRM REVIEW DECISION — the real gate between Category input and
             CRM completing its own fields. Nothing below this unlocks until
             CRM explicitly approves. ── */}
        {role === "CRM" && awaitingCrmReview && (
          <Card>
            <div className="mb-3 flex items-center gap-2">
              <h3 className="text-[13px] font-600 text-heading">CRM Review</h3>
              <Pill dot={false} label="Decision required" tone="warning" />
            </div>
            <p className="mb-3 text-tiny text-muted">
              Category has submitted. Approve to unlock CRM&rsquo;s own fields below, or send it back for changes.
            </p>
            <div className="flex gap-3">
              <Button size="sm" disabled={busy} onClick={async () => {
                setBusy(true);
                await logAndSave({ crm_status: "IN_PLANNING" }, "CRM_APPROVED", "CRM approved the Category submission.");
                setBusy(false);
              }}>
                {Icon.check(13)} Approve
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRequestChangesOpen(true)}>
                Request Changes
              </Button>
            </div>
          </Card>
        )}

        {/* ── PART 2: CRM Content Handoff — locked until CRM approves ── */}
        <Block title="Part 2 — CRM Content Handoff" tag="CRM" tagColor="indigo">
          {role === "CRM" ? (
            crmApproved ? (
              <>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Title Brief">
                    <input defaultValue={campaign.title_brief ?? ""}
                      onBlur={(e) => save({ title_brief: e.target.value })} />
                  </Field>
                  <Field label="Message Brief">
                    <input defaultValue={campaign.message_brief ?? ""}
                      onBlur={(e) => save({ message_brief: e.target.value })} />
                  </Field>
                  <Field label="PN Template">
                    <select defaultValue={campaign.pn_template ?? ""}
                      onChange={(e) => save({ pn_template: e.target.value })}>
                      <option value="">Select</option>
                      {["Basic","Bezel","Timer","Coloured BG"].map((t) => <option key={t}>{t}</option>)}
                    </select>
                  </Field>
                  <Field label="Creative Requirements">
                    <input defaultValue={campaign.creative_requirements ?? ""}
                      onBlur={(e) => save({ creative_requirements: e.target.value })} />
                  </Field>
                </div>
                {/* Content is the only production team, so this is the single
                    production handoff. design_status is not written. */}
                {hasCategoryInput && campaign.content_status === "NOT_ASSIGNED" && (
                  <div className="mt-4">
                    <Button size="sm" onClick={() => logAndSave(
                      { crm_status: "SENT_TO_CONTENT", content_status: "PENDING" },
                      "SENT_TO_CONTENT", "CRM sent this campaign to Content.")}>
                      {Icon.send(13)} Send to Content
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <p className="text-tiny text-muted">Approve the Category submission above to unlock these fields.</p>
            )
          ) : (
            <ReadGrid rows={[
              ["Title Brief", campaign.title_brief],
              ["Message Brief", campaign.message_brief],
              ["PN Template", campaign.pn_template],
              ["Creative Requirements", campaign.creative_requirements],
            ]} />
          )}
        </Block>

        {/* ── CONTENT TEAM INPUT ── */}
        <Block title="Content / Creative Input" tag="Content" tagColor="info">
          {(role === "CONTENT" || role === "CRM") ? (
            <ContentForm key={campaign.id} campaign={campaign} profileId={profile.id} onSaved={refresh} />
          ) : (
            <ReadGrid rows={[
              ["Header", campaign.header],
              ["Sub Copy", campaign.sub_copy_text],
              ["H Count", campaign.h_count],
              ["S Count", campaign.s_count],
              ["Reference Link", campaign.reference_link],
            ]} />
          )}
        </Block>

        {/* ── PART 3: CRM Final Operations + real QC checklist + Update Calendar ── */}
        {role === "CRM" && (
          <Block title="Part 3 — CRM Final QC & Tracking" tag="CRM" tagColor="indigo">
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Sound"><select defaultValue={campaign.sound ? "Yes" : "No"}
                onChange={(e) => save({ sound: e.target.value === "Yes" })}><option>No</option><option>Yes</option></select></Field>
              <Field label="GL"><select defaultValue={campaign.global_limit ? "Yes" : "No"}
                onChange={(e) => save({ global_limit: e.target.value === "Yes" })}><option>No</option><option>Yes</option></select></Field>
              {/* Entry method comes from lib/trackingFields.ts, shared with
                  Show All PN. Composition is unchanged. */}
              <Field label="Campaign Type" hint="fixed">
                <input readOnly value={FIXED_TRACKING_VALUES.campaign_type} />
              </Field>
              <Field label="Campaign Name" hint="fixed">
                <input readOnly value={FIXED_TRACKING_VALUES.campaign_name_code} />
              </Field>
              <Field label="Channel Name" hint="fixed">
                <input readOnly value={FIXED_TRACKING_VALUES.channel_name} />
              </Field>
              <TrackingSelect label="Channel Format" value={campaign.channel_format}
                options={CHANNEL_FORMATS} onPick={(v) => save({ channel_format: v })} />
              <Field label="Segment 1"><input defaultValue={campaign.segment_1 ?? ""}
                onBlur={(e) => save({ segment_1: e.target.value.trim() })} /></Field>
              <Field label="Segment 2"><input defaultValue={campaign.segment_2 ?? ""}
                onBlur={(e) => save({ segment_2: e.target.value.trim() })} /></Field>
              <Field label="Category (code)"><input defaultValue={campaign.tracking_category ?? ""}
                onBlur={(e) => save({ tracking_category: e.target.value.trim() })} /></Field>
              <Field label="Sub Category (code)"><input defaultValue={campaign.tracking_sub_category ?? ""}
                onBlur={(e) => save({ tracking_sub_category: e.target.value.trim() })} /></Field>
              <Field label="Brand (code)"><input defaultValue={campaign.tracking_brand ?? ""}
                onBlur={(e) => save({ tracking_brand: e.target.value.trim() })} /></Field>
              <TrackingSelect label="Landing (code)" value={campaign.tracking_landing}
                options={LANDING_VALUES} onPick={(v) => save({ tracking_landing: v })} />
              <Field label="Offer (code)"><input defaultValue={campaign.tracking_offer ?? ""}
                onBlur={(e) => save({ tracking_offer: e.target.value.trim() })} /></Field>
              <Field label="Keywords"><input defaultValue={campaign.keywords ?? ""}
                onBlur={(e) => save({ keywords: e.target.value.trim() })} /></Field>
              <Field label="Tracking Code check" hint={tracking.ok ? "" : tracking.detail}>
                <input readOnly disabled value={tracking.label} />
              </Field>
              <Field label="Tracking Code"
                hint={hasPersistedCode ? "" : "not generated yet"}>
                <input value={campaign.tracking_code ?? ""} readOnly
                  placeholder="Press Generate once the fields below are filled"
                  className={hasPersistedCode ? "" : "!border-[#FECDCA]"} />
              </Field>
              <Field label="Collapse ID"><input defaultValue={campaign.collapse ?? campaign.collapse_id ?? ""}
                onBlur={(e) => save({ collapse: e.target.value })} /></Field>
              {/* Group ID is ALSO written by the campaigns_sync_group trigger
                  (migration 04) whenever push_tag changes — a manual value
                  here survives until someone edits the tag. */}
              {/* Open decision: whether the manual value or the tag-derived
                  value should win is not yet settled with the CRM team, so
                  the trigger is left exactly as migration 04 wrote it and
                  the behaviour is stated here instead. */}
              <Field label="Group ID" hint="Editing Push Tag overwrites a manually entered Group ID">
                <input defaultValue={campaign.group_id ?? ""}
                  onBlur={(e) => save({ group_id: e.target.value })} /></Field>
              <Field label="Ops Details"><input defaultValue={campaign.ops_details ?? ""}
                onBlur={(e) => save({ ops_details: e.target.value })} /></Field>
              <Field label="Feedback 1" hint="Optional"><input defaultValue={campaign.feedback_1 ?? ""}
                onBlur={(e) => save({ feedback_1: e.target.value })} /></Field>
              <Field label="Feedback 2" hint="Optional"><input defaultValue={campaign.feedback_2 ?? ""}
                onBlur={(e) => save({ feedback_2: e.target.value })} /></Field>
            </div>

            {/* The real QC checklist — nothing below is reachable without it. */}
            <div className="mt-5 border-t border-line pt-4">
              <div className="mb-2 text-[12px] font-600 text-heading">Final QC checklist</div>
              <div className="grid gap-x-4 gap-y-1.5 md:grid-cols-2">
                {QC_FIELDS.map((f) => (
                  <label key={String(f.key)} className="flex cursor-pointer items-center gap-2.5 py-1">
                    <input type="checkbox" checked={Boolean(qc?.[f.key])}
                      onChange={async (e) => {
                        await api.saveQc(campaign.id, { [f.key]: e.target.checked } as Partial<QcChecklist>);
                        await refresh();
                      }} />
                    <span className="text-tiny text-body">{f.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              <Button size="sm" disabled={!qcPassed || !tracking.ok || !hasPersistedCode} onClick={() => logAndSave(
                { qc_status: "PASSED" },
                "FINAL_QC_COMPLETED", "CRM completed final QC.")}>
                {Icon.check(13)} Mark QC Complete
              </Button>
              {/* Generating lives here because the drawer previously had no
                  way to produce a code at all — the field was free text and
                  update_calendar() then refused the row. */}
              <Button size="sm" variant="ghost" disabled={genBusy}
                onClick={async () => {
                  setGenBusy(true); setGenError(null);
                  try {
                    await api.generateTrackingCode(campaign);
                    await refresh();
                  } catch (e) {
                    setGenError(e instanceof Error ? e.message : String(e));
                  }
                  setGenBusy(false);
                }}>
                {genBusy ? "Generating..." : hasPersistedCode ? "Regenerate Tracking Code" : "Generate Tracking Code"}
              </Button>
              <Button size="sm" variant="ghost"
                disabled={campaign.qc_status !== "PASSED"
                  || campaign.calendar_status === "UPDATED"
                  || !hasPersistedCode}
                onClick={() => { setPushError(null); setPushOpen(true); }}>
                Update Calendar
              </Button>
              {campaign.calendar_status === "UPDATED" && (
                <span className="flex items-center gap-1.5 text-tiny text-success-700">
                  {Icon.check(13)} In the calendar since {campaign.calendar_updated_at ? fmtRelative(campaign.calendar_updated_at) : ""}
                </span>
              )}
            </div>
            {!qcPassed && (
              <p className="mt-2 text-micro text-muted">All applicable QC checks must be ticked before this campaign can reach the calendar.</p>
            )}
            {!tracking.ok && (
              <p className="mt-1 text-micro text-danger-700">{tracking.label} — {tracking.detail}</p>
            )}
            {tracking.ok && !hasPersistedCode && (
              <p className="mt-1 text-micro text-danger-700">
                Every tracking field is filled, but no Tracking Code has been generated yet.
                Press Generate Tracking Code before Final QC.
              </p>
            )}
            {genError && <p className="mt-1 text-micro text-danger-700">{genError}</p>}
            {pushDone && (
              <p className="mt-1 flex items-center gap-1.5 text-micro text-success-700">
                {Icon.check(12)} {pushDone}
              </p>
            )}
            {!creativeNeeded && (
              <p className="mt-1 text-micro text-faint">Creative verified: {QC_NA_LABEL}.</p>
            )}
          </Block>
        )}

        {/* Activity log */}
        <Block title="Activity">
          {logs.length === 0 ? <p className="text-tiny text-muted">No actions yet.</p> : (
            <ol className="relative space-y-2.5 pl-5">
              <span className="absolute left-[5px] top-2 bottom-2 w-px bg-line" />
              {logs.map((l) => (
                <li key={l.id} className="relative">
                  <span className="absolute -left-5 top-1.5 h-2 w-2 rounded-full border-2 border-surface bg-indigo-400" />
                  <div className="text-[13px] text-body">{l.description ?? titleCase(l.action)}</div>
                  <div className="text-[10px] text-faint">{fmtRelative(l.created_at)}</div>
                </li>
              ))}
            </ol>
          )}
        </Block>
      </div>

      <Modal open={pushOpen} onClose={() => setPushOpen(false)} title="Update calendar?"
        sub="This is the finalization step. The campaign will appear in Final View and the Calendar after confirmation.">
        <p className="text-tiny text-muted">Final QC has passed for this campaign. Confirm to add it to the finalized calendar.</p>
        {pushError && (
          <p className="mt-3 rounded-lg bg-danger-50 px-3 py-2 text-tiny text-danger-700">
            {pushError}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-3">
          <Button variant="ghost" disabled={busy} onClick={() => {
            // Cancel changes nothing.
            setPushError(null); setPushOpen(false);
          }}>Cancel</Button>
          <Button disabled={busy} onClick={async () => {
            /**
             * This had NO try/catch. `update_calendar()` raises when QC has
             * not passed or the tracking code is empty or not `cid=`; the
             * promise rejected, `setBusy(false)` and `setPushOpen(false)`
             * never ran, and nothing was shown. The modal simply sat there
             * — "I click Update Calendar and it won't update".
             *
             * The modal now closes ONLY after the database confirms the
             * write, and any refusal is shown with its reason.
             */
            setBusy(true); setPushError(null);
            try {
              await api.updateCalendar(campaign, profile.id);
              setPushOpen(false);
              setPushDone("Campaign added to the finalized calendar.");
              // Refresh so Final View and the Calendar show it without a
              // hard reload. A failure here does not un-finalize anything,
              // so it is reported separately.
              try {
                await refresh();
              } catch {
                setPushError(
                  "Campaign was finalized, but the Calendar refresh failed. Refreshing data.");
              }
            } catch (e) {
              setPushError(`Unable to update the calendar: ${
                e instanceof Error ? e.message : String(e)}`);
            } finally {
              setBusy(false);
            }
          }}>{busy ? "Updating..." : "Update Calendar"}</Button>
        </div>
      </Modal>

      <Modal open={requestChangesOpen} onClose={() => setRequestChangesOpen(false)} title="Request changes from Category">
        <div className="space-y-4">
          <Field label="What needs to change" required>
            <textarea rows={3} value={changeReason} onChange={(e) => setChangeReason(e.target.value)}
              placeholder="Be specific — this goes back to Category as-is" />
          </Field>
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setRequestChangesOpen(false)}>Cancel</Button>
            <Button variant="danger" disabled={!changeReason.trim() || busy} onClick={async () => {
              setBusy(true);
              await api.updateCampaign(campaign.id, { category_status: "DRAFT" });
              await api.log(campaign.id, profile.id, "CRM_REQUESTED_CHANGES", `CRM requested changes: ${changeReason}`);
              await api.notify("CATEGORY", "CHANGE_REQUESTED", "Changes requested",
                `${campaign.campaign_name}: ${changeReason}`, campaign.id);
              setBusy(false); setRequestChangesOpen(false); setChangeReason(""); await refresh();
            }}>
              Send back to Category
            </Button>
          </div>
        </div>
      </Modal>
    </Drawer>
  );
}

/* ── Category inline form ── */
function CategoryForm({ campaign, profileId, onSaved }: {
  campaign: Campaign; profileId: string; onSaved: () => Promise<void>;
}) {
  const locked = campaign.category_status === "LOCKED";
  const [editing, setEditing] = useState(false);
  // Seeded from this campaign only. The parent passes key={campaign.id}, so
  // a different campaign gets a different instance and this initialiser runs
  // again — one draft can never outlive the row it came from.
  const [v, setV] = useState<CategoryDraft>(() => draftFromCampaign(campaign));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof CategoryDraft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setV((p) => ({ ...p, [k]: e.target.value }));

  const errors = categoryErrors(v);
  const legacyNote = legacyDateTimeNote(v.date_time_brief);

  // Once locked, Category (or CRM viewing on Category's behalf) can only
  // request a change per field — never silently overwrite the submitted
  // value. This is what feeds the Changes audit trail (original -> requested
  // -> who -> when), reviewed on the Changes page.
  if (locked && !editing) {
    return (
      <div className="space-y-3">
        <ReadGrid rows={[
          ["Sub Category", campaign.sub_category], ["Brand", campaign.brand],
          ["Offer", campaign.offer], ["Landing Link", campaign.landing],
          ["Expected CVR", campaign.expected_cvr], ["Expected RPV", campaign.expected_rpv],
          ["Category Brief", campaign.brief], ["Comments", campaign.additional_notes],
        ]} />
        <div className="flex items-center gap-2 rounded-lg bg-[#F9FAFB] px-3 py-2 text-micro text-muted">
          {Icon.check(12)} Submitted and locked. Use Edit to request a change — the original value is preserved until CRM approves it.
        </div>
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit</Button>
      </div>
    );
  }

  if (locked && editing) {
    return (
      <div className="space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Field to change">
            <select value={v.brand !== campaign.brand ? "brand" : "offer"} disabled>
              <option>Pick a field below and change its value, then submit</option>
            </select>
          </Field>
        </div>
        {(["sub_category","brand","offer","landing","brief","additional_notes"] as const).map((field) => (
          <Field key={field} label={titleCase(field)}>
            <input defaultValue={String(campaign[field] ?? "")} onChange={(e) => setV((p) => ({ ...p, [field]: e.target.value }))} />
          </Field>
        ))}
        <Field label="Reason for the change" required>
          <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <div className="flex gap-3">
          <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
          <Button size="sm" disabled={busy || !reason.trim()} onClick={async () => {
            setBusy(true);
            const changedFields = (["sub_category","brand","offer","landing","brief","additional_notes"] as const)
              .filter((f) => v[f] !== (campaign[f] ?? ""));
            for (const f of changedFields) {
              await api.requestChange(campaign, f, String(campaign[f] ?? ""), String(v[f]), reason, profileId);
            }
            setBusy(false); setEditing(false); await onSaved();
          }}>
            Submit change request{`s`}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        {/* Free text everywhere Category input is edited. */}
        <Field label="Sub Category">
          <input value={v.sub_category ?? ""}
            onChange={(e) => setV((p) => ({ ...p, sub_category: e.target.value }))}
            placeholder="Type a sub category" />
        </Field>
        <Field label="Brand" required
          hint={showErrors ? errors.brand : undefined} error={Boolean(showErrors && errors.brand)}>
          <input value={v.brand ?? ""}
            onChange={(e) => setV((p) => ({ ...p, brand: e.target.value }))}
            placeholder="Type a brand, or several" />
        </Field>
        {/* Free text by request: the offer wording changes per campaign and
            the fixed list was rejecting legitimate values. */}
        <Field label="Offer" required
          hint={showErrors ? errors.offer : undefined} error={Boolean(showErrors && errors.offer)}>
          <input value={v.offer} onChange={set("offer")} placeholder="e.g. Flat 40% off" />
        </Field>
        <Field label="Landing Link" required
          hint={showErrors ? errors.landing : undefined} error={Boolean(showErrors && errors.landing)}>
          <input value={v.landing} onChange={set("landing")} placeholder="https://..." />
        </Field>
        <Field label="Expected CVR" required
          hint={errors.expected_cvr && (showErrors || v.expected_cvr.trim()) ? errors.expected_cvr : "Number only, decimals allowed"}
          error={Boolean(errors.expected_cvr && (showErrors || v.expected_cvr.trim()))}>
          <input inputMode="decimal" value={v.expected_cvr} onChange={set("expected_cvr")} placeholder="2.5" />
        </Field>
        <Field label="Expected RPV" required
          hint={errors.expected_rpv && (showErrors || v.expected_rpv.trim()) ? errors.expected_rpv : "Number only, decimals allowed"}
          error={Boolean(errors.expected_rpv && (showErrors || v.expected_rpv.trim()))}>
          <input inputMode="decimal" value={v.expected_rpv} onChange={set("expected_rpv")} placeholder="450.75" />
        </Field>
      </div>
      <Field label="Category Brief" required
        hint={showErrors ? errors.brief : undefined} error={Boolean(showErrors && errors.brief)}>
        <textarea rows={2} value={v.brief} onChange={set("brief")} />
      </Field>
      <Field label="Comments"><textarea rows={2} value={v.additional_notes} onChange={set("additional_notes")} /></Field>
      <Field label="Date / Time Brief"
        hint={legacyNote ? `Existing note kept until you pick a date: “${legacyNote}”` : "Optional — when the brand wants this placed"}>
        <input type="datetime-local"
          value={isDateTimeLocal(v.date_time_brief) ? v.date_time_brief : ""}
          onChange={set("date_time_brief")} />
      </Field>

      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-danger-50 px-3 py-2 text-tiny text-danger-700">
          {Icon.alert(13)} <span>{error}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="ghost" disabled={busy} onClick={async () => {
          if (!draftIsSavable(v)) {
            setShowErrors(true); setError("Fix the highlighted numbers before saving.");
            return;
          }
          setBusy(true); setError(null);
          try {
            // One row, by UUID. Saving is a draft save: it never locks.
            await api.updateCampaign(campaign.id, {
              ...draftToPatch(v),
              category_status: campaign.category_status === "LOCKED" ? "LOCKED" : "DRAFT",
            });
            await api.log(campaign.id, profileId, "CATEGORY_DRAFT_SAVED", "Category saved draft input.");
            await onSaved();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Could not save this campaign.");
          }
          setBusy(false);
        }}>Save Category Inputs</Button>

        <Button size="sm" disabled={busy} onClick={async () => {
          if (!draftIsLockable(v)) {
            setShowErrors(true);
            setError("Every field marked * must be filled before this row can be locked.");
            return;
          }
          setBusy(true); setError(null);
          try {
            await api.updateCampaign(campaign.id, draftToPatch(v));
            await api.lockCategoryInput(campaign.id, profileId);
            await onSaved();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Could not lock this campaign.");
          }
          setBusy(false);
        }}>{Icon.check(13)} Lock Input</Button>
      </div>
      <p className="text-micro text-faint">
        Locking applies to this campaign only and submits it to CRM. Only CRM can reopen it afterwards.
      </p>
    </div>
  );
}

/* ── Content inline form ── */
function ContentForm({ campaign, profileId, onSaved }: {
  campaign: Campaign; profileId: string; onSaved: () => Promise<void>;
}) {
  const [header, setHeader] = useState(campaign.header ?? "");
  const [subCopy, setSubCopy] = useState(campaign.sub_copy_text ?? "");
  const [refLink, setRefLink] = useState(campaign.reference_link ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Optimistic: flipped the moment the write confirms, so the block reflects
  // the new state without waiting for the parent's refetch to come back.
  const [submitted, setSubmitted] = useState(campaign.content_status === "SUBMITTED");

  // Counts are derived, never typed. Two fields that can disagree with the
  // text they describe are two fields that will eventually disagree.
  const hCount = header.trim().length;
  const sCount = subCopy.trim().length;
  const overHeader = hCount > HEADER_LIMIT;
  const overSub = sCount > SUB_COPY_LIMIT;

  if (submitted) {
    return (
      <div className="space-y-3">
        <ReadGrid rows={[
          ["Header", campaign.header ?? header],
          ["Sub Copy", campaign.sub_copy_text ?? subCopy],
          ["H Count", campaign.h_count ?? hCount],
          ["S Count", campaign.s_count ?? sCount],
          ["Reference Link", campaign.reference_link ?? refLink],
        ]} />
        <div className="flex items-center gap-2 rounded-lg bg-success-50 px-3 py-2 text-micro text-success-700">
          {Icon.check(12)} Content submitted. CRM will review it in Final QC.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Header" required
          hint={`${hCount} / ${HEADER_LIMIT} characters`} error={overHeader}>
          <input value={header} onChange={(e) => setHeader(e.target.value)} />
        </Field>
        <Field label="Sub Copy" required
          hint={`${sCount} / ${SUB_COPY_LIMIT} characters`} error={overSub}>
          <input value={subCopy} onChange={(e) => setSubCopy(e.target.value)} />
        </Field>
        <Field label="H Count" hint="Counted automatically from Header">
          <input value={hCount} readOnly disabled />
        </Field>
        <Field label="S Count" hint="Counted automatically from Sub Copy">
          <input value={sCount} readOnly disabled />
        </Field>
        <Field label="Reference Link">
          <input value={refLink} onChange={(e) => setRefLink(e.target.value)} />
        </Field>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-danger-50 px-3 py-2 text-tiny text-danger-700">
          {Icon.alert(13)} <span>{error}</span>
        </div>
      )}

      <Button size="sm" disabled={busy || !header.trim() || !subCopy.trim()} onClick={async () => {
        setBusy(true); setError(null);
        try {
          await api.submitContentRow(campaign.id,
            { header, sub_copy_text: subCopy, reference_link: refLink }, profileId);
          setSubmitted(true);
          await onSaved();
        } catch (e) {
          setError(e instanceof Error ? e.message : "Could not submit this content.");
        }
        setBusy(false);
      }}>
        {busy
          ? <><Spinner /> Submitting...</>
          : <>{Icon.check(13)} Submit Content</>}
      </Button>
    </div>
  );
}

function Spinner() {
  return <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />;
}

/** A tracking dropdown. Stored value is always the code, never the label. */
function TrackingSelect({ label, value, options, labels, onPick }: {
  label: string;
  value: string | null | undefined;
  options: readonly string[];
  labels?: Record<string, string>;
  onPick: (v: string) => void;
}) {
  return (
    <Field label={label}>
      <select value={value ?? ""} onChange={(e) => onPick(e.target.value)}>
        <option value="">—</option>
        {options.map((o) => <option key={o} value={o}>{labels?.[o] ?? o}</option>)}
      </select>
    </Field>
  );
}

/* ── Shared helpers ── */
function Block({ title, children, tag, tagColor }: {
  title: string; children: React.ReactNode; tag?: string; tagColor?: string;
}) {
  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-[13px] font-600 text-heading">{title}</h3>
        {tag && (
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-600 ${
            tagColor === "indigo" ? "bg-indigo-50 text-indigo-700"
            : tagColor === "warning" ? "bg-warning-50 text-warning-700"
            : tagColor === "info" ? "bg-info-50 text-info-700"
            : "bg-[#F2F4F7] text-muted"}`}>{tag}</span>
        )}
      </div>
      {children}
    </Card>
  );
}

function ReadGrid({ rows }: { rows: [string, string | number | null | undefined][] }) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {rows.map(([label, value]) => (
        <div key={label}>
          <div className="text-[10px] font-medium uppercase tracking-wide text-faint">{label}</div>
          <div className="mt-0.5 break-words text-[13px] text-heading">{value ?? "—"}</div>
        </div>
      ))}
    </div>
  );
}
