"use client";

import { useMemo, useState } from "react";
import { useSession } from "@/components/SessionProvider";
import { useCampaigns } from "@/components/useCampaigns";
import { CampaignDrawer } from "@/components/CampaignDrawer";
import { CampaignForm } from "@/components/CampaignForm";
import { StageChip } from "@/components/StatusChip";
import { Button, Card, Empty, Loading, Modal, PageHead, Pill } from "@/components/ui";
import { Icon } from "@/components/icons";
import { createCampaign, log, notify } from "@/services/campaigns";
import { fmtDate, fmtRelative, fmtTime } from "@/lib/format";

export default function EmergencyPage() {
  const { profile } = useSession();
  const { campaigns, loading, reload } = useCampaigns({ is_emergency: true });
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  // Scores are mocked for now; CRM ordering is what actually drives the queue.
  const ranked = useMemo(
    () => [...campaigns].sort((a, b) => (b.emergency_score ?? 50) - (a.emergency_score ?? 50)),
    [campaigns]
  );

  if (!profile) return null;
  const canRaise = profile.role === "CATEGORY" || profile.role === "CRM";

  return (
    <div className="space-y-6">
      <PageHead
        eyebrow="Emergency"
        title="Pushes outside the seven-day window"
        sub="An emergency skips the deadline, never the validation. Every mandatory field is still required before it enters the queue."
        action={canRaise ? <Button onClick={() => setCreating(true)}>{Icon.alert(14)} Raise emergency push</Button> : undefined}
      />

      {loading ? <Loading /> : ranked.length === 0 ? (
        <Card><Empty title="No emergency pushes" hint="Anything raised outside the standard deadline appears here, ranked for CRM." /></Card>
      ) : (
        <ol className="space-y-3">
          {ranked.map((c, i) => (
            <li key={c.id}
              className="flex cursor-pointer flex-wrap items-center gap-x-8 gap-y-4 rounded-xl border border-line bg-surface px-5 py-4 shadow-card transition-colors hover:border-indigo-300"
              onClick={() => setOpen(c.id)}>
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-danger-50 text-[14px] font-700 text-danger-700">
                {i + 1}
              </span>
              <div className="min-w-[220px] flex-1">
                <div className="font-display text-[15px] font-600 text-heading">{c.campaign_name}</div>
                <p className="mt-0.5 text-tiny text-muted">
                  {c.brand} · {c.category} · raised {fmtRelative(c.created_at)}
                </p>
              </div>
              <div>
                <div className="text-micro font-medium uppercase tracking-wide text-faint">Requested for</div>
                <div className="mt-1 text-tiny font-medium text-heading">{fmtDate(c.launch_date)} · {fmtTime(c.launch_time)}</div>
              </div>
              <div>
                <div className="text-micro font-medium uppercase tracking-wide text-faint">Business deadline</div>
                <div className="mt-1 text-tiny font-medium text-heading">{c.business_deadline ? fmtDate(c.business_deadline) : "—"}</div>
              </div>
              <Pill dot={false} label={`Score ${c.emergency_score ?? "—"}`} tone="indigo" />
              <StageChip campaign={c} />
            </li>
          ))}
        </ol>
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title="Raise an emergency push" width="max-w-3xl">
        <CampaignForm
          mode="EMERGENCY"
          onCancel={() => setCreating(false)}
          onSubmit={async (values) => {
            const created = await createCampaign({
              ...values, is_emergency: true, priority: "CRITICAL",
              category_status: "LOCKED", crm_status: "AWAITING_REVIEW",
              emergency_score: 90, submitted_at: new Date().toISOString(),
            }, profile.id);
            await log(created.id, profile.id, "EMERGENCY_RAISED",
              "Emergency push raised outside the seven-day window.");
            await notify("CRM", "EMERGENCY", "Emergency push raised",
              `${created.campaign_name} needs a slot for ${created.launch_date}.`, created.id);
            setCreating(false); await reload();
          }}
        />
      </Modal>

      <CampaignDrawer campaignId={open} profile={profile} onClose={() => setOpen(null)} onChanged={reload} />
    </div>
  );
}
