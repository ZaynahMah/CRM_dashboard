"use client";

import { Pill, type Tone } from "./ui";
import { STAGE_LABEL, stageOf, type Stage } from "@/lib/workflow";
import { DEADLINE_LABEL, deadlineState } from "@/lib/deadlines";
import type { Campaign } from "@/types/campaign";
import { CHANNEL_LABEL } from "@/types/targeting";

const STAGE_TONE: Record<Stage, Tone> = {
  AWAITING_CATEGORY: "neutral",
  CATEGORY_SUBMITTED: "info",
  CRM_REVIEW: "warning",
  CRM_PROCESSING: "info",
  PRODUCTION_PENDING: "warning",
  PRODUCTION_SUBMITTED: "info",
  FINAL_QC: "indigo",
  READY: "success",
  BLOCKED: "danger",
};

export function StageChip({ campaign }: { campaign: Campaign }) {
  const s = stageOf(campaign);
  return <Pill label={STAGE_LABEL[s]} tone={STAGE_TONE[s]} />;
}

export function DeadlineChip({ campaign }: { campaign: Campaign }) {
  const s = deadlineState(campaign);
  const tone: Tone = { COMPLETED: "success", EMERGENCY: "danger", OVERDUE: "danger",
    DUE_TODAY: "warning", DUE_SOON: "warning", ON_TRACK: "neutral" }[s] as Tone;
  return <Pill label={DEADLINE_LABEL[s]} tone={tone} />;
}

export function OriginChip({ campaign }: { campaign: Campaign }) {
  const isCategory = campaign.campaign_origin === "CATEGORY_REQUEST";
  return <Pill dot={false} label={isCategory ? "Category" : "CRM planned"} tone={isCategory ? "neutral" : "indigo"} />;
}

export function ChannelChip({ campaign }: { campaign: Campaign }) {
  const c = campaign.channel ?? "PN";
  return <Pill dot={false} label={CHANNEL_LABEL[c] ?? c} tone={c === "PN" ? "indigo" : "neutral"} />;
}
