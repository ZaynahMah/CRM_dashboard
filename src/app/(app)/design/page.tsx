"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/components/SessionProvider";
import { listCampaigns, updateCampaign, log } from "@/services/campaigns";
import { fmtDate, fmtTime } from "@/lib/format";
import { Button, Card, Empty, Loading, PageHead, Pill, Tabs } from "@/components/ui";
import { Icon } from "@/components/icons";
import type { Campaign } from "@/types/campaign";

export default function DesignPage() {
  const { profile } = useSession();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [tab, setTab] = useState("category");
  const [status, setStatus] = useState("pending");

  const load = useCallback(async () => {
    setLoading(true);
    const all = await listCampaigns();
    setCampaigns(all.filter((c) => c.design_status !== "NOT_ASSIGNED"));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  /**
   * Design pastes a link to creative it hosts elsewhere. This app stores no
   * binary assets and uploads nothing — the field is a plain URL, saved by
   * campaign UUID.
   */
  const saveCreativeLink = async (campaignId: string, value: string) => {
    const link = value.trim() || null;
    await updateCampaign(campaignId, { creative_link: link } as Partial<Campaign>);
    setCampaigns((prev) => prev.map((c) => (c.id === campaignId ? { ...c, creative_link: link } : c)));
  };

  // Split by origin: a PN that came through Category carries brand/offer
  // context, a CRM-owned PN does not, and Design reads them differently.
  const emergencies = campaigns.filter((c) => c.is_emergency);
  const withCategoryInput = campaigns.filter((c) => !c.is_crm_self && !c.is_emergency);
  const crmOwned = campaigns.filter((c) => c.is_crm_self && !c.is_emergency);
  const bucket = tab === "crm_owned" ? crmOwned
    : tab === "emergency" ? emergencies
    : withCategoryInput;

  const pending = bucket.filter((c) => c.design_status === "PENDING");
  const submitted = bucket.filter((c) => c.design_status === "SUBMITTED");
  // Creative Link is optional: Design can hand a batch back without one
  // (some PNs are text-only). Previously only rows WITH a link could be
  // sent, which silently stranded the rest.
  const ready = pending;

  const handleBulkSend = async () => {
    if (!profile) return;
    setSubmitting(true);
    try {
      for (let i = 0; i < ready.length; i += 50) {
        const slice = ready.slice(i, i + 50);
        await Promise.all(slice.map((c) => updateCampaign(c.id, { design_status: "SUBMITTED" } as Partial<Campaign>)));
      }
      await log(null, profile.id, "DESIGN_BULK_SUBMIT", `Design submitted ${ready.length} completed assets to CRM.`);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Submission failed");
    }
    setSubmitting(false);
  };

  if (!profile) return null;
  if (loading) return <Loading label="Loading design queue" />;

  const rows = status === "pending" ? pending : submitted;

  return (
    <div className="space-y-5">
      <PageHead title="Design Queue"
        sub="Campaigns CRM has routed for creative, after Content has submitted. Creative Link is optional — send the batch back whether or not every row has one."
        action={ready.length > 0 && (
          <Button onClick={handleBulkSend} disabled={submitting}>
            {submitting ? "Sending..." : `Send ${ready.length} completed to CRM`}
          </Button>
        )}
      />

      {campaigns.length === 0 ? (
        <Card><Empty title="Nothing assigned yet" hint="Campaigns reach Design after Content submits and CRM routes them onward." /></Card>
      ) : (
        <>
          <Tabs active={tab} onChange={setTab} tabs={[
            { key: "category", label: "PNs with Category Input", count: withCategoryInput.length },
            { key: "crm_owned", label: "CRM-Owned PNs", count: crmOwned.length },
            ...(emergencies.length > 0
              ? [{ key: "emergency", label: "Emergency", count: emergencies.length }]
              : []),
          ]} />

          <Tabs active={status} onChange={setStatus} tabs={[
            { key: "pending", label: "Pending", count: pending.length },
            { key: "submitted", label: "Submitted", count: submitted.length },
          ]} />

          <Card pad={false} className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px]">
                <thead>
                  <tr>
                    <th>Day</th><th>Time</th><th>Segment</th><th>Category</th>
                    <th>Brand</th><th>Creative Link (optional)</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id}>
                      <td className="whitespace-nowrap text-tiny font-medium text-heading">{fmtDate(c.launch_date)}</td>
                      <td className="whitespace-nowrap text-tiny text-muted">{fmtTime(c.launch_time)}</td>
                      <td><Pill dot={false} label={c.pncc_segment_label ?? "—"} tone="indigo" /></td>
                      <td><Pill dot={false} label={c.pncc_category_code ?? c.category ?? "—"} tone="neutral" /></td>
                      <td className="text-tiny text-muted">{c.brand ?? "—"}</td>
                      <td className="min-w-[280px]">
                        <div className="flex items-center gap-2">
                          <input
                            className="!py-1 !text-tiny !font-mono"
                            defaultValue={c.creative_link ?? ""}
                            placeholder="Paste a link to the creative (optional)"
                            onBlur={(e) => saveCreativeLink(c.id, e.target.value)}
                          />
                          {c.creative_link && (
                            <button onClick={() => navigator.clipboard.writeText(c.creative_link!)}
                              className="shrink-0 rounded bg-[#F9FAFB] px-1.5 py-0.5 text-[10px] font-600 text-indigo-700 hover:bg-indigo-50">
                              Copy
                            </button>
                          )}
                        </div>
                      </td>
                      <td>{c.design_status === "SUBMITTED" && <Pill label="Submitted" tone="success" />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
