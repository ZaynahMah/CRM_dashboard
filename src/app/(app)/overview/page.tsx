"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "@/components/SessionProvider";
import { useCampaigns, onDashboardReset, getResetNotice, clearResetNotice } from "@/components/useCampaigns";
import { listQcChecklists } from "@/services/campaigns";
import type { QcMap } from "@/lib/crmBuckets";
import { CampaignDrawer } from "@/components/CampaignDrawer";
import { AddCampaignModal } from "@/components/AddCampaignModal";
import { MonthlyWorkflow } from "@/components/MonthlyWorkflow";
import { CategorySlaStrip } from "@/components/CategorySlaStrip";
import { ExecutiveDefaultRate } from "@/components/ExecutiveDefaultRate";
import { WeekDeadlines } from "@/components/WeekDeadlines";
import { CrmFlowBoard } from "@/components/CrmFlowBoard";
import { RoleQueue } from "@/components/RoleQueue";
import { ContentBulkExcel } from "@/components/ContentBulkExcel";
import { CrmInputUpload } from "@/components/CrmInputUpload";
import { SplitBar } from "@/components/Charts";
import { Icon } from "@/components/icons";
import { Button, Card, CardHead, Loading } from "@/components/ui";
import { downloadCSV } from "@/services/exportExcel";
import { today } from "@/lib/format";

