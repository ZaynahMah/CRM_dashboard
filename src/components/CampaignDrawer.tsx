"use client";

import { useCallback, useEffect, useState } from "react";
import type { ActivityLog, Campaign, QcChecklist } from "@/types/campaign";
import type { Profile } from "@/types/user";
import * as api from "@/services/campaigns";
import { fmtLongDate, fmtRelative, fmtTime, titleCase } from "@/lib/format";
import { QC_FIELDS, qcComplete, stageOf } from "@/lib/workflow";
import { Button, Card, Drawer, Field, Modal, Pill } from "./ui";
import { SearchSelect } from "./SearchSelect";
import { RecommendationPanel } from "./RecommendationPanel";
import { Icon } from "./icons";
import masterData from "@/data/masterData.json";

export function CampaignDrawer({ campaignId, profile, onClose, onChanged }: {
  campaignId: string | null; profile: Profile; onClose: () => void; onChanged: () => void;
}) {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [qc, setQc] = useState<QcChecklist | null>(null);
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [pushOpen, setPushOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!campaignId) return;
    const r = await api.getCampaign(campaignId);
    setCampaign(r.campaign); setQc(r.qc); setLogs(r.logs);
  }, [campaignId]);

  useEffect(() => { load(); }, [load]);
  if (!campaignId || !campaign) return null;

  const role = profile.role;
  const stage = stageOf(campaign);
  const refresh = async () => { await load(); onChanged(); };
  const hasCategoryInput = Boolean(campaign.brand && campaign.offer);

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
              {campaign.is_emergency && <Pill label="Urgent" tone="danger" />}
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
                  {(masterData as any).timeSlots?.map((t: string) => <option key={t} value={t}>{fmtTime(t)}</option>)}
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
                  options={(masterData as any).segments ?? []} placeholder="Select segment" />
              </Field>
              <Field label="Category">
                <SearchSelect value={campaign.pncc_category_code ?? ""}
                  onChange={(v) => save({ pncc_category_code: v, category: v, campaign_name: `${campaign.pncc_segment_label ?? ""} · ${v}` })}
                  options={(masterData as any).categories ?? []} placeholder="Select category" />
              </Field>
            </div>
          ) : (
            <ReadGrid rows={[
              ["Date", fmtLongDate(campaign.launch_date)],
              ["Time", fmtTime(campaign.launch_time)],
              ["Slot", titleCase(campaign.slot_type ?? "STANDARD")],
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
            <CategoryForm campaign={campaign} profileId={profile.id} onSaved={refresh} isCrm={role === "CRM"} />
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

        {/* ── PART 2: CRM Content Handoff ── */}
        <Block title="Part 2 — CRM Content Handoff" tag="CRM" tagColor="indigo">
          {role === "CRM" ? (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Title Brief">
                  <input defaultValue={(campaign as any).title_brief ?? ""}
                    onBlur={(e) => save({ title_brief: e.target.value } as any)} />
                </Field>
                <Field label="Message Brief">
                  <input defaultValue={(campaign as any).message_brief ?? ""}
                    onBlur={(e) => save({ message_brief: e.target.value } as any)} />
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
              {hasCategoryInput && (
                <div className="mt-4">
                  <Button size="sm" onClick={() => logAndSave(
                    { crm_status: "SENT_TO_CONTENT", content_status: "PENDING" },
                    "SENT_TO_CONTENT", "CRM sent campaign to Content team.")}>
                    {Icon.send(13)} Send to Content Team
                  </Button>
                </div>
              )}
            </>
          ) : (
            <ReadGrid rows={[
              ["Title Brief", (campaign as any).title_brief],
              ["Message Brief", (campaign as any).message_brief],
              ["PN Template", campaign.pn_template],
              ["Creative Requirements", campaign.creative_requirements],
            ]} />
          )}
        </Block>

        {/* ── CONTENT TEAM INPUT ── */}
        <Block title="Content / Creative Input" tag="Content" tagColor="info">
          {(role === "CONTENT" || role === "CRM") ? (
            <ContentForm campaign={campaign} profileId={profile.id} onSaved={refresh} />
          ) : (
            <ReadGrid rows={[
              ["Header", (campaign as any).header],
              ["Sub Copy", (campaign as any).sub_copy_text],
              ["H Count", (campaign as any).h_count],
              ["S Count", (campaign as any).s_count],
              ["Reference Link", campaign.reference_link],
            ]} />
          )}
        </Block>

        {/* ── PART 3: CRM Final Operations ── */}
        {role === "CRM" && (
          <Block title="Part 3 — CRM Final QC & Tracking" tag="CRM" tagColor="indigo">
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Sound"><select defaultValue={campaign.sound ? "Yes" : "No"}
                onChange={(e) => save({ sound: e.target.value === "Yes" })}><option>No</option><option>Yes</option></select></Field>
              <Field label="GL"><select defaultValue={campaign.global_limit ? "Yes" : "No"}
                onChange={(e) => save({ global_limit: e.target.value === "Yes" })}><option>No</option><option>Yes</option></select></Field>
              <Field label="Campaign Type"><input defaultValue={campaign.campaign_type ?? ""}
                onBlur={(e) => save({ campaign_type: e.target.value })} /></Field>
              <Field label="Campaign Name"><input defaultValue={campaign.campaign_name ?? ""}
                onBlur={(e) => save({ campaign_name: e.target.value })} /></Field>
              <Field label="Channel Name"><input defaultValue={campaign.channel ?? "PN"}
                onBlur={(e) => save({ channel: e.target.value } as any)} /></Field>
              <Field label="Channel Format"><input defaultValue=""
                onBlur={() => {}} /></Field>
              <Field label="Segment 1"><input defaultValue={campaign.segment_1 ?? ""}
                onBlur={(e) => save({ segment_1: e.target.value })} /></Field>
              <Field label="Segment 2"><input defaultValue={campaign.segment_2 ?? ""}
                onBlur={(e) => save({ segment_2: e.target.value })} /></Field>
              <Field label="CID"><input defaultValue={campaign.cid ?? ""}
                onBlur={(e) => save({ cid: e.target.value })} /></Field>
              <Field label="Campaign ID"><input defaultValue={campaign.campaign_id_ext ?? ""}
                onBlur={(e) => save({ campaign_id_ext: e.target.value })} /></Field>
              <Field label="Tracking Code"><input defaultValue={campaign.tracking_code ?? ""}
                onBlur={(e) => save({ tracking_code: e.target.value })} /></Field>
              <Field label="Collapse ID"><input defaultValue={campaign.collapse_id ?? ""}
                onBlur={(e) => save({ collapse_id: e.target.value })} /></Field>
              <Field label="Smit's Feedback"><input defaultValue={(campaign as any).smit_feedback ?? ""}
                onBlur={(e) => save({ smit_feedback: e.target.value } as any)} /></Field>
              <Field label="Nazia's Feedback"><input defaultValue={(campaign as any).nazia_feedback ?? ""}
                onBlur={(e) => save({ nazia_feedback: e.target.value } as any)} /></Field>
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              <Button size="sm" onClick={() => logAndSave(
                { production_status: "READY", qc_status: "PASSED", crm_status: "READY" },
                "CRM_FINAL_QC", "CRM completed final QC. Ready to publish.")}>
                {Icon.check(13)} Mark Ready to Publish
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPushOpen(true)}
                disabled={campaign.production_status !== "READY"}>
                Publish
              </Button>
            </div>
          </Block>
        )}

        {/* Recommendation — CRM only */}
        <RecommendationPanel campaign={campaign} role={role} />

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

      <Modal open={pushOpen} onClose={() => setPushOpen(false)} title="Publish campaign?">
        <p className="text-tiny text-muted">This campaign has passed final QC and will be marked as Published.</p>
        <div className="mt-4 flex justify-end gap-3">
          <Button variant="ghost" onClick={() => setPushOpen(false)}>Cancel</Button>
          <Button onClick={async () => {
            await api.pushToProduction(campaign, profile.id);
            setPushOpen(false); await refresh();
          }}>Publish</Button>
        </div>
      </Modal>
    </Drawer>
  );
}

