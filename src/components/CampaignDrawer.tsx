"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  ActivityLog, Campaign, ContentSubmission, CrmDecision, QcChecklist,
} from "@/types/campaign";
import type { Profile } from "@/types/user";
import * as api from "@/services/campaigns";
import { submitContent } from "@/services/content";
import { fmtLongDate, fmtRelative, fmtTime, titleCase } from "@/lib/format";
import { HEADER_LIMIT, QC_FIELDS, SUB_COPY_LIMIT, qcComplete, stageOf } from "@/lib/workflow";
import { isCategoryLocked } from "@/lib/deadlines";
import { Button, Card, Drawer, Field, Modal, Pill } from "./ui";
import { ChannelChip, DeadlineChip, OriginChip, StageChip } from "./StatusChip";
import { RecommendationPanel } from "./RecommendationPanel";
import { TargetingBlock } from "./TargetingBlock";
import { Icon } from "./icons";

export function CampaignDrawer({ campaignId, profile, onClose, onChanged }: {
  campaignId: string | null;
  profile: Profile;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [decision, setDecision] = useState<CrmDecision | null>(null);
  const [content, setContent] = useState<ContentSubmission | null>(null);
  const [qc, setQc] = useState<QcChecklist | null>(null);
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [changeOpen, setChangeOpen] = useState(false);
  const [pushOpen, setPushOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!campaignId) return;
    const r = await api.getCampaign(campaignId);
    setCampaign(r.campaign); setDecision(r.decision);
    setContent(r.content); setQc(r.qc); setLogs(r.logs);
  }, [campaignId]);

  useEffect(() => { load(); }, [load]);

  if (!campaignId || !campaign) return null;
  const role = profile.role;
  const stage = stageOf(campaign);
  const refresh = async () => { await load(); onChanged(); };

  return (
    <Drawer open onClose={onClose}>
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-line bg-surface px-6 py-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <OriginChip campaign={campaign} />
              <StageChip campaign={campaign} />
              <ChannelChip campaign={campaign} />
              {campaign.is_emergency && <Pill label="Emergency" tone="danger" />}
              {campaign.priority !== "NORMAL" && <Pill label={titleCase(campaign.priority)} tone="warning" />}
            </div>
            <h2 className="mt-2.5 font-display text-[21px] font-700 leading-tight text-heading">
              {campaign.campaign_name}
            </h2>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-tiny text-muted">
              <span className="flex items-center gap-1.5">{Icon.calendar(13)} {fmtLongDate(campaign.launch_date)}</span>
              <span className="flex items-center gap-1.5">{Icon.clock(13)} {fmtTime(campaign.launch_time)}</span>
              {campaign.campaign_id_ext && <span className="font-mono">{campaign.campaign_id_ext}</span>}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close"
            className="rounded-lg p-1.5 text-faint transition-colors hover:bg-[#F9FAFB] hover:text-body">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg bg-[#F9FAFB] px-3.5 py-2.5">
          <span className="text-micro font-medium uppercase tracking-wide text-faint">Category deadline</span>
          <span className="text-tiny font-medium text-heading">{fmtLongDate(campaign.category_deadline)}</span>
          <DeadlineChip campaign={campaign} />
          {isCategoryLocked(campaign) && <Pill dot={false} label="Locked" tone="indigo" />}
        </div>
      </div>

      <div className="space-y-4 p-6">
        {/* Category block */}
        <Block title="Business and Category information"
          action={role === "CATEGORY" && isCategoryLocked(campaign)
            ? <Button size="sm" variant="ghost" onClick={() => setChangeOpen(true)}>Request change</Button>
            : undefined}>
          <Grid rows={[
            ["Category", campaign.category], ["Sub-category", campaign.sub_category],
            ["Brand", campaign.brand], ["Offer", campaign.offer],
            ["Campaign type", campaign.campaign_type], ["Product / collection", campaign.product_collection],
            ["Business objective", campaign.business_objective], ["Landing", campaign.landing],
            ["Offer construct", campaign.offer_construct],
          ]} />
          {campaign.offer_details && <Para label="Offer details" value={campaign.offer_details} />}
          {campaign.brief && <Para label="Brief" value={campaign.brief} />}
          {campaign.emergency_reason && <Para label="Reason for emergency" value={campaign.emergency_reason} />}
        </Block>

        {/* Recommendation */}
        <RecommendationPanel
          campaign={campaign} decision={decision} readOnly={role !== "CRM"}
          onApply={async (patch, segmentId) => {
            await api.saveDecision(campaign.id, patch, profile.id);
            await api.updateCampaign(campaign.id, {
              launch_time: patch.selected_time ?? campaign.launch_time,
              audience: patch.selected_audience ?? campaign.audience,
              cohort: patch.selected_cohort ?? campaign.cohort,
              segment_id: segmentId ?? campaign.segment_id,
              crm_status: "IN_PLANNING",
            });
            await api.log(campaign.id, profile.id,
              patch.is_manual_override ? "CRM_OVERRIDE" : "CRM_ACCEPTED_RECOMMENDATION",
              patch.is_manual_override
                ? `CRM overrode the recommendation: ${patch.override_reason}.`
                : `CRM accepted the recommended time ${fmtTime(patch.selected_time ?? null)}.`);
            await refresh();
          }} />

        {/* Targeting and delivery */}
        <Block title="Targeting and delivery">
          <TargetingBlock campaign={campaign} readOnly={role !== "CRM" || stage === "PUSHED"} onChanged={refresh} />

          {role === "CRM" && ["CATEGORY_SUBMITTED", "CRM_PROCESSING"].includes(stage) && (
            <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-4">
              <Button disabled={busy || !campaign.segment_id}
                onClick={async () => { setBusy(true); await api.sendToContent(campaign, profile.id); await refresh(); setBusy(false); }}>
                {Icon.send(14)} Send to Content
              </Button>
              {!campaign.segment_id && <span className="text-tiny text-muted">Select a segment first.</span>}
            </div>
          )}
        </Block>

        {/* Content */}
        <Block title="Copy and creative">
          {role === "CONTENT" && stage === "CONTENT_PENDING"
            ? <ContentWorkspace campaign={campaign} existing={content} profileId={profile.id} onDone={refresh} />
            : <Grid rows={[
                ["Header", content?.header], ["Sub copy", content?.sub_copy],
                ["CTA", content?.cta], ["Creative", content?.creative_asset_url],
                ["Creative notes", content?.creative_notes],
                ["Status", content ? titleCase(content.status) : "Not started"],
              ]} />}
        </Block>

        {/* Final QC */}
        {role === "CRM" && ["CONTENT_SUBMITTED", "FINAL_QC", "READY", "PUSHED"].includes(stage) && (
          <Block title="Final QC">
            <div className="grid gap-x-6 md:grid-cols-2">
              {QC_FIELDS.map((f) => (
                <label key={String(f.key)}
                  className="flex cursor-pointer items-center gap-3 border-b border-line py-2.5 last:border-0">
                  <input type="checkbox" checked={Boolean(qc?.[f.key])} disabled={stage === "PUSHED"}
                    onChange={async (e) => {
                      await api.saveQc(campaign.id, { [f.key]: e.target.checked } as Partial<QcChecklist>);
                      await refresh();
                    }} />
                  <span className="text-[13.5px] text-body">{f.label}</span>
                </label>
              ))}
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-4">
              <Button disabled={!qcComplete(qc) || stage === "READY" || stage === "PUSHED" || busy}
                onClick={async () => { setBusy(true); await api.markReady(campaign, profile.id); await refresh(); setBusy(false); }}>
                Mark ready for production
              </Button>
              <Button variant="ghost" disabled={stage !== "READY"} onClick={() => setPushOpen(true)}>
                Push to production
              </Button>
              {!qcComplete(qc) && stage !== "PUSHED" && (
                <span className="text-tiny text-muted">Every line must be verified before this campaign can go ready.</span>
              )}
            </div>
          </Block>
        )}

        {/* Audit trail */}
        <Block title="Activity">
          {logs.length === 0 ? (
            <p className="text-tiny text-muted">Nothing has happened on this campaign yet.</p>
          ) : (
            <ol className="relative space-y-4 pl-5">
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

      <ChangeRequestModal open={changeOpen} onClose={() => setChangeOpen(false)}
        campaign={campaign} profileId={profile.id} onDone={refresh} />

      <Modal open={pushOpen} onClose={() => setPushOpen(false)} title="Ready to publish?"
        sub="All required information has been completed and QC'd.">
        <div className="space-y-1">
          <Line label="Campaign" value={campaign.campaign_name} />
          <Line label="Channel" value={campaign.channel ?? "PN"} />
          <Line label="Date" value={fmtLongDate(campaign.launch_date)} />
          <Line label="Time" value={fmtTime(campaign.launch_time)} />
          <Line label="Segment" value={campaign.audience ?? "—"} />
          <Line label="Reach" value={campaign.expected_reach?.toLocaleString("en-IN") ?? "—"} />
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="ghost" onClick={() => setPushOpen(false)}>Cancel</Button>
          <Button onClick={async () => {
            await api.pushToProduction(campaign, profile.id);
            setPushOpen(false); await refresh();
          }}>
            Push to production
          </Button>
        </div>
      </Modal>
    </Drawer>
  );
}

/* ---------- content workspace ---------- */

function ContentWorkspace({ campaign, existing, profileId, onDone }: {
  campaign: Campaign; existing: ContentSubmission | null; profileId: string; onDone: () => Promise<void>;
}) {
  const [header, setHeader] = useState(existing?.header ?? "");
  const [sub, setSub] = useState(existing?.sub_copy ?? "");
  const [cta, setCta] = useState(existing?.cta ?? "");
  const [asset, setAsset] = useState(existing?.creative_asset_url ?? "");
  const [notes, setNotes] = useState(existing?.creative_notes ?? "");
  const [busy, setBusy] = useState(false);

  const overHeader = header.length > HEADER_LIMIT;
  const overSub = sub.length > SUB_COPY_LIMIT;
  const ready = header.trim() && sub.trim() && cta.trim() && asset.trim() && !overHeader && !overSub;

  return (
    <div className="space-y-4">
      {/* Live preview of the push as it will land */}
      <div className="rounded-lg border border-line bg-[#F9FAFB] p-4">
        <div className="text-micro font-medium uppercase tracking-wide text-faint">Preview</div>
        <div className="mt-2.5 flex gap-3 rounded-xl border border-line bg-surface p-3 shadow-card">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-indigo-600 text-[11px] font-700 text-white">
            CQ
          </span>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-600 text-heading">{header || "Header goes here"}</div>
            <div className="mt-0.5 line-clamp-2 text-tiny text-muted">{sub || "Sub copy goes here"}</div>
            {cta && <div className="mt-1.5 text-micro font-medium text-indigo-700">{cta}</div>}
          </div>
        </div>
      </div>

      <Field label="Header" required error={overHeader}
        hint={`${header.length} / ${HEADER_LIMIT}${overHeader ? " — over the limit" : ""}`}>
        <input value={header} onChange={(e) => setHeader(e.target.value)} />
      </Field>
      <Field label="Sub copy" required error={overSub}
        hint={`${sub.length} / ${SUB_COPY_LIMIT}${overSub ? " — over the limit" : ""}`}>
        <textarea rows={2} value={sub} onChange={(e) => setSub(e.target.value)} />
      </Field>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="CTA" required>
          <input value={cta} onChange={(e) => setCta(e.target.value)} placeholder="Shop now" />
        </Field>
        <Field label="Creative asset URL" required>
          <input value={asset} onChange={(e) => setAsset(e.target.value)} />
        </Field>
      </div>
      <Field label="Creative notes">
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>

      <div className="flex gap-3">
        <Button variant="ghost" disabled={busy}
          onClick={async () => {
            setBusy(true);
            const { saveDraft } = await import("@/services/content");
            await saveDraft(campaign.id, { header, sub_copy: sub, cta, creative_asset_url: asset, creative_notes: notes });
            await onDone(); setBusy(false);
          }}>
          Save draft
        </Button>
        <Button disabled={!ready || busy}
          onClick={async () => {
            setBusy(true);
            await submitContent(campaign,
              { header, sub_copy: sub, cta, creative_asset_url: asset, creative_notes: notes,
                pn_copy: `${header} — ${sub}` }, profileId);
            await onDone(); setBusy(false);
          }}>
          Submit to CRM
        </Button>
      </div>
    </div>
  );
}

/* ---------- change request ---------- */

const CHANGEABLE = [
  ["offer_details", "Offer details"], ["offer", "Offer"], ["brief", "Brief"],
  ["landing", "Landing"], ["campaign_name", "Campaign name"], ["brand", "Brand"],
];

function ChangeRequestModal({ open, onClose, campaign, profileId, onDone }: {
  open: boolean; onClose: () => void; campaign: Campaign; profileId: string; onDone: () => Promise<void>;
}) {
  const [field, setField] = useState("offer_details");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const current = String((campaign as unknown as Record<string, unknown>)[field] ?? "");

  return (
    <Modal open={open} onClose={onClose} title="Request a change" sub={campaign.campaign_name}>
      <div className="space-y-4">
        <Field label="Field">
          <select value={field} onChange={(e) => { setField(e.target.value); setValue(""); }}>
            {CHANGEABLE.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label="Current">
          <div className="rounded-lg border border-line bg-[#F9FAFB] px-3 py-2.5 text-tiny text-muted">
            {current || "—"}
          </div>
        </Field>
        <Field label="Requested" required>
          <input value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
        <Field label="Reason" required>
          <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-3 pt-1">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!value.trim() || !reason.trim() || busy}
            onClick={async () => {
              setBusy(true);
              await api.requestChange(campaign, field, current, value, reason, profileId);
              setBusy(false); onClose(); await onDone();
            }}>
            Submit change request
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ---------- layout helpers ---------- */

function Block({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <Card>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="font-display text-[14px] font-600 text-heading">{title}</h3>
        {action}
      </div>
      {children}
    </Card>
  );
}

function Grid({ rows }: { rows: [string, string | null | undefined][] }) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {rows.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <div className="text-micro font-medium uppercase tracking-wide text-faint">{label}</div>
          <div className="mt-1 break-words text-[13.5px] text-heading">{value || "—"}</div>
        </div>
      ))}
    </div>
  );
}

function Para({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-4">
      <div className="text-micro font-medium uppercase tracking-wide text-faint">{label}</div>
      <p className="mt-1 max-w-2xl text-[13.5px] leading-relaxed text-body">{value}</p>
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
