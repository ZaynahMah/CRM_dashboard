"use client";

import { useEffect, useState } from "react";
import type { Campaign } from "@/types/campaign";
import type { PushTag, Segment, SegmentExclusion } from "@/types/targeting";
import { ACCESS_TYPES, CHANNEL_LABEL, PN_TEMPLATES } from "@/types/targeting";
import { listExclusions, listPushTags, listSegments } from "@/services/targeting";
import { updateCampaign } from "@/services/campaigns";
import { Field, Pill } from "./ui";

/**
 * The operational block CRM actually fills: channel, segment, push tags and the
 * MoEngage delivery flags. Group ID is derived from the tag by a database
 * trigger, so it is shown but never typed.
 */
export function TargetingBlock({ campaign, readOnly, onChanged }: {
  campaign: Campaign; readOnly: boolean; onChanged: () => Promise<void>;
}) {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [tags, setTags] = useState<PushTag[]>([]);
  const [exclusions, setExclusions] = useState<SegmentExclusion[]>([]);

  useEffect(() => {
    listSegments().then(setSegments);
    listPushTags().then(setTags);
    listExclusions().then(setExclusions);
  }, []);

  const save = async (patch: Partial<Campaign>) => {
    await updateCampaign(campaign.id, patch);
    await onChanged();
  };

  const segment = segments.find((s) => s.id === campaign.segment_id);
  const families = Array.from(new Set(segments.map((s) => s.segment_family)));

  if (readOnly) {
    return (
      <div className="grid gap-4 md:grid-cols-3">
        <Read label="Channel" value={CHANNEL_LABEL[campaign.channel ?? "PN"]} />
        <Read label="Segment" value={segment?.display_name ?? campaign.audience} />
        <Read label="MoEngage name" value={segment?.moe_name} mono />
        <Read label="Reachable base" value={campaign.expected_reach?.toLocaleString("en-IN")} />
        <Read label="Tag" value={campaign.push_tag} />
        <Read label="Group ID" value={campaign.group_id} mono />
        <Read label="Collapse ID" value={campaign.collapse_id} mono />
        <Read label="PN template" value={campaign.pn_template} />
        <Read label="Access type" value={campaign.access_type} />
        <Read label="Tracking code" value={campaign.tracking_code} mono />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Channel">
          <select value={campaign.channel ?? "PN"}
            onChange={(e) => save({ channel: e.target.value as Campaign["channel"] })}>
            {Object.entries(CHANNEL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>

        <Field label="Segment" hint={
          segment?.base_count
            ? `${segment.base_count.toLocaleString("en-IN")} reachable before exclusions`
            : "Pick from the live MoEngage library"
        }>
          <select value={campaign.segment_id ?? ""}
            onChange={(e) => {
              const s = segments.find((x) => x.id === e.target.value);
              save({
                segment_id: e.target.value || null,
                audience: s?.display_name ?? null,
                expected_reach: s?.base_count ?? null,
              });
            }}>
            <option value="">Select a segment</option>
            {families.map((f) => (
              <optgroup key={f} label={f}>
                {segments.filter((s) => s.segment_family === f).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.display_name}{s.base_count ? ` · ${(s.base_count / 1000).toFixed(0)}k` : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>

        <Field label="Second segment">
          <select value={campaign.segment_2_id ?? ""}
            onChange={(e) => save({ segment_2_id: e.target.value || null })}>
            <option value="">None</option>
            {segments.map((s) => <option key={s.id} value={s.id}>{s.display_name}</option>)}
          </select>
        </Field>

        <Field label="Tag" hint="Group ID follows the tag automatically.">
          <select value={campaign.push_tag ?? ""} onChange={(e) => save({ push_tag: e.target.value || null })}>
            <option value="">Select a tag</option>
            {tags.map((t) => <option key={t.tag} value={t.tag}>{t.label} ({t.tag})</option>)}
          </select>
        </Field>

        <Field label="Group ID">
          <input readOnly value={campaign.group_id ?? "—"} className="bg-[#F9FAFB] font-mono text-tiny" />
        </Field>

        <Field label="Collapse ID">
          <input defaultValue={campaign.collapse_id ?? ""} placeholder="1122 / 2233 / 4455"
            onBlur={(e) => save({ collapse_id: e.target.value || null })} />
        </Field>

        <Field label="PN template">
          <select value={campaign.pn_template ?? ""} onChange={(e) => save({ pn_template: e.target.value || null })}>
            <option value="">Select a template</option>
            {PN_TEMPLATES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </Field>

        <Field label="Access type">
          <select value={campaign.access_type ?? ""} onChange={(e) => save({ access_type: e.target.value || null })}>
            <option value="">Select</option>
            {ACCESS_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </Field>

        <Field label="Tracking code">
          <input defaultValue={campaign.tracking_code ?? ""} className="font-mono text-tiny"
            onBlur={(e) => save({ tracking_code: e.target.value || null })} />
        </Field>
      </div>

      <div className="flex flex-wrap gap-6">
        <label className="flex items-center gap-2 text-tiny text-body">
          <input type="checkbox" checked={campaign.global_limit ?? true}
            onChange={(e) => save({ global_limit: e.target.checked })} />
          Apply global limit
        </label>
        <label className="flex items-center gap-2 text-tiny text-body">
          <input type="checkbox" checked={campaign.sound ?? false}
            onChange={(e) => save({ sound: e.target.checked })} />
          Sound on delivery
        </label>
      </div>

      {/* Standard suppression, applied to every push segment */}
      <div className="rounded-lg border border-line bg-[#FCFCFD] px-4 py-3">
        <div className="text-micro font-medium uppercase tracking-wide text-faint">
          Standard exclusions applied
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {exclusions.map((e) => <Pill key={e.id} dot={false} label={e.label} tone="neutral" />)}
        </div>
      </div>
    </div>
  );
}

function Read({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-micro font-medium uppercase tracking-wide text-faint">{label}</div>
      <div className={`mt-1 break-words text-[13.5px] text-heading ${mono ? "font-mono text-tiny" : ""}`}>
        {value || "—"}
      </div>
    </div>
  );
}
