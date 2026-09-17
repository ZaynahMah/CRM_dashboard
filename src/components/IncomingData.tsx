"use client";

import { useCallback, useEffect, useState } from "react";
import { listCampaigns, updateCampaign, log } from "@/services/campaigns";
import { fmtDate, fmtTime } from "@/lib/format";
import { SearchSelect } from "./SearchSelect";
import { Button, Card, Loading, Pill, Tabs, Empty } from "./ui";
import masterData from "@/data/masterData.json";
import type { Campaign } from "@/types/campaign";

interface Props {
  profileId: string;
  role: "CATEGORY" | "CONTENT";
  onOpenCampaign: (id: string) => void;
}

/**
 * Category: sees whatever CRM has actually sent (crm_status advanced past
 * NOT_STARTED) and fills Sub Category / Brand / Offer / etc.
 * Content: sees whatever CRM has routed to Content (crm_status =
 * SENT_TO_CONTENT or content_status already in flight) and fills
 * Header / Sub Copy / etc.
 * Driven entirely by workflow status, not by a hardcoded month — a real
 * upload can land in any month, and there's no assumption here about which.
 */
export function IncomingData({ profileId, role, onOpenCampaign }: Props) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [tab, setTab] = useState("pending");

  const loadData = useCallback(async () => {
    setLoading(true);
    const all = await listCampaigns();
    const filtered = role === "CATEGORY"
      ? all.filter((c) => c.crm_status !== "NOT_STARTED" && !c.is_crm_self)
      : all.filter((c) =>
          c.crm_status === "SENT_TO_CONTENT" || c.content_status === "PENDING" ||
          c.content_status === "SUBMITTED" || c.content_status === "NEEDS_CHANGES"
        );
    setCampaigns(filtered);
    setLoading(false);
  }, [role]);

  useEffect(() => { loadData(); }, [loadData]);

  const pending = campaigns.filter((c) =>
    role === "CATEGORY" ? (!c.brand || !c.offer) : c.content_status !== "SUBMITTED"
  );
  const completed = campaigns.filter((c) =>
    role === "CATEGORY" ? (c.brand && c.offer) : c.content_status === "SUBMITTED"
  );

  const handleBulkSubmit = async () => {
    setSubmitting(true);
    try {
      const toSubmit = role === "CATEGORY"
        ? campaigns.filter((c) => c.brand && c.offer && c.category_status !== "LOCKED")
        : campaigns.filter((c) => c.content_status === "PENDING");

      for (let i = 0; i < toSubmit.length; i += 50) {
        const slice = toSubmit.slice(i, i + 50);
        await Promise.all(slice.map((c) =>
          updateCampaign(c.id, role === "CATEGORY"
            ? { category_status: "LOCKED", crm_status: "AWAITING_REVIEW" }
            : { content_status: "SUBMITTED", crm_status: "FINAL_QC" }
          )
        ));
      }
      await log(null, profileId,
        role === "CATEGORY" ? "CATEGORY_BULK_SUBMIT" : "CONTENT_BULK_SUBMIT",
        `${role} submitted ${toSubmit.length} campaigns to CRM.`
      );
      await loadData();
      alert(`${toSubmit.length} campaigns submitted to CRM.`);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Submission failed");
    }
    setSubmitting(false);
  };

  if (loading) return <Loading label="Loading incoming campaigns" />;

  if (campaigns.length === 0) {
    return (
      <Card>
        <Empty title="Nothing waiting on you right now"
          hint={role === "CATEGORY"
            ? "CRM hasn't sent any campaign slots yet. Check back once they've uploaded and sent the input file."
            : "CRM hasn't handed over any campaigns for creative input yet."} />
      </Card>
    );
  }

  const rows = tab === "pending" ? pending : completed;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-[16px] font-600 text-heading">Incoming Data</h3>
          <p className="text-tiny text-muted">
            {pending.length} pending · {completed.length} completed · {campaigns.length} total
          </p>
        </div>
        {pending.length > 0 && completed.length > 0 && (
          <Button onClick={handleBulkSubmit} disabled={submitting}>
            {submitting ? "Submitting..." : `Submit ${completed.length} to CRM`}
          </Button>
        )}
      </div>

      <Tabs active={tab} onChange={setTab} tabs={[
        { key: "pending", label: "Pending", count: pending.length },
        { key: "completed", label: "Completed", count: completed.length },
      ]} />

      <Card pad={false} className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px]">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-[#F9FAFB]">Day</th>
                <th>Time</th>
                <th>Segment</th>
                <th>Category</th>
                {role === "CATEGORY" ? (
                  <>
                    <th>Sub Category</th><th>Brand</th><th>Offer</th>
                    <th>Brief</th><th>Landing</th><th>CVR</th><th>RPV</th>
                  </>
                ) : (
                  <>
                    <th>Header</th><th>Sub Copy</th><th>H Count</th><th>S Count</th><th>Ref Link</th>
                  </>
                )}
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 100).map((c) => (
                <InlineRow key={c.id} campaign={c} role={role} onUpdate={loadData} onOpen={() => onOpenCampaign(c.id)} />
              ))}
            </tbody>
          </table>
          {rows.length > 100 && (
            <div className="border-t border-line px-4 py-3 text-tiny text-muted">
              Showing 100 of {rows.length} — use All Campaigns to search the rest
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function InlineRow({ campaign: c, role, onUpdate, onOpen }: {
  campaign: Campaign; role: string; onUpdate: () => void; onOpen: () => void;
}) {
  const save = async (patch: Partial<Campaign>) => {
    await updateCampaign(c.id, patch);
    onUpdate();
  };

  const hasCat = Boolean(c.brand && c.offer);

  return (
    <tr>
      <td className="sticky left-0 z-10 bg-surface whitespace-nowrap text-tiny font-medium text-heading">
        {fmtDate(c.launch_date)}
      </td>
      <td className="whitespace-nowrap text-tiny text-muted">{fmtTime(c.launch_time)}</td>
      <td><Pill dot={false} label={c.pncc_segment_label ?? "—"} tone="indigo" /></td>
      <td><Pill dot={false} label={c.pncc_category_code ?? c.category ?? "—"} tone="neutral" /></td>

      {role === "CATEGORY" ? (
        <>
          <td><input className="!py-1 !text-tiny" defaultValue={c.sub_category ?? ""}
            onBlur={(e) => save({ sub_category: e.target.value })} /></td>
          <td className="min-w-[150px]">
            <SearchSelect value={c.brand ?? ""} onChange={(v) => save({ brand: v })}
              options={masterData.brands} placeholder="Brand" />
          </td>
          <td className="min-w-[140px]">
            <SearchSelect value={c.offer ?? ""} onChange={(v) => save({ offer: v })}
              options={masterData.offers} placeholder="Offer" />
          </td>
          <td><input className="!py-1 !text-tiny" defaultValue={c.brief ?? ""}
            onBlur={(e) => save({ brief: e.target.value })} /></td>
          <td><input className="!py-1 !text-tiny" defaultValue={c.landing ?? ""}
            onBlur={(e) => save({ landing: e.target.value })} /></td>
          <td><input className="!py-1 !text-tiny !w-[60px]" defaultValue={c.expected_cvr ?? ""}
            onBlur={(e) => save({ expected_cvr: e.target.value } as Partial<Campaign>)} /></td>
          <td><input className="!py-1 !text-tiny !w-[60px]" defaultValue={c.expected_rpv ?? ""}
            onBlur={(e) => save({ expected_rpv: e.target.value } as Partial<Campaign>)} /></td>
        </>
      ) : (
        <>
          <td><input className="!py-1 !text-tiny" defaultValue="" placeholder="Header" /></td>
          <td><input className="!py-1 !text-tiny" defaultValue="" placeholder="Sub copy" /></td>
          <td><input className="!py-1 !text-tiny !w-[50px]" defaultValue="" placeholder="H" /></td>
          <td><input className="!py-1 !text-tiny !w-[50px]" defaultValue="" placeholder="S" /></td>
          <td><input className="!py-1 !text-tiny" defaultValue={c.reference_link ?? ""} placeholder="Link" /></td>
        </>
      )}

      <td><Pill label={hasCat ? "Filled" : "Pending"} tone={hasCat ? "success" : "warning"} /></td>
      <td><button onClick={onOpen} className="text-micro font-medium text-indigo-700 hover:underline">Open</button></td>
    </tr>
  );
}
