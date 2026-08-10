"use client";

import { useEffect, useState } from "react";
import type { Campaign, CrmDecision } from "@/types/campaign";
import type { Segment } from "@/types/targeting";
import type { Recommendation } from "@/data/mockRecommendations";
import { getRecommendation, OVERRIDE_REASONS } from "@/services/recommendations";
import { listSegments } from "@/services/targeting";
import { fmtTime } from "@/lib/format";
import { Button, Card, Field, Pill } from "./ui";
import { Icon } from "./icons";

/**
 * The panel talks to services/recommendations only. When the trained model
 * replaces the rules engine, nothing in this file changes.
 */
export function RecommendationPanel({ campaign, decision, readOnly, onApply }: {
  campaign: Campaign;
  decision: CrmDecision | null;
  readOnly?: boolean;
  onApply?: (patch: Partial<CrmDecision>, segmentId: string | null) => Promise<void>;
}) {
  const [rec, setRec] = useState<Recommendation | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [overriding, setOverriding] = useState(false);
  const [time, setTime] = useState(decision?.selected_time ?? campaign.launch_time ?? "19:30");
  const [reason, setReason] = useState(OVERRIDE_REASONS[0]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listSegments().then(async (segs) => {
      setSegments(segs);
      setRec(await getRecommendation(campaign, segs));
    });
  }, [campaign]);

  if (!rec) return null;

  const segment = segments.find((s) => s.moe_name === rec.segmentMoeName) ?? null;
  const applied = decision?.selected_time != null;
  const pct = Math.round(rec.confidence * 100);

  const patchFor = (selectedTime: string, override: boolean): Partial<CrmDecision> => ({
    recommended_date: campaign.launch_date,
    recommended_time: rec.bestTime,
    recommended_audience: rec.audience,
    recommended_cohort: rec.cohort,
    confidence: rec.confidence,
    recommendation_reason: rec.reason,
    selected_date: campaign.launch_date,
    selected_time: selectedTime,
    selected_audience: rec.audience,
    selected_cohort: rec.cohort,
    is_manual_override: override,
    override_reason: override ? reason : null,
  });

  return (
    <Card pad={false} className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-indigo-600 to-indigo-500 px-5 py-3.5">
        <div className="flex items-center gap-2.5 text-white">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-white/20">{Icon.spark(15)}</span>
          <div>
            <div className="text-[13.5px] font-600">Targeting recommendation</div>
            <div className="text-micro text-white/70">
              Rules engine · replaced by the trained model at the same boundary
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-white/25">
            <div className="h-full rounded-full bg-white transition-all duration-700" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-tiny font-600 text-white">{pct}%</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 px-5 py-4 md:grid-cols-4">
        <Detail label="Best day" value={rec.bestDay} />
        <Detail label="Best time" value={fmtTime(rec.bestTime)} />
        <Detail label="Cohort" value={rec.cohort} />
        <Detail label="Offer construct" value={rec.offerConstruct} />
      </div>

      {/* The audience is a real MoEngage segment, not a free-text label */}
      <div className="border-t border-line bg-[#FCFCFD] px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-micro font-medium uppercase tracking-wide text-faint">Recommended segment</div>
            <div className="mt-1 text-[14px] font-medium text-heading">{rec.audience}</div>
            {segment && (
              <div className="mt-1 font-mono text-micro text-muted">{segment.moe_name}</div>
            )}
          </div>
          {segment?.base_count != null && (
            <div className="text-right">
              <div className="text-micro text-faint">Reachable base</div>
              <div className="font-display text-[20px] font-700 text-heading">
                {segment.base_count.toLocaleString("en-IN")}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Why — the offer factors that actually drove this */}
      <div className="border-t border-line px-5 py-4">
        <div className="text-micro font-medium uppercase tracking-wide text-faint">Why</div>
        <ul className="mt-2.5 space-y-2">
          {rec.factors.map((f) => (
            <li key={f.factor} className="flex flex-wrap items-baseline gap-2">
              <Pill dot={false} label={f.factor} tone="indigo" />
              <span className="text-tiny text-muted">{f.reading}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-tiny leading-relaxed text-muted">{rec.reason}</p>
      </div>

      {decision?.is_manual_override && (
        <div className="border-t border-line bg-warning-50 px-5 py-3.5">
          <div className="flex items-center gap-2 text-tiny text-warning-700">
            <Pill label="Manual override" tone="warning" />
            <span>
              Recommended {fmtTime(decision.recommended_time)}, selected {fmtTime(decision.selected_time)} —{" "}
              {decision.override_reason}
            </span>
          </div>
        </div>
      )}

      {!readOnly && (
        <div className="border-t border-line px-5 py-4">
          {!overriding ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await onApply?.(patchFor(rec.bestTime, false), segment?.id ?? null);
                  setBusy(false);
                }}>
                Accept recommendation
              </Button>
              <Button variant="ghost" onClick={() => setOverriding(true)}>Select manually</Button>
              {applied && <Pill label="Applied" tone="success" />}
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Selected time">
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              </Field>
              <Field label="Override reason">
                <select value={reason} onChange={(e) => setReason(e.target.value)}>
                  {OVERRIDE_REASONS.map((r) => <option key={r}>{r}</option>)}
                </select>
              </Field>
              <div className="flex items-end gap-2">
                <Button disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    await onApply?.(patchFor(time, true), segment?.id ?? null);
                    setBusy(false); setOverriding(false);
                  }}>
                  Save override
                </Button>
                <Button variant="ghost" onClick={() => setOverriding(false)}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-micro font-medium uppercase tracking-wide text-faint">{label}</div>
      <div className="mt-1 text-[13.5px] text-heading">{value}</div>
    </div>
  );
}
