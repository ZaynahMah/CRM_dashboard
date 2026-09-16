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
  const [tab, setTab] = useState("pending");

  const load = useCallback(async () => {
    setLoading(true);
    const all = await listCampaigns();
    setCampaigns(all.filter((c) => c.design_status !== "NOT_ASSIGNED"));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleImageUpload = async (campaignId: string, file: File) => {
    // Prototype only — a real deployment wires this to actual object storage.
    const url = URL.createObjectURL(file);
    const placeholderUrl = `https://s3.ap-south-1.amazonaws.com/cliq-push-assets/${campaignId}/${file.name}`;
    await updateCampaign(campaignId, { creative_link: placeholderUrl } as Partial<Campaign>);
    setCampaigns((prev) => prev.map((c) =>
      c.id === campaignId ? { ...c, creative_link: placeholderUrl, _localPreview: url } as Campaign & { _localPreview?: string } : c
    ));
  };

  const pending = campaigns.filter((c) => c.design_status === "PENDING");
  const submitted = campaigns.filter((c) => c.design_status === "SUBMITTED");
  const ready = pending.filter((c) => c.creative_link);

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

  const rows = tab === "pending" ? pending : submitted;

  return (
    <div className="space-y-5">
      <PageHead title="Design Queue"
        sub="Campaigns CRM has routed for creative — upload an image per row, then send the batch back to CRM."
        action={ready.length > 0 && (
          <Button onClick={handleBulkSend} disabled={submitting}>
            {submitting ? "Sending..." : `Send ${ready.length} completed to CRM`}
          </Button>
        )}
      />

      {campaigns.length === 0 ? (
        <Card><Empty title="Nothing assigned yet" hint="Once CRM sends a batch to Content and Design, campaigns needing an image will appear here." /></Card>
      ) : (
        <>
          <Tabs active={tab} onChange={setTab} tabs={[
            { key: "pending", label: "Pending", count: pending.length },
            { key: "submitted", label: "Submitted", count: submitted.length },
          ]} />

          <Card pad={false} className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px]">
                <thead>
                  <tr>
                    <th>Day</th><th>Time</th><th>Segment</th><th>Category</th>
                    <th>Brand</th><th>Image</th><th>Image URL</th><th></th>
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
                      <td className="min-w-[120px]">
                        {c.creative_link ? (
                          <div className="flex items-center gap-2">
                            <div className="h-10 w-10 overflow-hidden rounded-lg border border-line bg-[#F9FAFB]">
                              <img src={(c as Campaign & { _localPreview?: string })._localPreview || c.creative_link}
                                alt="" className="h-full w-full object-cover"
                                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                            </div>
                            <label className="cursor-pointer text-micro font-medium text-indigo-700 hover:underline">
                              Replace
                              <input type="file" accept="image/*" className="hidden"
                                onChange={(e) => e.target.files?.[0] && handleImageUpload(c.id, e.target.files[0])} />
                            </label>
                          </div>
                        ) : (
                          <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-line px-3 py-2 text-micro text-muted transition-colors hover:border-indigo-300 hover:text-indigo-700">
                            {Icon.spark(12)} Upload
                            <input type="file" accept="image/*" className="hidden"
                              onChange={(e) => e.target.files?.[0] && handleImageUpload(c.id, e.target.files[0])} />
                          </label>
                        )}
                      </td>
                      <td className="max-w-[200px]">
                        {c.creative_link ? (
                          <div className="flex items-center gap-2">
                            <span className="truncate font-mono text-[10px] text-muted">{c.creative_link}</span>
                            <button onClick={() => navigator.clipboard.writeText(c.creative_link!)}
                              className="shrink-0 rounded bg-[#F9FAFB] px-1.5 py-0.5 text-[10px] font-600 text-indigo-700 hover:bg-indigo-50">
                              Copy
                            </button>
                          </div>
                        ) : <span className="text-micro text-faint">No image</span>}
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