export default function OverviewPage() {
  const { profile } = useSession();
  const { campaigns, loading, reload, staleRows, reloadRow } = useCampaigns();

  /**
   * The CRM board reads copy_verified / creative_verified from the QC
   * checklist to decide which review bucket a campaign sits in. One query
   * for every checklist, not one per row.
   */
  const [qc, setQc] = useState<QcMap>({});
  /**
   * Shown when CRM resets the dashboard while this session had unsaved
   * edits. Telling the user their work went is the point — the alternative
   * is it vanishing with no explanation.
   */
  const [resetMsg, setResetMsg] = useState<string | null>(null);
  useEffect(() => onDashboardReset((msg) => {
    setOpen(null);              // close any open drawer: its campaign is gone
    setQc({});                  // the checklist map refers to deleted rows
    if (msg) setResetMsg(msg);
    clearResetNotice();
    void getResetNotice;
  }), []);
  const loadQc = useCallback(async () => {
    try { setQc(await listQcChecklists()); } catch { setQc({}); }
  }, []);
  useEffect(() => { loadQc(); }, [loadQc]);
  const reloadAll = useCallback(async () => {
    await Promise.all([reload(), loadQc()]);
  }, [reload, loadQc]);
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [urgentMode, setUrgentMode] = useState(false);

  // Every hook must run on every render. `profile` is null on the first
  // render after sign-in and set on the next, so a hook placed below this
  // return would change the hook count between those two renders and crash
  // the client with "Rendered more hooks than during the previous render".
  const execPie = useMemo(() => {
    const crmDone = campaigns.filter((c) => c.crm_status !== "NOT_STARTED").length;
    const catDone = campaigns.filter((c) => c.brand && c.offer).length;
    const contentDone = campaigns.filter((c) => c.content_status === "SUBMITTED").length;
    const finalized = campaigns.filter((c) => c.calendar_status === "UPDATED").length;
    return [
      { label: "CRM completed", value: crmDone, color: "#6438E8" },
      { label: "Category filled", value: catDone, color: "#9B8AFB" },
      { label: "Content done", value: contentDone, color: "#2E90FA" },
      { label: "Finalized in Calendar", value: finalized, color: "#12B76A" },
    ];
  }, [campaigns]);

  if (!profile) return null;
  const role = profile.role;
  const isCrm = role === "CRM";
  const isCategory = role === "CATEGORY";
  const isContent = role === "CONTENT";
  const isExec = role === "EXECUTIVE";


  if (loading) return <Loading label="Loading dashboard" />;

  return (
    <div className="space-y-5">
      {/* Monthly workflow progress — a real funnel, zero when there's zero data */}
      {/* Shown in EVERY login, from one shared calculation, so all four
          roles see identical numbers (migration 20's SECURITY DEFINER RPC
          spans the full table; a client-side count would differ per role
          because migration 17 scopes reads). */}
      {resetMsg && (
        <div className="flex items-start justify-between gap-3 rounded-lg bg-warning-50 px-4 py-3 text-tiny text-warning-700">
          <span>{resetMsg}</span>
          <button onClick={() => setResetMsg(null)} className="font-medium hover:underline">
            Dismiss
          </button>
        </div>
      )}

      <MonthlyWorkflow campaigns={campaigns} qc={qc} />

      {/* Entry point so the SLA tracker is not a page nobody visits: every
          role sees the live counts here and clicks through. */}
      <CategorySlaStrip />

      {/* Category top actions */}
      {isCategory && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={() => { setUrgentMode(true); setCreating(true); }}>
            {Icon.alert(13)} Raise emergency push
          </Button>
        </div>
      )}

      {/* ────── CRM DASHBOARD: uploads + add + review + routing + deadlines ────── */}
      {isCrm && (
        <>
          <CrmInputUpload profileId={profile.id} onDone={reload} existingCampaigns={campaigns} />
          <CrmInputUpload profileId={profile.id} isCrmSelf onDone={reload} existingCampaigns={campaigns} />

          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => { setUrgentMode(false); setCreating(true); }}>
              {Icon.spark(13)} Add Campaign
            </Button>
            <Button size="sm" variant="ghost" onClick={() => {
              const finalized = campaigns.filter((c) => c.calendar_status === "UPDATED");
              if (finalized.length === 0) {
                alert("Nothing is finalized yet — use Final View / Calendar once campaigns clear QC and Update Calendar.");
                return;
              }
              downloadCSV(finalized, "PN_Export.csv");
            }}>
              {Icon.chart(13)} Download Excel
            </Button>
          </div>

          <CrmFlowBoard campaigns={campaigns} qc={qc} profileId={profile.id}
            onChanged={reloadAll} onOpen={setOpen}
            staleIds={staleRows} onReloadRow={reloadRow} />

          <WeekDeadlines campaigns={campaigns} monthStart={today()} />
        </>
      )}

      {/* ────── CATEGORY DASHBOARD ────── */}
      {isCategory && (
        <>
          <RoleQueue role="CATEGORY" campaigns={campaigns} qc={qc} profileId={profile.id}
            onOpenCampaign={setOpen} onChanged={reloadAll} />
          <WeekDeadlines campaigns={campaigns} monthStart={today()} />
        </>
      )}

      {/* ────── CONTENT DASHBOARD ────── */}
      {/* NEW: bulk Excel workflow for Content. The row-by-row queue below
          is unchanged and still works exactly as before. */}
      {isContent && (
        <ContentBulkExcel campaigns={campaigns}
          profileId={profile.id} onChanged={reloadAll} />
      )}

      {isContent && (
        <RoleQueue role="CONTENT" campaigns={campaigns} qc={qc} profileId={profile.id}
          onOpenCampaign={setOpen} onChanged={reloadAll} />
      )}


      {/* ────── EXECUTIVE DASHBOARD: workflow overview, all from the same real data ────── */}
      {isExec && (
        <>
          <Card>
            <CardHead title="Workflow Overview" sub="Campaign completion across all teams — the same records every queue reads" />
            <SplitBar segments={execPie} />
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["CRM slots", campaigns.filter((c) => c.crm_status !== "NOT_STARTED").length, "indigo"],
                ["Category filled", campaigns.filter((c) => c.brand && c.offer).length, "info"],
                ["Content done", campaigns.filter((c) => c.content_status === "SUBMITTED").length, "warning"],
                ["Finalized", campaigns.filter((c) => c.calendar_status === "UPDATED").length, "success"],
              ].map(([label, value, tone]) => (
                <div key={String(label)} className={`rounded-lg px-3 py-2 ${
                  tone === "indigo" ? "bg-indigo-50 text-indigo-700"
                  : tone === "info" ? "bg-info-50 text-info-700"
                  : tone === "warning" ? "bg-warning-50 text-warning-700"
                  : "bg-success-50 text-success-700"}`}>
                  <div className="text-[20px] font-700">{value}</div>
                  <div className="text-micro">{label}</div>
                </div>
              ))}
            </div>

            {(() => {
              const stages = [
                { label: "CRM review pending", count: campaigns.filter((c) => c.category_status === "LOCKED" && c.crm_status === "AWAITING_REVIEW").length },
                { label: "Category pending", count: campaigns.filter((c) => !c.brand && !c.offer && c.crm_status !== "NOT_STARTED").length },
                { label: "Content pending", count: campaigns.filter((c) => c.content_status === "PENDING").length },
                { label: "Awaiting CRM review", count: campaigns.filter((c) => c.content_status === "SUBMITTED" && c.qc_status !== "PASSED" && c.calendar_status !== "UPDATED").length },
                { label: "QC not yet passed", count: campaigns.filter((c) => c.qc_status !== "PASSED" && c.content_status === "SUBMITTED").length },
                { label: "QC passed, not finalized", count: campaigns.filter((c) => c.qc_status === "PASSED" && c.calendar_status !== "UPDATED").length },
              ].sort((a, b) => b.count - a.count);
              const worst = stages[0];
              return worst.count > 0 ? (
                <div className="mt-4 flex items-center gap-2 rounded-lg border border-[#FEDF89] bg-warning-50 px-4 py-3 text-tiny text-warning-700">
                  {Icon.alert(14)} {worst.label} is the current bottleneck — {worst.count} campaigns.
                </div>
              ) : campaigns.length > 0 ? (
                <div className="mt-4 flex items-center gap-2 rounded-lg border border-line bg-[#F9FAFB] px-4 py-3 text-tiny text-muted">
                  {Icon.check(14)} No stage is currently backed up.
                </div>
              ) : null;
            })()}
          </Card>
          <WeekDeadlines campaigns={campaigns} monthStart={today()} />

          {/* Directly below "Category submission deadlines", so leadership
              reads it in order: what is due, what was missed, who keeps
              missing it. Reporting only — no SLA logic involved. */}
          <ExecutiveDefaultRate />
        </>
      )}

      {/* Modals */}
      <AddCampaignModal open={creating} onClose={() => setCreating(false)}
        profileId={profile.id} isCrm={isCrm} isUrgent={urgentMode}
        onCreated={() => { setCreating(false); reload(); }} />
      <CampaignDrawer campaignId={open} profile={profile}
        onClose={() => setOpen(null)} onChanged={reload} />
    </div>
  );
}
