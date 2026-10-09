"use client";

import { useMemo, useState } from "react";
import { useSession } from "@/components/SessionProvider";
import { useCampaigns } from "@/components/useCampaigns";
import { CampaignDrawer } from "@/components/CampaignDrawer";
import { CampaignForm } from "@/components/CampaignForm";
import { StageChip } from "@/components/StatusChip";
import { Button, Card, Empty, Field, Loading, Modal, PageHead, Pill } from "@/components/ui";
import { Icon } from "@/components/icons";
import { createCampaign, log, notify, acceptEmergency, rejectEmergency } from "@/services/campaigns";
import { fmtDate, fmtRelative, fmtTime } from "@/lib/format";
import type { Campaign } from "@/types/campaign";

export default function EmergencyPage() {
  const { profile } = useSession();
  const { campaigns, loading, reload } = useCampaigns({ is_emergency: true });
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<Campaign | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const role = profile?.role;

  /**
   * Content can see emergencies too, scoped to the ones that
   * have actually reached their leg of the workflow — an emergency still
   * sitting with CRM is not yet their problem, and showing it would just be
   * noise they cannot act on.
   */
  const ranked = useMemo(() => {
    const visible = campaigns.filter((c) => {
      if (role === "CONTENT") return c.content_status !== "NOT_ASSIGNED";
      return true;
    });
    return [...visible].sort((a, b) => (b.emergency_score ?? 50) - (a.emergency_score ?? 50));
  }, [campaigns, role]);

  if (!profile) return null;
  const canRaise = profile.role === "CATEGORY" || profile.role === "CRM";
  const isCrm = profile.role === "CRM";

  const statusTone = (s: Campaign["emergency_status"]) =>
    s === "ACCEPTED" ? "success" : s === "REJECTED" ? "danger" : "warning";

  return (
    <div className="space-y-6">
      <PageHead
        eyebrow="Emergency"
        title="Pushes outside the seven-day window"
        sub={role === "CONTENT"
          ? "Emergency pushes that have reached Content. These jump the normal queue — handle them first."
          : "Time is mandatory when Category raises an emergency push. CRM accepts into that exact slot, or rejects with a reason."}
        action={canRaise ? <Button onClick={() => setCreating(true)}>{Icon.alert(14)} Raise emergency push</Button> : undefined}
      />

      {loading ? <Loading /> : ranked.length === 0 ? (
        <Card><Empty title="No emergency pushes"
          hint={role === "CONTENT"
            ? "Nothing urgent has reached you. Emergency pushes appear here as soon as CRM routes them your way."
            : "Anything raised outside the standard deadline appears here, ranked for CRM."} /></Card>
      ) : (
        <ol className="space-y-3">
          {ranked.map((c, i) => (
            <li key={c.id}
              className="flex flex-wrap items-center gap-x-6 gap-y-4 rounded-xl border border-line bg-surface px-5 py-4 shadow-card transition-colors hover:border-indigo-300">
              <button onClick={() => setOpen(c.id)} className="flex flex-1 flex-wrap items-center gap-x-6 gap-y-4 text-left">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-danger-50 text-[14px] font-700 text-danger-700">
                  {i + 1}
                </span>
                <div className="min-w-[200px] flex-1">
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
                <Pill label={c.emergency_status} tone={statusTone(c.emergency_status)} />
                <StageChip campaign={c} />
              </button>

              {isCrm && c.emergency_status === "PENDING" && (
                <div className="flex shrink-0 gap-2" onClick={(e) => e.stopPropagation()}>
                  <Button size="sm" disabled={busy} onClick={async () => {
                    setBusy(true); await acceptEmergency(c, profile.id); await reload(); setBusy(false);
                  }}>
                    {Icon.check(13)} Accept
                  </Button>
                  <Button size="sm" variant="danger" disabled={busy} onClick={() => { setRejecting(c); setReason(""); }}>
                    Reject
                  </Button>
                </div>
              )}
              {c.emergency_status === "REJECTED" && c.emergency_rejection_reason && (
                <span className="text-tiny text-danger-700">Reason: {c.emergency_rejection_reason}</span>
              )}
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
              emergency_status: "PENDING", emergency_score: 90, submitted_at: new Date().toISOString(),
            }, profile.id);
            await log(created.id, profile.id, "EMERGENCY_RAISED",
              `Emergency push raised for ${created.launch_date} ${created.launch_time} — awaiting CRM accept/reject.`);
            await notify("CRM", "EMERGENCY", "Emergency push raised",
              `${created.campaign_name} needs review for ${created.launch_date} ${created.launch_time}.`, created.id);
            setCreating(false); await reload();
          }}
        />
      </Modal>

      <Modal open={!!rejecting} onClose={() => setRejecting(null)} title="Reject emergency push"
        sub={rejecting?.campaign_name}>
        <div className="space-y-4">
          <Field label="Reason" required>
            <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="Why this can't be accommodated" />
          </Field>
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setRejecting(null)}>Cancel</Button>
            <Button variant="danger" disabled={!reason.trim() || busy} onClick={async () => {
              if (!rejecting) return;
              setBusy(true);
              await rejectEmergency(rejecting, reason, profile.id);
              setBusy(false); setRejecting(null); await reload();
            }}>
              Reject
            </Button>
          </div>
        </div>
      </Modal>

      <CampaignDrawer campaignId={open} profile={profile} onClose={() => setOpen(null)} onChanged={reload} />
    </div>
  );
}
