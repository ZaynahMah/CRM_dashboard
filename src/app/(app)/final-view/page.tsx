"use client";

import { useMemo, useState } from "react";
import { useSession } from "@/components/SessionProvider";
import { useCampaigns } from "@/components/useCampaigns";
import { CampaignDrawer } from "@/components/CampaignDrawer";
import { StageChip, OriginChip } from "@/components/StatusChip";
import { Button, Card, Empty, Loading, PageHead, StatCard, StatGrid, TableCard } from "@/components/ui";
import { Icon } from "@/components/icons";
import { downloadCSV } from "@/services/exportExcel";
import { fmtDate, fmtTime } from "@/lib/format";

/**
 * The single finalized view — Final View and the Calendar are the same
 * operational output. A campaign appears here for exactly one reason:
 * calendar_status = 'UPDATED', set only by CRM's explicit "Update Calendar"
 * action after Final QC has passed. Nothing else puts a row on this page —
 * not content/design completion, not QC passing, not any heuristic.
 */
export default function FinalViewPage() {
  const { profile } = useSession();
  const { campaigns, loading, reload } = useCampaigns();
  const [open, setOpen] = useState<string | null>(null);

  const finalized = useMemo(
    () => campaigns.filter((c) => c.calendar_status === "UPDATED"),
    [campaigns]
  );
  const pendingCalendar = useMemo(
    () => campaigns.filter((c) => c.qc_status === "PASSED" && c.calendar_status !== "UPDATED"),
    [campaigns]
  );

  if (!profile) return null;
  if (profile.role !== "CRM" && profile.role !== "EXECUTIVE") {
    return <Card><Empty title="Not available" hint="The Final View is CRM and Executive only." /></Card>;
  }
  if (loading) return <Loading label="Loading the final view" />;

  return (
    <div className="space-y-6">
      <PageHead
        title="Final View / Calendar"
        sub="Only campaigns CRM has explicitly clicked “Update Calendar” for, after Final QC passed. This is the same list the Calendar page shows."
        action={profile.role === "CRM" && (
          <Button onClick={() => downloadCSV(finalized, `PN_Final_Consolidated_${new Date().toISOString().slice(0, 10)}.csv`)}
            disabled={finalized.length === 0}>
            {Icon.chart(14)} Export finalized
          </Button>
        )}
      />

      <StatGrid>
        <StatCard label="Finalized" value={finalized.length} tone="success" icon={Icon.check(14)} />
        <StatCard label="QC passed, not yet finalized" value={pendingCalendar.length} tone="warning" icon={Icon.clock(14)} />
        <StatCard label="Total campaigns" value={campaigns.length} tone="neutral" icon={Icon.list(14)} />
      </StatGrid>

      {finalized.length === 0 ? (
        <Card>
          <Empty title="Nothing finalized yet"
            hint={pendingCalendar.length > 0
              ? `${pendingCalendar.length} campaign${pendingCalendar.length === 1 ? " has" : "s have"} passed Final QC and just need CRM to click Update Calendar.`
              : "Campaigns land here only after Final QC passes and CRM explicitly clicks Update Calendar."} />
        </Card>
      ) : (
        <TableCard>
          <table>
            <thead>
              <tr>
                <th>Launch</th><th>Campaign</th><th>Origin</th><th>Brand</th><th>Offer</th>
                <th>Finalized</th><th>Stage</th>
              </tr>
            </thead>
            <tbody>
              {finalized.map((c) => (
                <tr key={c.id} className="cursor-pointer" onClick={() => setOpen(c.id)}>
                  <td className="whitespace-nowrap text-tiny text-muted">{fmtDate(c.launch_date)} · {fmtTime(c.launch_time)}</td>
                  <td className="max-w-[200px] truncate font-medium text-heading">{c.campaign_name}</td>
                  <td><OriginChip campaign={c} /></td>
                  <td className="text-muted">{c.brand}</td>
                  <td className="max-w-[140px] truncate text-muted">{c.offer}</td>
                  <td className="whitespace-nowrap text-tiny text-muted">
                    {c.calendar_updated_at ? fmtDate(c.calendar_updated_at.slice(0, 10)) : "—"}
                  </td>
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
