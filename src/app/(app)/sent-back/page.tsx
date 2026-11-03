"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "@/components/SessionProvider";
import { useCampaigns } from "@/components/useCampaigns";
import { CampaignDrawer } from "@/components/CampaignDrawer";
import { Button, Card, Empty, Loading, PageHead, Pill } from "@/components/ui";
import { fmtDate, fmtRelative, fmtTime, slotDisplay } from "@/lib/format";
import { loadRejections, isRejected, type RejectionInfo } from "@/services/rejected";

/**
 * Every PN CRM has sent back, across all weeks.
 *
 * "Sent back by CRM", never "Rejected": a rejected CHANGE REQUEST on the
 * Changes page is a different thing, and the two were being confused.
 *
 * Detection is `rejected.ts`'s single query — the fact lives in
 * activity_logs, and asking per PN would be thousands of requests.
 */
export default function SentBackPage() {
  const { profile } = useSession();
  const { campaigns, loading, error, reload } = useCampaigns();
  const [rejections, setRejections] = useState<Map<string, RejectionInfo>>(new Map());
  const [openId, setOpenId] = useState<string | null>(null);

  const loadBack = useCallback(() => {
    loadRejections().then(setRejections).catch(() => setRejections(new Map()));
  }, []);
  useEffect(() => { loadBack(); }, [loadBack, campaigns]);

  /** Newest first, so the most recent send-back is at the top. */
  const rows = useMemo(() => campaigns
    .filter((c) => isRejected(c, rejections))
    .sort((a, b) => {
      const ra = rejections.get(a.id)?.at ?? "";
      const rb = rejections.get(b.id)?.at ?? "";
      return rb.localeCompare(ra);
    }), [campaigns, rejections]);

  if (!profile) return null;
  if (loading) return <Loading label="Loading PNs sent back" />;

  if (error) {
    return (
      <Card>
        <p className="text-tiny text-danger-700">Could not load campaigns: {error}</p>
        <button onClick={() => reload()}
          className="mt-2 text-tiny font-medium text-indigo-700 hover:underline">
          Try again
        </button>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <PageHead eyebrow="Category" title="Sent back by CRM"
        sub="PNs CRM returned for changes. Fix them and resubmit — each one leaves this list once it goes back." />

      {rows.length === 0 ? (
        <Card>
          <Empty title="Nothing sent back"
            hint="When CRM returns a PN for changes it appears here with their reason." />
        </Card>
      ) : (
        <Card pad={false}>
          <div className="flex items-center gap-2 border-b border-line px-5 py-3.5">
            <h3 className="font-display text-[15px] font-600 text-heading">
              Sent back by CRM
            </h3>
            <Pill dot={false} tone="danger" label={String(rows.length)} />
          </div>
          <ul className="divide-y divide-line">
            {rows.map((c) => {
              const r = rejections.get(c.id)!;
              return (
                <li key={c.id} className="px-5 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <button onClick={() => setOpenId(c.id)}
                      className="text-[13px] font-medium text-heading hover:underline">
                      {c.campaign_name}
                    </button>
                    <span className="text-micro text-faint">
                      {fmtDate(c.launch_date)} · {fmtTime(c.launch_time)} · slot {slotDisplay(c)}
                      {c.category ? ` · ${c.category}` : ""}
                      {c.brand ? ` · ${c.brand}` : ""}
                    </span>
                    <span className="ml-auto text-micro text-faint">
                      {r.byName ?? "CRM"} · {fmtRelative(r.at)}
                    </span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-micro text-danger-700">
                    {r.reason}
                  </p>
                  <Button size="sm" variant="ghost" onClick={() => setOpenId(c.id)}>
                    Open PN
                  </Button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {openId && (
        <CampaignDrawer campaignId={openId} profile={profile}
          onClose={() => setOpenId(null)}
          onChanged={() => { reload(); loadBack(); }} />
      )}
    </div>
  );
}
