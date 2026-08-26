"use client";

import { useState } from "react";
import { useSession } from "@/components/SessionProvider";
import { useCampaigns } from "@/components/useCampaigns";
import { CampaignDrawer } from "@/components/CampaignDrawer";
import { CampaignForm } from "@/components/CampaignForm";
import { StageChip } from "@/components/StatusChip";
import { Button, Card, Empty, Loading, Modal, PageHead, TableCard } from "@/components/ui";
import { Icon } from "@/components/icons";
import { createCampaign, log } from "@/services/campaigns";
import { fmtDate, fmtTime } from "@/lib/format";

export default function PlannedPage() {
  const { profile } = useSession();
  const { campaigns, loading, reload } = useCampaigns({ campaign_origin: "CRM_PLANNED" });
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  if (!profile) return null;

  return (
    <div className="space-y-6">
      <PageHead
        eyebrow="CRM planned"
        title="Campaigns CRM raises directly"
        sub="Roughly half the calendar comes from CRM rather than Category — gaps, re-engagement, brand priorities and historical performance."
        action={<Button onClick={() => setCreating(true)}>{Icon.spark(14)} Create CRM campaign</Button>}
      />

      {loading ? <Loading /> : campaigns.length === 0 ? (
        <Card><Empty title="No CRM-planned campaigns yet" hint="Create one to fill a calendar gap without waiting on Category." /></Card>
      ) : (
        <TableCard>
          <table>
            <thead>
              <tr><th>Launch</th><th>Campaign</th><th>Category</th><th>Brand</th><th>Objective</th><th>Stage</th></tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id} className="cursor-pointer" onClick={() => setOpen(c.id)}>
                  <td className="whitespace-nowrap text-tiny text-muted">
                    {fmtDate(c.launch_date)} · {fmtTime(c.launch_time)}
                  </td>
                  <td className="font-medium text-heading">{c.campaign_name}</td>
                  <td className="text-muted">{c.category ?? "—"}</td>
                  <td className="text-muted">{c.brand ?? "—"}</td>
                  <td className="text-muted">{c.business_objective ?? "—"}</td>
                  <td><StageChip campaign={c} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title="Create CRM campaign" width="max-w-3xl">
        <CampaignForm
          mode="CRM_PLANNED"
          onCancel={() => setCreating(false)}
          onSubmit={async (values) => {
            const created = await createCampaign({
              ...values, campaign_origin: "CRM_PLANNED",
              category_status: "LOCKED", crm_status: "IN_PLANNING",
              submitted_at: new Date().toISOString(),
            }, profile.id);
            await log(created.id, profile.id, "CRM_PLANNED_CREATED", "CRM raised this campaign directly.");
            setCreating(false); await reload();
          }}
        />
      </Modal>

      <CampaignDrawer campaignId={open} profile={profile} onClose={() => setOpen(null)} onChanged={reload} />
    </div>
  );
}