/* ── Category inline form ── */
function CategoryForm({ campaign, profileId, onSaved, isCrm }: {
  campaign: Campaign; profileId: string; onSaved: () => Promise<void>; isCrm: boolean;
}) {
  const [v, setV] = useState({
    sub_category: campaign.sub_category ?? "",
    brand: campaign.brand ?? "",
    offer: campaign.offer ?? "",
    brief: campaign.brief ?? "",
    landing: campaign.landing ?? "",
    expected_cvr: campaign.expected_cvr ?? "",
    expected_rpv: campaign.expected_rpv ?? "",
    additional_notes: campaign.additional_notes ?? "",
    date_time_brief: campaign.date_time_brief ?? "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setV((p) => ({ ...p, [k]: e.target.value }));

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Sub Category"><input value={v.sub_category} onChange={set("sub_category")} /></Field>
        <Field label="Brand">
          <SearchSelect value={v.brand} onChange={(val) => setV((p) => ({ ...p, brand: val }))}
            options={masterData.brands} placeholder="Search brands" />
        </Field>
        <Field label="Offer">
          <SearchSelect value={v.offer} onChange={(val) => setV((p) => ({ ...p, offer: val }))}
            options={masterData.offers} placeholder="Search offers" />
        </Field>
        <Field label="Landing Link"><input value={v.landing} onChange={set("landing")} /></Field>
        <Field label="Expected CVR"><input value={v.expected_cvr} onChange={set("expected_cvr")} placeholder="2.5%" /></Field>
        <Field label="Expected RPV"><input value={v.expected_rpv} onChange={set("expected_rpv")} placeholder="₹450" /></Field>
      </div>
      <Field label="Category Brief"><textarea rows={2} value={v.brief} onChange={set("brief")} /></Field>
      <Field label="Comments"><textarea rows={2} value={v.additional_notes} onChange={set("additional_notes")} /></Field>
      <Field label="Date / Time Brief" hint="e.g. Brand requested evening placement">
        <input value={v.date_time_brief} onChange={set("date_time_brief")} />
      </Field>
      <Button size="sm" disabled={busy} onClick={async () => {
        setBusy(true);
        await api.updateCampaign(campaign.id, { ...v, category_status: v.brand && v.offer ? "LOCKED" : "DRAFT" } as any);
        await api.log(campaign.id, profileId, "CATEGORY_SUBMITTED", "Category inputs submitted.");
        await onSaved(); setBusy(false);
      }}>Save Category Inputs</Button>
    </div>
  );
}

/* ── Content inline form ── */
function ContentForm({ campaign, profileId, onSaved }: {
  campaign: Campaign; profileId: string; onSaved: () => Promise<void>;
}) {
  const [header, setHeader] = useState((campaign as any).header ?? "");
  const [subCopy, setSubCopy] = useState((campaign as any).sub_copy_text ?? "");
  const [hCount, setHCount] = useState((campaign as any).h_count ?? "");
  const [sCount, setSCount] = useState((campaign as any).s_count ?? "");
  const [refLink, setRefLink] = useState(campaign.reference_link ?? "");
  const [busy, setBusy] = useState(false);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Header"><input value={header} onChange={(e) => setHeader(e.target.value)} /></Field>
        <Field label="Sub Copy"><input value={subCopy} onChange={(e) => setSubCopy(e.target.value)} /></Field>
        <Field label="H Count"><input value={hCount} onChange={(e) => setHCount(e.target.value)} /></Field>
        <Field label="S Count"><input value={sCount} onChange={(e) => setSCount(e.target.value)} /></Field>
        <Field label="Reference Link"><input value={refLink} onChange={(e) => setRefLink(e.target.value)} /></Field>
      </div>
      <Button size="sm" disabled={busy} onClick={async () => {
        setBusy(true);
        await api.updateCampaign(campaign.id, {
          reference_link: refLink, content_status: "SUBMITTED",
        } as any);
        await api.log(campaign.id, profileId, "CONTENT_SUBMITTED", "Content team submitted creative details.");
        await onSaved(); setBusy(false);
      }}>Submit Content</Button>
    </div>
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

function ReadGrid({ rows }: { rows: [string, string | null | undefined][] }) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {rows.map(([label, value]) => (
        <div key={label}>
          <div className="text-[10px] font-medium uppercase tracking-wide text-faint">{label}</div>
          <div className="mt-0.5 break-words text-[13px] text-heading">{value || "—"}</div>
        </div>
      ))}
    </div>
  );
}
