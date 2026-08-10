"use client";

import { useMemo, useState } from "react";
import { useSession } from "@/components/SessionProvider";
import { useCampaigns } from "@/components/useCampaigns";
import { CampaignDrawer } from "@/components/CampaignDrawer";
import { OriginChip, StageChip } from "@/components/StatusChip";
import { Card, Empty, Loading, PageHead, StatCard, StatGrid, TableCard } from "@/components/ui";
import { Icon } from "@/components/icons";
import { notReadyReason, stageOf } from "@/lib/workflow";
import { fmtDate, fmtTime } from "@/lib/format";

export default function QcPage() {
  const { profile } = useSession();
  const { campaigns, loading, reload } = useCampaigns();
  const [open, setOpen] = useState<string | null>(null);

  const groups = useMemo(() => ({
    inQc: campaigns.filter((c) => ["CONTENT_SUBMITTED", "FINAL_QC"].includes(stageOf(c))),
    ready: campaigns.filter((c) => stageOf(c) === "READY"),
    pushed: campaigns.filter((c) => stageOf(c) === "PUSHED"),
    notReady: campaigns.filter((c) => ["CONTENT_PENDING", "AWAITING_CATEGORY", "BLOCKED"].includes(stageOf(c))),
  }), [campaigns]);

  if (!profile) return null;

  return (
    <div className="space-y-6">
      <PageHead
        eyebrow="CRM · Final QC"
        title="Ready to go"
        sub="A campaign only becomes ready when every QC line is verified. Anything short of that shows the reason it is held."
      />

      <StatGrid>
        <StatCard label="In QC" value={groups.inQc.length} icon={Icon.check(14)} tone="indigo" />
        <StatCard label="Ready" value={groups.ready.length} icon={Icon.send(14)} tone="success" />
        <StatCard label="Pushed" value={groups.pushed.length} icon={Icon.bell(14)} tone="neutral" />
        <StatCard label="Not ready" value={groups.notReady.length} icon={Icon.alert(14)} tone="danger" />
      </StatGrid>

      {loading ? <Loading /> : (
        <>
          <Section title="Awaiting final QC" rows={groups.inQc} onOpen={setOpen}
            empty="Nothing is waiting on QC right now." />
          <Section title="Ready" rows={groups.ready} onOpen={setOpen}
            empty="No campaigns have cleared QC yet." />
          <Section title="Not ready" rows={groups.notReady} onOpen={setOpen} showReason
            empty="Everything upcoming is moving." />
        </>
      )}

      <CampaignDrawer campaignId={open} profile={profile} onClose={() => setOpen(null)} onChanged={reload} />
    </div>
  );
}

function Section({ title, rows, onOpen, empty, showReason }: {
  title: string;
  rows: import("@/types/campaign").Campaign[];
  onOpen: (id: string) => void;
  empty: string;
  showReason?: boolean;
}) {
  return (
    <section>
      <h2 className="mb-3 font-display text-[15px] font-600 text-heading">{title}</h2>
      <TableCard>
        {rows.length === 0 ? <Empty title="Clear" hint={empty} /> : (
          <table>
            <thead>
              <tr>
                <th>Launch</th><th>Campaign</th><th>Origin</th><th>Brand</th>
                <th>Audience</th><th>{showReason ? "Held on" : "Stage"}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="cursor-pointer" onClick={() => onOpen(c.id)}>
                  <td className="whitespace-nowrap text-tiny text-muted">
                    {fmtDate(c.launch_date)} · {fmtTime(c.launch_time)}
                  </td>
                  <td className="max-w-[240px] truncate font-medium text-heading">{c.campaign_name}</td>
                  <td><OriginChip campaign={c} /></td>
                  <td className="text-muted">{c.brand ?? "—"}</td>
                  <td className="text-muted">{c.audience ?? "—"}</td>
                  <td>{showReason
                    ? <span className="text-tiny text-danger-700">{notReadyReason(c)}</span>
                    : <StageChip campaign={c} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
    </section>
  );
}
