"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "@/components/SessionProvider";
import { listCampaigns, updateCampaign } from "@/services/campaigns";
import { fmtDate, fmtTime, isoDate } from "@/lib/format";
import { Button, Card, Empty, Loading, Pill } from "@/components/ui";
import { Icon } from "@/components/icons";
import type { Campaign } from "@/types/campaign";

export default function SepCampaignsPage() {
  const { profile } = useSession();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterDate, setFilterDate] = useState("");

  useEffect(() => {
    listCampaigns().then((all) => {
      setCampaigns(all.filter((c) => c.launch_date >= "2026-09-01" && c.launch_date <= "2026-09-30"));
      setLoading(false);
    });
  }, []);

  const rows = filterDate ? campaigns.filter((c) => c.launch_date === filterDate) : campaigns;
  const dates = [...new Set(campaigns.map((c) => c.launch_date))].sort();

  const handleImageUpload = async (campaignId: string, file: File) => {
    // In production this goes to S3. For the prototype, we create a local object URL
    // and store a placeholder URL. The S3 integration will replace this.
    const url = URL.createObjectURL(file);
    const fakeS3Url = `https://s3.ap-south-1.amazonaws.com/cliq-push-assets/${campaignId}/${file.name}`;
    await updateCampaign(campaignId, { creative_link: fakeS3Url } as any);
    setCampaigns((prev) => prev.map((c) =>
      c.id === campaignId ? { ...c, creative_link: fakeS3Url, _localPreview: url } as any : c
    ));
  };

  if (!profile) return null;
  if (loading) return <Loading label="Loading September campaigns" />;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-[20px] font-700 text-heading">September Campaigns — Image Upload</h1>
          <p className="mt-1 text-tiny text-muted">Upload images against each PN. Images are stored and URLs generated for CRM.</p>
        </div>
      </div>

      <div className="flex gap-3">
        <select value={filterDate} onChange={(e) => setFilterDate(e.target.value)} className="!w-auto text-tiny">
          <option value="">All dates ({campaigns.length})</option>
          {dates.map((d) => <option key={d} value={d}>{fmtDate(d)}</option>)}
        </select>
      </div>

      {rows.length === 0 ? (
        <Card><Empty title="No September campaigns" hint="CRM has not populated September data yet." /></Card>
      ) : (
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
                {rows.slice(0, 80).map((c) => (
                  <tr key={c.id}>
                    <td className="whitespace-nowrap text-tiny font-medium text-heading">{fmtDate(c.launch_date)}</td>
                    <td className="whitespace-nowrap text-tiny text-muted">{fmtTime(c.launch_time)}</td>
                    <td><Pill dot={false} label={c.pncc_segment_label ?? "—"} tone="indigo" /></td>
                    <td><Pill dot={false} label={c.pncc_category_code ?? c.category ?? "—"} tone="neutral" /></td>
                    <td className="text-tiny text-muted">{c.brand ?? "—"}</td>
                    <td className="min-w-[120px]">
                      {(c as any)._localPreview || c.creative_link ? (
                        <div className="flex items-center gap-2">
                          <div className="h-10 w-10 overflow-hidden rounded-lg border border-line bg-[#F9FAFB]">
                            <img src={(c as any)._localPreview || c.creative_link}
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
                          <button
                            onClick={() => { navigator.clipboard.writeText(c.creative_link!); }}
                            className="shrink-0 rounded bg-[#F9FAFB] px-1.5 py-0.5 text-[10px] font-600 text-indigo-700 hover:bg-indigo-50">
                            Copy
                          </button>
                        </div>
                      ) : (
                        <span className="text-micro text-faint">No image</span>
                      )}
                    </td>
                    <td></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 80 && (
              <div className="border-t border-line px-4 py-2 text-micro text-faint">
                Showing 80 of {rows.length} — filter by date to see more
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
