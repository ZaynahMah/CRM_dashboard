"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "@/components/SessionProvider";
import { SlotBoard } from "@/components/SlotBoard";
import { CampaignDrawer } from "@/components/CampaignDrawer";
import { CampaignForm } from "@/components/CampaignForm";
import { Button, Card, Modal, PageHead, StatCard, StatGrid, Loading } from "@/components/ui";
import { createMonth, DEFAULT_SLOT_TIMES, fetchMonth, type DayWithSlots } from "@/services/calendar";
import { createCampaign, log, notify } from "@/services/campaigns";
import { fmtMonth } from "@/lib/format";
import { Icon } from "@/components/icons";
import type { Campaign } from "@/types/campaign";

export default function CalendarPage() {
  const { profile } = useSession();
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [days, setDays] = useState<DayWithSlots[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [claim, setClaim] = useState<{ date: string; slotId: string; time: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setDays(await fetchMonth(cursor.getFullYear(), cursor.getMonth()));
    setLoading(false);
  }, [cursor]);

  useEffect(() => { load(); }, [load]);

  const health = useMemo(() => {
    const slots = days.flatMap((d) => d.slots);
    const filled = slots.filter((s) => s.campaign).length;
    return { slots: slots.length, filled, open: slots.length - filled, dates: days.length };
  }, [days]);

  if (!profile) return null;
  const isCrm = profile.role === "CRM";
  const canClaim = profile.role === "CATEGORY" || isCrm;

  return (
    <div className="space-y-6">
      <PageHead
        eyebrow="Push calendar"
        title={fmtMonth(cursor)}
        sub={isCrm
          ? "CRM opens the dates and slots. Everything downstream is planned against this board."
          : "Open slots are claimable. Date and time come from CRM and stay fixed once claimed."}
        action={
          <div className="flex items-center gap-3">
            <Button size="sm" variant="ghost" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}>
              Previous
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}>
              Next
            </Button>
            {isCrm && (
              <Button disabled={busy} onClick={async () => {
                setBusy(true);
                await createMonth(cursor.getFullYear(), cursor.getMonth(), DEFAULT_SLOT_TIMES, profile.id);
                await load(); setBusy(false);
              }}>
                {busy ? "Opening month" : "Open this month"}
              </Button>
            )}
          </div>
        }
      />

      <StatGrid>
        <StatCard label="Dates open" value={health.dates} icon={Icon.calendar(14)} tone="indigo" />
        <StatCard label="Slots created" value={health.slots} icon={Icon.list(14)} tone="neutral" />
        <StatCard label="Filled" value={health.filled} icon={Icon.check(14)} tone="success" />
        <StatCard label="Available" value={health.open} icon={Icon.clock(14)} tone="warning" />
      </StatGrid>

      {loading ? <Loading label="Loading the board" /> : (
        <SlotBoard
          days={days}
          canClaim={canClaim}
          onOpenCampaign={(c: Campaign) => setOpen(c.id)}
          onClaimSlot={(date, slotId, time) => setClaim({ date, slotId, time })}
        />
      )}

      <Modal open={!!claim} onClose={() => setClaim(null)} title="Add campaign to this slot" width="max-w-3xl">
        {claim && (
          <CampaignForm
            mode={isCrm ? "CRM_PLANNED" : "CATEGORY"}
            slot={claim}
            onCancel={() => setClaim(null)}
            onSubmit={async (values) => {
              const created = await createCampaign({
                ...values,
                category_status: "LOCKED",
                crm_status: "AWAITING_REVIEW",
                submitted_at: new Date().toISOString(),
              }, profile.id);
              await log(created.id, profile.id, "CATEGORY_SUBMITTED",
                "Campaign details submitted against the CRM slot.");
              await notify("CRM", "REVIEW", "Campaign awaiting review",
                `${created.campaign_name} was submitted for ${created.launch_date}.`, created.id);
              setClaim(null);
              await load();
            }}
          />
        )}
      </Modal>

      <CampaignDrawer campaignId={open} profile={profile} onClose={() => setOpen(null)} onChanged={load} />
    </div>
  );
}
