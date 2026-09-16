"use client";

import { useMemo, useState } from "react";
import { useSession } from "@/components/SessionProvider";
import { useCampaigns } from "@/components/useCampaigns";
import { CampaignDrawer } from "@/components/CampaignDrawer";
import { AddCampaignModal } from "@/components/AddCampaignModal";
import { MonthlyProgressBar } from "@/components/ProgressBar";
import { WeekDeadlines } from "@/components/WeekDeadlines";
import { CrmOwnCampaigns } from "@/components/CrmOwnCampaigns";
import { IncomingData } from "@/components/IncomingData";
import { ExcelUpload } from "@/components/ExcelUpload";
import { SplitBar } from "@/components/Charts";
import { Icon } from "@/components/icons";
import { Button, Card, CardHead, Loading } from "@/components/ui";
import { downloadCSV } from "@/services/exportExcel";
import { fmtMonth, isoDate, today } from "@/lib/format";
import { stageOf } from "@/lib/workflow";
import type { Campaign } from "@/types/campaign";

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

export default function OverviewPage() {
  const { profile } = useSession();
  const { campaigns, loading, reload } = useCampaigns();
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [urgentMode, setUrgentMode] = useState(false);

  if (!profile) return null;
  const role = profile.role;
  const isCrm = role === "CRM";
  const isCategory = role === "CATEGORY";
  const isContent = role === "CONTENT";
  const isExec = role === "EXECUTIVE";
  const isDesign = role === "DESIGN";

  // Next month for incoming data
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextMonthName = MONTH_NAMES[nextMonth.getMonth()];

  // Sep campaigns
  const sepCampaigns = useMemo(
    () => campaigns.filter((c) => c.launch_date >= "2026-09-01" && c.launch_date <= "2026-09-30"),
    [campaigns]
  );

  // Executive pie data
  const execPie = useMemo(() => {
    const crmDone = campaigns.filter((c) => c.crm_status !== "NOT_STARTED").length;
    const catDone = campaigns.filter((c) => c.brand && c.offer).length;
    const contentDone = campaigns.filter((c) => c.content_status === "SUBMITTED").length;
    const qcDone = campaigns.filter((c) => c.qc_status === "PASSED").length;
    return [
      { label: "CRM completed", value: crmDone, color: "#6438E8" },
      { label: "Category filled", value: catDone, color: "#9B8AFB" },
      { label: "Content done", value: contentDone, color: "#2E90FA" },
      { label: "QC passed", value: qcDone, color: "#12B76A" },
    ];
  }, [campaigns]);

  if (loading) return <Loading label="Loading dashboard" />;

  return (
    <div className="space-y-5">
      {/* Monthly workflow progress — shown to all roles */}
      <MonthlyProgressBar campaigns={campaigns} />

      {/* Top actions — CRM */}
      {isCrm && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={() => { setUrgentMode(false); setCreating(true); }}>
            {Icon.spark(13)} Add Campaign
          </Button>
          <Button size="sm" variant="ghost" onClick={() => {
            const ready = campaigns.filter((c) => c.production_status === "READY" || c.production_status === "PUSHED");
            downloadCSV(ready.length > 0 ? ready : campaigns, `PN_Export.csv`);
          }}>
            {Icon.chart(13)} Download Excel
          </Button>
        </div>
      )}

      {/* Category top actions */}
      {isCategory && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={() => { setUrgentMode(false); setCreating(true); }}>
            {Icon.spark(13)} Add Campaign
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setUrgentMode(true); setCreating(true); }}>
            {Icon.alert(13)} Emergency Campaign
          </Button>
        </div>
      )}

      {/* ────── CRM DASHBOARD: Excel Upload + Incoming Sep Data + Deadlines ────── */}
      {isCrm && (
        <>
          <ExcelUpload profileId={profile.id} onDone={reload} />
          <IncomingData year={2026} month={8} profileId={profile.id} role="CATEGORY" onOpenCampaign={setOpen} />
          <CrmOwnCampaigns campaigns={sepCampaigns} onOpen={setOpen} />
          <WeekDeadlines campaigns={sepCampaigns} monthStart={new Date(2026, 8, 1)} />
        </>
      )}

      {/* ────── CATEGORY DASHBOARD: Incoming Sep Data + Deadlines ────── */}
      {isCategory && (
        <>
          <IncomingData year={2026} month={8} profileId={profile.id} role="CATEGORY" onOpenCampaign={setOpen} />
          <WeekDeadlines campaigns={sepCampaigns} monthStart={new Date(2026, 8, 1)} />
        </>
      )}

      {/* ────── CONTENT DASHBOARD: Incoming Sep Data ────── */}
      {isContent && (
        <IncomingData year={2026} month={8} profileId={profile.id} role="CONTENT" onOpenCampaign={setOpen} />
      )}

      {/* ────── DESIGN DASHBOARD: link to Sep Campaigns ────── */}
      {isDesign && (
        <Card>
          <CardHead title="Design Team" sub="Upload images against September campaigns" />
          <Button variant="subtle" onClick={() => window.location.href = "/sep-campaigns"}>
            {Icon.spark(13)} Open Sep Campaigns
          </Button>
        </Card>
      )}

      {/* ────── EXECUTIVE DASHBOARD: Workflow overview + pie ────── */}
      {isExec && (
        <>
          <Card>
            <CardHead title="Workflow Overview" sub="Campaign completion across all teams" />
            <SplitBar segments={execPie} />
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["CRM slots", campaigns.filter((c) => c.crm_status !== "NOT_STARTED").length, "indigo"],
                ["Category filled", campaigns.filter((c) => c.brand && c.offer).length, "info"],
                ["Content done", campaigns.filter((c) => c.content_status === "SUBMITTED").length, "warning"],
                ["QC passed", campaigns.filter((c) => c.qc_status === "PASSED").length, "success"],
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

            {/* Bottleneck detection */}
            {(() => {
              const stages = [
                { label: "CRM processing", count: campaigns.filter((c) => c.crm_status === "NOT_STARTED").length },
                { label: "Category pending", count: campaigns.filter((c) => !c.brand && !c.offer && c.crm_status !== "NOT_STARTED").length },
                { label: "Content pending", count: campaigns.filter((c) => c.content_status === "PENDING").length },
                { label: "QC pending", count: campaigns.filter((c) => c.qc_status === "IN_PROGRESS").length },
              ].sort((a, b) => b.count - a.count);
              const worst = stages[0];
              return worst.count > 0 ? (
                <div className="mt-4 flex items-center gap-2 rounded-lg border border-[#FEDF89] bg-warning-50 px-4 py-3 text-tiny text-warning-700">
                  {Icon.alert(14)} {worst.label} is the current bottleneck — {worst.count} campaigns.
                </div>
              ) : null;
            })()}
          </Card>
          <WeekDeadlines campaigns={sepCampaigns} monthStart={new Date(2026, 8, 1)} />
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
