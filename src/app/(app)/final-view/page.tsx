"use client";

import { useMemo, useState } from "react";
import { useSession } from "@/components/SessionProvider";
import { useCampaigns } from "@/components/useCampaigns";
import { CampaignDrawer } from "@/components/CampaignDrawer";
import { StageChip, OriginChip } from "@/components/StatusChip";
import { Button, Card, Empty, Loading, PageHead, Pill, StatCard, StatGrid, TableCard } from "@/components/ui";
import { Icon } from "@/components/icons";
import { downloadCSV } from "@/services/exportExcel";
import { fmtDate, fmtTime } from "@/lib/format";

/**
 * The single consolidated view of everything that has cleared the full
 * pipeline: Category filled it, CRM completed its own fields, Content wrote
 * copy, Design attached an image. This is what CRM downloads and hands off
 * for actual production execution.
 */
export default function FinalViewPage() {
  const { profile } = useSession();
  const { campaigns, loading, reload } = useCampaigns();
  const [open, setOpen] = useState<string | null>(null);

  const consolidated = useMemo(() => campaigns.filter((c) =>
    (c.brand && c.offer) &&
    (c.is_crm_self || c.content_status === "SUBMITTED") &&
    (c.is_crm_self || c.design_status === "SUBMITTED" || c.design_status === "NOT_ASSIGNED")
  ), [campaigns]);

  const readyToPublish = consolidated.filter((c) => c.production_status === "READY" || c.production_status === "PUSHED");
  const stillInQc = consolidated.filter((c) => c.production_status !== "READY" && c.production_status !== "PUSHED");

  if (!profile) return null;
  if (profile.role !== "CRM") {
    return <Card><Empty title="Not available" hint="The Final View is CRM-only." /></Card>;
  }
  if (loading) return <Loading label="Loading the final view" />;

  return (
    <div className="space-y-6">
      <PageHead
        title="Final View"
        sub="Every campaign that has cleared Category, CRM, Content and Design — the consolidated sheet ready for production."
        action={
          <Button onClick={() => downloadCSV(consolidated, `PN_Final_Consolidated_${new Date().toISOString().slice(0,10)}.csv`)}
            disabled={consolidated.length === 0}>
            {Icon.chart(14)} Download final sheet
          </Button>
        }
      />

      <StatGrid>
        <StatCard label="Consolidated" value={consolidated.length} tone="indigo" icon={Icon.list(14)} />
        <StatCard label="Ready / pushed" value={readyToPublish.length} tone="success" icon={Icon.check(14)} />
        <StatCard label="Still in QC" value={stillInQc.length} tone="warning" icon={Icon.clock(14)} />
        <StatCard label="Total campaigns" value={campaigns.length} tone="neutral" icon={Icon.calendar(14)} />
      </StatGrid>

      {consolidated.length === 0 ? (
        <Card><Empty title="Nothing consolidated yet" hint="Campaigns land here once Category, Content and Design have all completed their part." /></Card>
      ) : (
        <TableCard>
          <table>
            <thead>
              <tr>
                <th>Launch</th><th>Campaign</th><th>Origin</th><th>Brand</th><th>Offer</th>
                <th>Content</th><th>Design</th><th>Stage</th>
              </tr>
            </thead>
            <tbody>
              {consolidated.map((c) => (
                <tr key={c.id} className="cursor-pointer" onClick={() => setOpen(c.id)}>
                  <td className="whitespace-nowrap text-tiny text-muted">{fmtDate(c.launch_date)} · {fmtTime(c.launch_time)}</td>
                  <td className="max-w-[200px] truncate font-medium text-heading">{c.campaign_name}</td>
                  <td><OriginChip campaign={c} /></td>
                  <td className="text-muted">{c.brand}</td>
                  <td className="max-w-[140px] truncate text-muted">{c.offer}</td>
                  <td><Pill label={c.is_crm_self ? "N/A" : c.content_status} tone={c.is_crm_self ? "neutral" : c.content_status === "SUBMITTED" ? "success" : "warning"} /></td>
                  <td><Pill label={c.is_crm_self ? "N/A" : c.design_status} tone={c.is_crm_self ? "neutral" : c.design_status === "SUBMITTED" ? "success" : "warning"} /></td>
                  <td><StageChip campaign={c} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      )}

      <CampaignDrawer campaignId={open} profile={profile} onClose={() => setOpen(null)} onChanged={reload} />
    </div>
  );
}
