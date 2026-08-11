"use client";

import { useCallback, useEffect, useState } from "react";
import type { ActivityLog, Campaign, QcChecklist } from "@/types/campaign";
import type { Profile } from "@/types/user";
import * as api from "@/services/campaigns";
import { fmtLongDate, fmtRelative, fmtTime, titleCase } from "@/lib/format";
import { QC_FIELDS, qcComplete, stageOf } from "@/lib/workflow";
import { Button, Card, Drawer, Field, Modal, Pill } from "./ui";
import { RecommendationPanel } from "./RecommendationPanel";
import { Icon } from "./icons";

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

  return (
    <Drawer open onClose={onClose}>
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-line bg-surface px-6 py-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Pill dot={false} label={campaign.pncc_segment_label ?? "—"} tone="indigo" />
              <Pill dot={false} label={campaign.pncc_category_code ?? campaign.category ?? "—"} tone="neutral" />
              <Pill label={hasCategoryInput ? "Ready" : "Pending"} tone={hasCategoryInput ? "success" : "warning"} />
              {campaign.slot_type === "ADDITIONAL" && <Pill dot={false} label="Additional slot" tone="info" />}
            </div>
            <h2 className="mt-2.5 font-display text-[21px] font-700 text-heading">{campaign.campaign_name}</h2>
            <p className="mt-1.5 flex items-center gap-3 text-tiny text-muted">
              <span className="flex items-center gap-1">{Icon.calendar(13)} {fmtLongDate(campaign.launch_date)}</span>
              <span className="flex items-center gap-1">{Icon.clock(13)} {fmtTime(campaign.launch_time)}</span>
            </p>
          </div>
          <button onClick={onClose} aria-label="Close"
            className="rounded-lg p-1.5 text-faint hover:bg-[#F9FAFB] hover:text-body">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <div className="space-y-4 p-6">
        {/* CRM Scheduling — read-only for everyone */}
        <Block title="CRM Scheduling" tag="CRM" tagColor="indigo">
          <div className="grid gap-4 md:grid-cols-2">
            <Read label="Date" value={fmtLongDate(campaign.launch_date)} />
            <Read label="Time" value={fmtTime(campaign.launch_time)} />
            <Read label="Segment" value={campaign.pncc_segment_label ?? campaign.audience} />
            <Read label="Segment code" value={campaign.pncc_segment_name} mono />
            <Read label="Category" value={campaign.pncc_category_code ?? campaign.category} />
            <Read label="Slot type" value={titleCase(campaign.slot_type ?? "STANDARD")} />
          </div>
        </Block>

        {/* Category Inputs */}
        <Block title="Category Inputs" tag="Category" tagColor="warning">
          {(role === "CATEGORY" || role === "CRM") && !hasCategoryInput ? (
            <CategoryInputForm campaign={campaign} profileId={profile.id} onSaved={refresh} />
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <Read label="Sub Category" value={campaign.sub_category} />
              <Read label="Brand" value={campaign.brand} />
              <Read label="Offer" value={campaign.offer} />
              <Read label="Landing Link" value={campaign.landing} />
              <Read label="Expected CVR" value={campaign.expected_cvr} />
              <Read label="Expected RPV" value={campaign.expected_rpv} />
              <Read label="Category Brief" value={campaign.brief} span />
              <Read label="Comment" value={campaign.additional_notes} span />
              <Read label="Date / Time Brief" value={campaign.date_time_brief} span />
            </div>
          )}
        </Block>

        {/* CRM Creative */}
        <Block title="CRM Creative" tag="CRM" tagColor="indigo">
          {role === "CRM" ? (
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="PN Template">
                <select defaultValue={campaign.pn_template ?? ""}
                  onChange={async (e) => { await api.updateCampaign(campaign.id, { pn_template: e.target.value }); refresh(); }}>
                  <option value="">Select</option>
                  {["Basic", "Bezel", "Timer", "Coloured BG"].map((t) => <option key={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Creative Requirements">
                <input defaultValue={campaign.creative_requirements ?? ""}
                  onBlur={async (e) => { await api.updateCampaign(campaign.id, { creative_requirements: e.target.value }); refresh(); }} />
              </Field>
              <Field label="Creative Link">
                <input defaultValue={campaign.creative_link ?? ""}
                  onBlur={async (e) => { await api.updateCampaign(campaign.id, { creative_link: e.target.value }); refresh(); }} />
              </Field>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-3">
              <Read label="PN Template" value={campaign.pn_template} />
              <Read label="Creative Requirements" value={campaign.creative_requirements} />
              <Read label="Creative Link" value={campaign.creative_link} />
            </div>
          )}
        </Block>

        {/* Recommendation — CRM only */}
        <RecommendationPanel campaign={campaign} role={role} />

        {/* QC — CRM only */}
        {role === "CRM" && hasCategoryInput && (
          <Block title="Final QC">
            <div className="grid gap-x-6 md:grid-cols-2">
              {QC_FIELDS.map((f) => (
                <label key={String(f.key)} className="flex cursor-pointer items-center gap-3 border-b border-line py-2.5">
                  <input type="checkbox" checked={Boolean(qc?.[f.key])} disabled={stage === "PUSHED"}
                    onChange={async (e) => {
                      await api.saveQc(campaign.id, { [f.key]: e.target.checked } as Partial<QcChecklist>);
                      await refresh();
                    }} />
                  <span className="text-[13.5px] text-body">{f.label}</span>
                </label>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button disabled={!qcComplete(qc) || stage === "READY" || stage === "PUSHED" || busy}
                onClick={async () => { setBusy(true); await api.markReady(campaign, profile.id); await refresh(); setBusy(false); }}>
                Mark ready
              </Button>
              <Button variant="ghost" disabled={stage !== "READY"} onClick={() => setPushOpen(true)}>
                Push to production
              </Button>
            </div>
          </Block>
        )}

        {/* Activity */}
        <Block title="Activity">
          {logs.length === 0 ? (
            <p className="text-tiny text-muted">No actions recorded yet.</p>
          ) : (
            <ol className="relative space-y-3 pl-5">
              <span className="absolute left-[5px] top-2 bottom-2 w-px bg-line" />
              {logs.map((l) => (
                <li key={l.id} className="relative">
                  <span className="absolute -left-5 top-1.5 h-2.5 w-2.5 rounded-full border-2 border-surface bg-indigo-400" />
                  <div className="text-[13.5px] text-body">{l.description ?? titleCase(l.action)}</div>
                  <div className="mt-0.5 text-micro text-faint">{fmtRelative(l.created_at)}</div>
                </li>
              ))}
            </ol>
          )}
        </Block>
      </div>

      <Modal open={pushOpen} onClose={() => setPushOpen(false)} title="Push to production?">
        <div className="space-y-1">
          <Line label="Campaign" value={campaign.campaign_name} />
          <Line label="Segment" value={campaign.pncc_segment_label ?? "—"} />
          <Line label="Category" value={campaign.pncc_category_code ?? "—"} />
          <Line label="Date" value={fmtLongDate(campaign.launch_date)} />
          <Line label="Time" value={fmtTime(campaign.launch_time)} />
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="ghost" onClick={() => setPushOpen(false)}>Cancel</Button>
          <Button onClick={async () => {
            await api.pushToProduction(campaign, profile.id);
            setPushOpen(false); await refresh();
          }}>Push to production</Button>
        </div>
      </Modal>
    </Drawer>
  );
}

function CategoryInputForm({ campaign, profileId, onSaved }: {
  campaign: Campaign; profileId: string; onSaved: () => Promise<void>;
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
    setV((prev) => ({ ...prev, [k]: e.target.value }));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Sub Category"><input value={v.sub_category} onChange={set("sub_category")} /></Field>
        <Field label="Brand"><input value={v.brand} onChange={set("brand")} /></Field>
        <Field label="Offer"><input value={v.offer} onChange={set("offer")} /></Field>
        <Field label="Landing Link"><input value={v.landing} onChange={set("landing")} /></Field>
        <Field label="Expected CVR"><input value={v.expected_cvr} onChange={set("expected_cvr")} placeholder="e.g. 2.5%" /></Field>
        <Field label="Expected RPV"><input value={v.expected_rpv} onChange={set("expected_rpv")} placeholder="e.g. ₹450" /></Field>
      </div>
      <Field label="Category Brief"><textarea rows={2} value={v.brief} onChange={set("brief")} /></Field>
      <Field label="Comment"><textarea rows={2} value={v.additional_notes} onChange={set("additional_notes")} /></Field>
      <Field label="Date / Time Brief" hint="Note if a brand or offer requires a specific date/time.">
        <input value={v.date_time_brief} onChange={set("date_time_brief")} />
      </Field>
      <Button disabled={busy || (!v.brand && !v.offer)} onClick={async () => {
        setBusy(true);
        await api.updateCampaign(campaign.id, {
          ...v,
          category_status: v.brand && v.offer ? "LOCKED" : "DRAFT",
        } as any);
        await api.log(campaign.id, profileId, "CATEGORY_SUBMITTED", "Category details submitted.");
        await onSaved();
        setBusy(false);
      }}>
        Save Category inputs
      </Button>
    </div>
  );
}

function Block({ title, children, tag, tagColor }: {
  title: string; children: React.ReactNode; tag?: string; tagColor?: string;
}) {
  return (
    <Card>
      <div className="mb-4 flex items-center gap-2">
        <h3 className="font-display text-[14px] font-600 text-heading">{title}</h3>
        {tag && (
          <span className={`rounded px-1.5 py-0.5 text-micro font-600 ${
            tagColor === "indigo" ? "bg-indigo-50 text-indigo-700"
            : tagColor === "warning" ? "bg-warning-50 text-warning-700"
            : "bg-[#F2F4F7] text-muted"
          }`}>{tag}</span>
        )}
      </div>
      {children}
    </Card>
  );
}

function Read({ label, value, mono, span }: { label: string; value?: string | null; mono?: boolean; span?: boolean }) {
  return (
    <div className={`min-w-0 ${span ? "md:col-span-2" : ""}`}>
      <div className="text-micro font-medium uppercase tracking-wide text-faint">{label}</div>
      <div className={`mt-1 break-words text-[13.5px] text-heading ${mono ? "font-mono text-tiny" : ""}`}>
        {value || "—"}
      </div>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-line py-2.5 last:border-0">
      <span className="text-tiny text-muted">{label}</span>
      <span className="text-[13.5px] font-medium text-heading">{value}</span>
    </div>
  );
}
