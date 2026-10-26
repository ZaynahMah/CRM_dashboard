"use client";

import { useMemo, useState } from "react";
import {
  CAMPAIGN_CATEGORY_FILTER_OPTIONS, ALL_CATEGORIES_LABEL, matchesCategoryFilter,
} from "@/lib/categoryFilter";
import { useSession } from "@/components/SessionProvider";
import { useCampaigns } from "@/components/useCampaigns";
import { CampaignDrawer } from "@/components/CampaignDrawer";
import { ChannelChip, DeadlineChip, OriginChip, StageChip } from "@/components/StatusChip";
import { Card, Empty, Loading, PageHead, TableCard } from "@/components/ui";
import { stageOf, STAGE_LABEL, STAGE_ORDER } from "@/lib/workflow";
import { fmtDate, fmtTime } from "@/lib/format";

export default function CampaignsPage() {
  const { profile } = useSession();
  const { campaigns, loading, reload } = useCampaigns();
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState(ALL_CATEGORIES_LABEL);
  const [origin, setOrigin] = useState("");
  const [stage, setStage] = useState("");

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return campaigns.filter((c) => {
      if (term && ![c.campaign_name, c.brand, c.category, c.offer, c.campaign_id_ext]
        .some((v) => v?.toLowerCase().includes(term))) return false;
      // Alias-aware: stored values use sheet abbreviations, the filter
      // shows the approved labels. AND with Origin and Stage, each
      // independent — changing one never resets the others.
      if (!matchesCategoryFilter(c.category, category)
        && !matchesCategoryFilter(c.pncc_category_code, category)) return false;
      if (origin && c.campaign_origin !== origin) return false;
      if (stage && stageOf(c) !== stage) return false;
      return true;
    });
  }, [campaigns, q, category, origin, stage]);

  if (!profile) return null;

  return (
    <div className="space-y-6">
      <PageHead
        eyebrow={`${profile.role} · Campaigns`}
        title="Campaign queue"
        sub={`${rows.length} of ${campaigns.length} campaigns match the current filters.`}
      />

      <Card className="grid gap-4 md:grid-cols-4">
        <label className="block md:col-span-2">
          <span className="mb-1.5 block text-tiny font-medium text-body">Search</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Campaign, brand, offer or ID" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-tiny font-medium text-body">Category</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {/* The SAME controlled list Show All PN uses, so every login
                sees identical options. */}
            <option value={ALL_CATEGORIES_LABEL}>{ALL_CATEGORIES_LABEL}</option>
            {CAMPAIGN_CATEGORY_FILTER_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-tiny font-medium text-body">Origin</span>
          <select value={origin} onChange={(e) => setOrigin(e.target.value)}>
            <option value="">Both origins</option>
            <option value="CATEGORY_REQUEST">Category request</option>
            <option value="CRM_PLANNED">CRM planned</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-tiny font-medium text-body">Stage</span>
          <select value={stage} onChange={(e) => setStage(e.target.value)}>
            <option value="">Any stage</option>
            {STAGE_ORDER.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
          </select>
        </label>
      </Card>

      {loading ? <Loading /> : rows.length === 0 ? (
        <Card><Empty title="No campaigns match" hint="Clear a filter or widen the search to see more of the month." /></Card>
      ) : (
        <TableCard>
          <table>
            <thead>
              <tr>
                <th>Launch</th><th>Campaign</th><th>Origin</th><th>Category</th><th>Brand</th>
                <th>Channel</th><th>Audience</th><th>Stage</th><th>Deadline</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="cursor-pointer" onClick={() => setOpen(c.id)}>
                  <td className="whitespace-nowrap text-tiny text-muted">
                    {fmtDate(c.launch_date)} · {fmtTime(c.launch_time)}
                  </td>
                  <td className="max-w-[220px] truncate font-medium text-heading">{c.campaign_name}</td>
                  <td><OriginChip campaign={c} /></td>
                  <td className="text-muted">{c.category ?? "—"}</td>
                  <td className="text-muted">{c.brand ?? "—"}</td>
                  <td><ChannelChip campaign={c} /></td>
                  <td className="max-w-[170px] truncate text-muted">{c.audience ?? "—"}</td>
                  <td><StageChip campaign={c} /></td>
                  <td><DeadlineChip campaign={c} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      )}

      <p className="text-tiny text-muted">Click any row to open the full campaign record and its activity trail.</p>
      <CampaignDrawer campaignId={open} profile={profile} onClose={() => setOpen(null)} onChanged={reload} />
    </div>
  );
}
